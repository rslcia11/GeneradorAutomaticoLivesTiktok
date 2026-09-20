import { randomUUID } from 'node:crypto';

import { TikTokLiveAdapter } from './tiktok/TikTokLiveAdapter.js';
import { RealtimeGateway } from './realtime/RealtimeGateway.js';
import { resolveAccessKey } from './realtime/accessKey.js';
import { retryWithBackoff } from './tiktok/retryWithBackoff.js';
import { ActivityDirector } from './live/ActivityDirector.js';
import { idleLine } from './live/idleLines.js';
import { EventProcessor } from './events/EventProcessor.js';
import { EventRuleEngine } from './rules/EventRuleEngine.js';
import { PriorityQueue } from './rules/PriorityQueue.js';
import { QueueWorker } from './workers/QueueWorker.js';
import { AIService } from './ai/AIService.js';
import { GeminiProvider } from './ai/GeminiProvider.js';
import { ResilientAIProvider } from './ai/ResilientAIProvider.js';
import { EdgeTTSProvider } from './tts/EdgeTTSProvider.js';
import { SpeechService } from './tts/SpeechService.js';
import { applyServiceIntent } from './ai/intents.js';
import { ThankYouTemplates } from './ai/ThankYouTemplates.js';
import { ServicePolicy } from './rules/ServicePolicy.js';
import { createLedgerSaver, loadLedger } from './rules/ledgerStore.js';
import { decorateMenu, normalizeGifts } from './rules/giftCatalog.js';
import { asNumber, readStreamerConfig, resolveContact,resolvePromo, resolveTiktokUsername } from './config/streamerConfig.js';
import { logger } from './logger.js';
import { GREETINGS } from './ai/LivenessContent.js';

/* Preferencias del streamer (frase y teléfono). Las claves siguen en .env. */
const streamer = readStreamerConfig('./streamer.config.json');

const config = {
    tiktokUsername: resolveTiktokUsername(streamer, process.env),

    /*
     * Servidor del overlay (página + WebSocket, un solo puerto).
     * Siempre en loopback: en producción Caddy pone HTTPS delante.
     * La clave (OVERLAY_KEY) es obligatoria fuera de loopback.
     */
    gateway: {
        host: process.env.GATEWAY_HOST?.trim() || '127.0.0.1',
        port: asNumber(process.env.GATEWAY_PORT, 8080)
    },

    queueMaxSize: 100,
    minGiftDiamondsForPriority: 10,
    workerPollIntervalMs: 100,

    aiTimeoutMs: 15000,

    aiModels: {
        primary: 'gemini-3.5-flash-lite',
        fallback: 'gemini-3.6-flash'
    },

    /*
     * Voz (opcional en .env):
     *   TTS_ENABLED=false         → sin voz
     *   TTS_VOICE=es-MX-JorgeNeural
     *   TTS_RATE=default | -8%    TTS_PITCH=default | -12%
     */
    tts: {
        enabled: process.env.TTS_ENABLED?.trim().toLowerCase() !== 'false',
        voice: process.env.TTS_VOICE?.trim() || 'es-MX-JorgeNeural',
        rate: process.env.TTS_RATE?.trim() || 'default',
        pitch: process.env.TTS_PITCH?.trim() || 'default',

        /*
         * Normal ≈ 1.5 s. Presupuesto hasta ai_response:
         * AIService (15 s × 2 + 5 s = 35 s) + voz (6 s) = 41 s,
         * menor que thinkingTimeoutMs del overlay (50 s).
         */
        timeoutMs: 6000
    },

    /* Cuántos donantes se muestran en la tabla del overlay. */
    recentDonorsShown: 5,

    /*
     * Franja de contacto del overlay (streamer.config.json, o .env).
     * Apagada por defecto: mostrar datos de contacto en un LIVE es
     * decisión (y riesgo) de cada streamer. Aparece unos segundos,
     * cada cierto tiempo.
     */
    contact: resolveContact(streamer, process.env),
    promo: resolvePromo(streamer, process.env),

    /* Memoria de apoyo de 24 h (quién regaló y quién ya usó su gratis). */
    supportLedgerFile:
        process.env.SUPPORT_LEDGER_FILE?.trim() ||
        './data/support-ledger.json',

    /*
     * Reconexión automática tras caída de red o cuando el cliente aún no
     * está en vivo. 0 = reintentar para siempre (servidor 24/7). Cada
     * intento consume una firma de Euler Stream: por eso el tope de 2 min.
     */
    reconnectMaxAttempts: /^\d+$/.test(process.env.RECONNECT_MAX_ATTEMPTS?.trim() ?? '')
        ? Number(process.env.RECONNECT_MAX_ATTEMPTS)
        : 5,
    reconnectBaseDelayMs: 5000
};

config.overlayKey = resolveAccessKey(process.env, config.gateway);


/* ============================================================
   CONFIGURACIÓN
   ============================================================ */

const geminiApiKey =
    process.env.GEMINI_API_KEY?.trim();

if (!geminiApiKey) {
    logger.error('GEMINI_API_KEY no está configurada. Ejecuta la app con --env-file=.env');
    process.exit(1);
}


/* ============================================================
   UTILIDADES
   ============================================================ */

/*
 * URL que se pega en OBS. La clave NO se escribe en el log (en el servidor
 * los logs se guardan): la URL completa la imprime deploy/nuevo-cliente.sh.
 */
function overlayUrl() {
    const url = `http://${config.gateway.host}:${config.gateway.port}/?avatar=animado`;

    return config.overlayKey ? `${url}&key=<OVERLAY_KEY>` : url;
}


/* ============================================================
   REALTIME / OVERLAY
   ============================================================ */

/* Devuelve el saldo (o la respuesta gratis) de una interacción no entregada. */
function refund(decision, event, reason) {

    if (!decision?.metadata?.service) {
        return;
    }

    servicePolicy.refund({
        service: decision.metadata.service,
        event
    });

    logger.warn(`↩️  Devuelto a @${event?.user?.username}: ${decision.metadata.service.label} (${reason})`);
}

/* Últimos regalos recibidos, para la tabla del overlay. */
const recentDonors = [];

/*
 * Atuendo del mago (tinte del aura): cambia cada tanto y con regalos
 * grandes, nunca al mismo (ver OUTFITS en AnimatedAvatar.js).
 */
const OUTFITS = 5;
let outfitIndex    = 0;
let outfitChangedAt = 0;
let memberCounter  = 0;
let shareCounter   = 0;
let likeCounter    = 0;
let greetCounter   = 0;

const SHARE_RESPONSES = Object.freeze([
    '¡Gracias por compartir el LIVE! La magia viaja ahora contigo...',
    '¡Compartiste! Las cartas te lo agradecen... tu energía se expande.',
    '¡Gracias por llevar el oráculo a más personas! Eso tiene su recompensa...',
    '¡Gracias por compartir! Más almas llegan al círculo místico.',
    '¡Qué gesto tan generoso compartir! Las cartas te envían buena energía.',
]);

const LIKE_RESPONSES = Object.freeze([
    '¡Gracias por el like! Tu energía alimenta el oráculo...',
    '¡La bola de cristal brilla más con tu apoyo! Gracias.',
    '¡Gracias por el like! Las cartas te lo devuelven en buena vibra.',
    '¡Siento tu apoyo! El oráculo lo agradece profundamente.',
]);

function nextResponse(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function nextOutfit() {
    outfitIndex = (outfitIndex + Math.floor(Math.random() * (OUTFITS - 1)) + 1) % OUTFITS;
    outfitChangedAt = Date.now();
    gateway.broadcast({ type: 'outfit_change', paletteId: outfitIndex });
}

/* El último que entró, para saludarlo si la sala está callada. */
let newcomer = null;

function pickGreeting(username) {
    return GREETINGS[Math.floor(Math.random() * GREETINGS.length)](username);
}

function broadcastQuick(text, user = null) {
    gateway.broadcast({
        platform:      'system',
        type:          'ai_response',
        interactionId: randomUUID(),
        text,
        intent:        'invite_share',
        audio:         null,
        user,
        source:        null
    });
}

function rememberDonor(event, coins, balance) {

    recentDonors.unshift({
        username: event.user?.username ?? null,
        nickname: event.user?.nickname ?? null,
        gift: event.gift?.name ?? 'regalo',
        image: event.gift?.image ?? null,
        coins,
        balance,
        at: Date.now()
    });

    recentDonors.length = Math.min(recentDonors.length, config.recentDonorsShown);
}

/* Sobre estándar de los eventos que genera la app (no vienen de TikTok). */
function systemEvent(type, data) {
    return {
        platform: 'system',
        type,
        timestamp: Date.now(),
        ...data
    };
}

function donorBoardEvent() {
    return systemEvent('donor_board', { donors: recentDonors });
}

/* Regalos reales de la sala (se piden al conectar). Vacío = menú con íconos. */
let roomGifts = [];

function menuEvent() {
    return systemEvent('service_menu', {
        services: decorateMenu(
            servicePolicy.menu(),
            roomGifts,
            coins => servicePolicy.unlocks(coins)
        )
    });
}

/*
 * No bloquea el arranque: si TikTok no entrega la lista, el menú sigue
 * funcionando con íconos y se registra el motivo.
 */
async function loadRoomGifts() {

    try {
        roomGifts = normalizeGifts(await tiktok.fetchGifts());

        if (roomGifts.length === 0) {
            logger.warn('TikTok no entregó regalos de la sala; el menú usa íconos');
            return;
        }

        const menu = menuEvent();

        gateway.broadcast(menu);

        for (const service of menu.services) {
            logger.debug(
                `🎁 ${service.label} (${service.coins}) ← ` +
                (service.tiktokGift
                    ? `regalo "${service.tiktokGift.name}" (${service.tiktokGift.coins})`
                    : 'ningún regalo de la sala da justo este servicio')
            );
        }

    } catch (error) {
        logger.warn(`No se pudo leer la lista de regalos (${error.message}); el menú usa íconos`);
    }
}

const gateway = new RealtimeGateway({
    ...config.gateway,
    accessKey: config.overlayKey,
    log: logger,

    /* Para el monitor del servidor. Nada de aquí es secreto. */
    health: () => ({
        tiktok: tiktok.connected ? 'connected' : 'connecting',
        uptimeSeconds: Math.round(process.uptime())
    }),

    /* El overlay recibe el menú y la tabla apenas se conecta. */
    welcome: () => [
        menuEvent(),
        donorBoardEvent(),
        systemEvent('contact_banner', { contact: config.contact }),
        { type: 'promo_banner', promo: config.promo }
    ]
});


/* ============================================================
   REGLAS Y COLA
   ============================================================ */

/*
 * Servicios: quien no apoya recibe una respuesta corta cada 24 h;
 * quien apoya recibe lecturas según lo que haya regalado.
 */
const supportLedger =
    await loadLedger(config.supportLedgerFile);

const ledgerSaver = createLedgerSaver({
    path: config.supportLedgerFile,
    ledger: supportLedger
});

const servicePolicy = new ServicePolicy({
    ledger: supportLedger,

    /* Todo cambio de saldo o de gratis se guarda (de forma diferida). */
    onChange: () => ledgerSaver.schedule()
});

const ruleEngine = new EventRuleEngine({
    minGiftDiamondsForPriority:
        config.minGiftDiamondsForPriority,

    policy: servicePolicy
});

const queue = new PriorityQueue({
    maxSize: config.queueMaxSize
});


/* ============================================================
   EVENT PROCESSOR
   ============================================================ */

const processor = new EventProcessor({
    ruleEngine,
    queue,

    onVisualEvent: event => {
        gateway.broadcast(event);
    }
});


/* ============================================================
   GEMINI PROVIDERS
   ============================================================ */

const primaryAIProvider =
    new GeminiProvider({
        apiKey: geminiApiKey,
        model: config.aiModels.primary,
        timeoutMs: config.aiTimeoutMs
    });

const fallbackAIProvider =
    new GeminiProvider({
        apiKey: geminiApiKey,
        model: config.aiModels.fallback,
        timeoutMs: config.aiTimeoutMs
    });


/* ============================================================
   RESILIENT AI PROVIDER
   ============================================================ */

const aiProvider =
    new ResilientAIProvider({
        providers: [
            primaryAIProvider,
            fallbackAIProvider
        ]
    });


/* ============================================================
   AI SERVICE
   ============================================================ */

const aiService = new AIService({
    provider: aiProvider,

    /*
     * Permite que el proveedor principal y el fallback
     * tengan oportunidad de ejecutarse.
     */
    timeoutMs:
        (config.aiTimeoutMs * 2) + 5000
});


/* ============================================================
   VOZ (TTS)
   ============================================================ */

const speechService = config.tts.enabled
    ? new SpeechService({
        provider: new EdgeTTSProvider(config.tts)
    })
    : null;


/* ============================================================
   EVENTOS INTERNOS DE IA
   ============================================================ */

function createAIEvent(
    type,
    queueItem,
    extra = {}
) {

    const sourceEvent =
        queueItem.event;

    return {
        platform: 'system',
        type,
        timestamp: Date.now(),

        /*
         * Mismo ID en ai_processing, ai_response y ai_error.
         * El overlay lo usa para asociar cada resultado
         * con su interacción.
         */
        interactionId:
            queueItem.interactionId,

        source: {
            platform:
                sourceEvent?.platform ??
                'tiktok',

            type:
                sourceEvent?.type ??
                null,

            timestamp:
                sourceEvent?.timestamp ??
                null,

            /*
             * Permite mostrar el comentario que se está
             * respondiendo, no el último que llegó.
             */
            content:
                typeof sourceEvent?.content === 'string'
                    ? sourceEvent.content
                    : null
        },

        user: {
            id:
                sourceEvent?.user?.id ??
                null,

            username:
                sourceEvent?.user?.username ??
                null,

            nickname:
                sourceEvent?.user?.nickname ??
                null
        },

        ...extra
    };
}


/* ============================================================
   QUEUE WORKER
   ============================================================ */

const thankYouTemplates = new ThankYouTemplates();

/*
 * Con la sala callada el mago toma la iniciativa (frases de plantilla, sin
 * IA); con la sala activa se calla, porque las interacciones ya dan
 * movimiento. También dice al overlay cuánta animación poner.
 */
const director = new ActivityDirector({
    line: context => idleLine({
        ...context,

        /* Solo se saluda a quien entró hace poco; si no, suena a grabación. */
        newcomer: newcomer && Date.now() - newcomer.at < NEWCOMER_FRESH_MS ? newcomer.name : null
    })
});

/* Lo que cuenta como participar. */
const PARTICIPATION_EVENTS = new Set(['comment', 'gift', 'follow', 'share', 'subscription']);

/* Cada cuánto se revisa la sala. */
const DIRECTOR_TICK_MS = 10_000;

/* Un recién llegado deja de ser "recién" a los... */
const NEWCOMER_FRESH_MS = 60_000;

/* Cambio de atuendo por tiempo, y barajada del mazo con la sala callada. */
const OUTFIT_EVERY_MS = 4 * 60_000;
const SHUFFLE_EVERY_MS = Object.freeze({ quiet: 90_000, warming: 180_000, busy: Infinity });

let directorTimer = null;
let shuffledAt = 0;

function startDirector() {
    stopDirector();
    director.start();
    outfitChangedAt = Date.now();
    shuffledAt = Date.now();
    directorTimer = setInterval(() => {
        directScene().catch(error => logger.warn(`El director falló: ${error.message}`));
    }, DIRECTOR_TICK_MS);
}

/* Sin LIVE no hay sala que dirigir: nada de voz sintetizada a la nada. */
function stopDirector() {
    clearInterval(directorTimer);
    directorTimer = null;
}

async function directScene() {

    /* Sin LIVE, o sin un overlay que lo muestre, no hay a quién hablarle. */
    if (!tiktok.connected || gateway.clientCount === 0) {
        return;
    }

    const now = Date.now();
    const { mood, energy, speak } = director.direct(now);

    gateway.broadcast({ type: 'scene_mood', mood, energy });

    /* Cambios de escena sin hablar: atuendo y mazo. */
    if (now - outfitChangedAt >= OUTFIT_EVERY_MS) {
        nextOutfit();
    }

    if (now - shuffledAt >= SHUFFLE_EVERY_MS[mood]) {
        shuffledAt = now;
        gateway.broadcast({ type: 'avatar_shuffle' });
    }

    if (!speak) {
        return;
    }

    logger.info(`🎭 Sala ${mood}: el mago habla solo (${speak.intent})`);

    const audio = await speechService?.synthesizeForOverlay(speak.text) ?? null;
    const interactionId = randomUUID();
    const source = { platform: 'tiktok', type: 'idle', timestamp: now, content: null };

    gateway.broadcast({
        platform: 'system',
        type: 'ai_processing',
        timestamp: now,
        interactionId,
        source,
        user: null
    });

    gateway.broadcast({
        platform: 'system',
        type: 'ai_response',
        timestamp: Date.now(),
        interactionId,
        source,
        user: null,
        text: speak.text,
        audio,

        /* invite_share (invitar, saludar) o tarot_reading (carta del día, con cartas). */
        intent: speak.intent
    });

    /* Quien fue saludado ya no es nuevo. */
    if (speak.intent === 'invite_share' && newcomer && speak.text.includes(newcomer.name)) {
        newcomer = null;
    }

    director.registerBusy();
}

const worker = new QueueWorker({
    processor,

    pollIntervalMs:
        config.workerPollIntervalMs,

    /*
     * Se ejecuta cuando el worker realmente comienza
     * a procesar un elemento de la cola.
     *
     * Este es el momento correcto para informar al
     * overlay que Gemini está pensando.
     */
    handler: async queueItem => {


        const {
            event,
            decision
        } = queueItem;

        logger.debug(`⚙️  Worker → ${event.type} | prioridad=${decision.priority}`);

        /* El mago está ocupado: el director no habla encima. */
        director.registerBusy();

        queueItem.interactionId =
            randomUUID();

        const processingEvent =
            createAIEvent(
                'ai_processing',
                queueItem
            );

        gateway.broadcast(
            processingEvent
        );

        if (
            event.type === 'gift' ||
            event.type === 'subscription'
        ) {
            return thankYouTemplates.generate({ event });
        }

        return aiService.generateResponse({
            event,

            /* Define el largo de la respuesta (gratis, lectura, etc.). */
            service: decision.metadata?.service ?? null,

            context: {
                platform: 'tiktok'
            }
        });
    },


    /*
     * Gemini terminó correctamente.
     */
    onResult: async (
        result,
        queueItem
    ) => {


        const sourceEvent =
            queueItem.event;

        logger.info(`✅ IA completó → ${sourceEvent.type}`);
        logger.debug(`🤖 ${result.text}`);

        const resilience =
            result.metadata?.resilience;

        if (resilience?.fallbackUsed) {
            logger.warn(`IA respondió mediante fallback | providerIndex=${resilience.providerIndex}`);
        }

        const audio =
            await speechService?.synthesizeForOverlay(result.text) ?? null;

        /* La respuesta recién empieza a sonar: el director espera. */
        director.registerBusy();

        const aiResponseEvent =
            createAIEvent(
                'ai_response',
                queueItem,
                {
                    text:
                        result.text,

                    /*
                     * { mimeType, data (base64) } o null.
                     * El fin del audio marca el fin de la respuesta.
                     */
                    audio,

                    /*
                     * Tipo de respuesta: el overlay elige la animación.
                     * Lo pagado manda: quien compró una lectura VE las
                     * cartas, y una respuesta gratis nunca las saca.
                     */
                    intent:
                        applyServiceIntent(
                            result.intent,
                            queueItem.decision.metadata?.service
                        ),

                    ai: {
                        provider:
                            result.metadata?.provider ??
                            null,

                        model:
                            result.metadata?.model ??
                            null,

                        fallbackUsed:
                            resilience?.fallbackUsed ??
                            false,

                        providerIndex:
                            resilience?.providerIndex ??
                            0
                    }
                }
            );

        gateway.broadcast(
            aiResponseEvent
        );
    },


    /*
     * Gemini falló.
     *
     * Además del log del backend, notificamos al
     * overlay para evitar que el avatar permanezca
     * indefinidamente en THINKING.
     */
    onError: async (
        error,
        queueItem
    ) => {


        const sourceEvent =
            queueItem.event;

        logger.error(`❌ IA falló → ${sourceEvent.type} | ${error.code ?? 'AI_ERROR'}: ${error.message}`);

        /* La IA no respondió: se devuelve lo que se le cobró. */
        if (sourceEvent.type === 'comment') {
            refund(queueItem.decision, sourceEvent, 'la IA falló');
        }

        const aiErrorEvent =
            createAIEvent(
                'ai_error',
                queueItem,
                {
                    error: {
                        code:
                            error.code ??
                            'AI_ERROR',

                        message:
                            error.message ??
                            'Error desconocido'
                    }
                }
            );

        gateway.broadcast(
            aiErrorEvent
        );
    }
});


/* ============================================================
   TIKTOK
   ============================================================ */

const tiktok =
    new TikTokLiveAdapter(
        config.tiktokUsername
    );

tiktok.onEvent(event => {

    logger.debug(`📥 TikTok → ${event.type}`);

    /*
     * El director mira la sala: quién hay y si alguien PARTICIPA.
     * Entrar (member), dar like o irse no es participar.
     */
    if (event.type === 'room_user') {
        director.setViewers(event.data?.totalUsers);
    } else if (PARTICIPATION_EVENTS.has(event.type)) {
        director.registerInteraction();
    }

    /*
     * El apoyo se registra ANTES de aplicar las reglas: el regalo
     * recién llegado ya cuenta para el servicio que desbloquea.
     */
    if (event.type === 'gift') {
        /* Un combo en curso no suma: solo cuenta el evento final. */
        const { coins, counted, balance, service } =
            servicePolicy.registerGift(event);

        if (counted) {
            rememberDonor(event, coins, balance);
            gateway.broadcast(donorBoardEvent());

            logger.info(
                `💎 Apoyo → @${event.user?.username} | ` +
                `regalo "${event.gift?.name}" x${event.gift?.repeatCount ?? 1} = ${coins} ` +
                `(saldo: ${balance}) → desbloquea ${service.label}`
            );

            /* Regalo grande (≥ 50 monedas): el mago se cambia de atuendo. */
            if (coins >= 50) {
                nextOutfit();
            }
        }
    }

    /* Quien acaba de entrar puede recibir un saludo del director (con voz). */
    if (event.type === 'member') {
        const name = event.user?.nickname || event.user?.username;

        newcomer = name ? { name, at: Date.now() } : null;

        memberCounter = (memberCounter + 1) % 8;

        if (memberCounter === 0) {
            const username =
                event.user?.nickname ||
                event.user?.username ||
                'viajero';

            broadcastQuick(pickGreeting(username), event.user ?? null);
        }
    }

    /* Agradece shares: 1 de cada 2. */
    if (event.type === 'share') {
        shareCounter = (shareCounter + 1) % 2;

        if (shareCounter === 0) {
            broadcastQuick(nextResponse(SHARE_RESPONSES));
        }
    }

    /* Agradece likes: 1 de cada 15. */
    if (event.type === 'like') {
        likeCounter = (likeCounter + 1) % 15;

        if (likeCounter === 0) {
            broadcastQuick(nextResponse(LIKE_RESPONSES));
        }
    }

    const result =
        processor.process(event);

    /* Saluda comentarios de bienvenida (hola, hi, etc.): 1 de cada 3. */
    if (
        event.type === 'comment' &&
        !result.queued &&
        result.decision?.reason === 'filler_comment'
    ) {
        greetCounter = (greetCounter + 1) % 3;

        if (greetCounter === 0) {
            const username =
                event.user?.nickname ||
                event.user?.username ||
                'viajero';

            broadcastQuick(pickGreeting(username), event.user ?? null);
        }
    }

    /*
     * VISUAL ya es publicado por EventProcessor.
     *
     * QUEUE / PRIORITY también se muestran en el
     * overlay mientras esperan procesamiento.
     */
    if (result.queued) {

        gateway.broadcast(event);

        if (event.type === 'comment' && (result.position ?? 0) > 0) {
            gateway.broadcast({
                type: 'queue_position',
                user: event.user,
                position: result.position
            });
        }

        logger.info(`📦 Cola → ${event.type} | prioridad=${result.decision.priority} | tamaño=${processor.queueSize}`);
    }

    if (result.dropped) {
        logger.warn('Evento descartado por capacidad de cola');
    }

    /*
     * Si el evento se cobró pero no entró en la cola, se devuelve:
     * nadie paga por una respuesta que no va a recibir.
     */
    if (!result.queued && result.decision.reason === 'valid_comment') {
        refund(result.decision, event, 'no entró en la cola');
    }

    if (result.decision.reason === 'free_quota_used') {
        logger.info(
            `🚫 @${event.user?.username} ya usó su respuesta gratis ` +
            `(faltan ${result.decision.metadata?.hoursUntilFree?.toFixed(1) ?? '?'} h)`
        );
    }
});


/* ============================================================
   START
   ============================================================ */

/* Misma política para la conexión inicial y para cada caída. */
const retryTikTok = (attempt, label) => retryWithBackoff(attempt, {
    maxAttempts: config.reconnectMaxAttempts,
    baseDelayMs: config.reconnectBaseDelayMs,
    stopped: () => shuttingDown,
    onRetry: ({ attempt: n, error, delayMs }) => logger.warn(
        `${label} falló (${error.message}); reintento en ${(delayMs / 1000).toFixed(0)} s ` +
        `(${n}/${config.reconnectMaxAttempts > 0 ? config.reconnectMaxAttempts : '∞'})`
    )
});

async function start() {

    try {

        logger.info('🚀 Iniciando aplicación...');

        await gateway.start();

        logger.info(`🖥️  Overlay para OBS: ${overlayUrl()}`);
        logger.info(`🔌 Conectando con @${config.tiktokUsername}...`);

        const session = await retryTikTok(() => tiktok.connect(), 'Conexión con TikTok');

        if (!session) {
            return;
        }

        /*
         * Registrar manejador de desconexión.
         * Nunca actúa al apagar la app.
         */
        tiktok.onDisconnect(async ({ intentional }) => {
            if (shuttingDown) return;

            /*
             * Fin del LIVE: en la PC del streamer, se queda quieto. En el
             * servidor 24/7 (reintentos infinitos) espera el próximo LIVE.
             */
            const waitForNextLive = config.reconnectMaxAttempts <= 0;

            if (intentional && !waitForNextLive) return;

            logger.warn(intentional
                ? 'El LIVE terminó; esperando el próximo...'
                : 'TikTok desconectado inesperadamente, intentando reconectar...');

            try {
                if (await retryTikTok(() => tiktok.reconnect(), 'Reconexión')) {
                    logger.info('✅ TikTok reconectado');
                }
            } catch {
                logger.error('No se pudo reconectar con TikTok. Cerrando la aplicación.');
                shutdown();
            }
        });

        /*
         * El worker comienza únicamente después
         * de confirmar la conexión con TikTok.
         */
        worker.start();

        startDirector();

        void loadRoomGifts();

        logger.info('✅ TikTok conectado');
        logger.info(`Room ID: ${session.roomId}`);
        logger.info(`📦 Capacidad de cola: ${config.queueMaxSize}`);
        logger.info('⚙️  QueueWorker iniciado');
        logger.info(`🤖 IA principal: ${config.aiModels.primary}`);
        logger.info(`🛟 IA fallback: ${config.aiModels.fallback}`);
        logger.info(speechService
            ? `🗣️  Voz: ${config.tts.voice}`
            : '🔇 Voz desactivada (TTS_ENABLED=false)');
        logger.info(`🎁 Servicios: ${servicePolicy.menu().map(s => `${s.label} (${s.coins})`).join(' · ')}`);
        logger.info(`🆓 Gratis: 1 respuesta cada ${servicePolicy.free.freeEveryHours} h por persona`);
        logger.info(
            config.contact.enabled && config.contact.text
                ? `📞 Contacto: visible ${config.contact.visibleSeconds}s cada ${config.contact.everyMinutes} min`
                : '📵 Franja de contacto desactivada (streamer.config.json → contact.enabled)'
        );
        logger.info(
            config.contact.enabled && config.contact.phone
                ? '📱 Teléfono incluido en la franja de contacto'
                : '📱 Sin teléfono en la franja (streamer.config.json → contact.phone)'
        );
        logger.info('Esperando eventos...\n');

    } catch (error) {

        logger.error(`❌ Error iniciando aplicación: ${error.message}`);

        /* Que el disconnect de abajo no dispare la espera del próximo LIVE. */
        shuttingDown = true;
        stopDirector();

        try {
            await worker.stop();
        } catch {
            // El worker puede no haberse iniciado.
        }

        try {
            tiktok.disconnect();
        } catch {
            // TikTok puede no haberse conectado.
        }

        try {
            await gateway.stop();
        } catch {
            // Gateway puede no haberse iniciado.
        }

        process.exit(1);
    }
}


/* ============================================================
   SHUTDOWN
   ============================================================ */

let shuttingDown = false;

async function shutdown() {

    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    logger.info('🛑 Cerrando aplicación...');

    try {

        /*
         * Primero dejamos de recibir eventos nuevos.
         */
        stopDirector();
        tiktok.disconnect();

        /*
         * Esperamos únicamente el trabajo que ya
         * se encuentre en ejecución.
         */
        await worker.stop();

        logger.info(`📊 EventProcessor: ${JSON.stringify(processor.getStats())}`);
        logger.info(`📊 QueueWorker: ${JSON.stringify(worker.getStats())}`);
        logger.info(`📊 AIService: ${JSON.stringify(aiService.getStats())}`);
        logger.info(`📊 ResilientAIProvider: ${JSON.stringify(aiProvider.getStats())}`);
        logger.info(`📊 Gemini ${config.aiModels.primary}: ${JSON.stringify(primaryAIProvider.getStats())}`);
        logger.info(`📊 Gemini ${config.aiModels.fallback}: ${JSON.stringify(fallbackAIProvider.getStats())}`);

        if (speechService) {
            logger.info(`📊 Voz: ${JSON.stringify(speechService.getStats())}`);
        }

        logger.info(`📊 Servicios: ${JSON.stringify(servicePolicy.getStats())}`);

        /* La memoria de apoyo de 24 h no debe perderse al cerrar. */
        await ledgerSaver.flush();

        await gateway.stop();

        logger.info('✅ Aplicación cerrada correctamente');

    } catch (error) {

        logger.error(`❌ Error durante el cierre: ${error.message}`);
    }

    process.exit(0);
}


/* ============================================================
   SIGNALS
   ============================================================ */

process.on(
    'SIGINT',
    shutdown
);

process.on(
    'SIGTERM',
    shutdown
);

await start();
