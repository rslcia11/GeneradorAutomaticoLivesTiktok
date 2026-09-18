import { randomUUID } from 'node:crypto';

import { TikTokLiveAdapter } from './tiktok/TikTokLiveAdapter.js';
import { RealtimeGateway } from './realtime/RealtimeGateway.js';
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
import { readStreamerConfig, resolveContact, resolveTiktokUsername } from './config/streamerConfig.js';

/* Preferencias del streamer (frase y teléfono). Las claves siguen en .env. */
const streamer = readStreamerConfig('./streamer.config.json');

const config = {
    tiktokUsername: resolveTiktokUsername(streamer, process.env),
    websocketPort: 8080,

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

    /* Memoria de apoyo de 24 h (quién regaló y quién ya usó su gratis). */
    supportLedgerFile:
        process.env.SUPPORT_LEDGER_FILE?.trim() ||
        './data/support-ledger.json'
};


/* ============================================================
   CONFIGURACIÓN
   ============================================================ */

const geminiApiKey =
    process.env.GEMINI_API_KEY?.trim();

if (!geminiApiKey) {
    console.error(
        '❌ GEMINI_API_KEY no está configurada.'
    );

    console.error(
        'Ejecuta la aplicación con --env-file=.env'
    );

    process.exit(1);
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

    console.warn(
        `↩️ Devuelto a @${event?.user?.username}: ${decision.metadata.service.label} (${reason})`
    );
}

/* Últimos regalos recibidos, para la tabla del overlay. */
const recentDonors = [];

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
            console.warn('⚠️ TikTok no entregó regalos de la sala; el menú usa íconos');
            return;
        }

        const menu = menuEvent();

        gateway.broadcast(menu);

        for (const service of menu.services) {
            console.log(
                `🎁 ${service.label} (${service.coins}) ← ` +
                (service.tiktokGift
                    ? `regalo "${service.tiktokGift.name}" (${service.tiktokGift.coins})`
                    : 'ningún regalo de la sala da justo este servicio (se muestra ícono)')
            );
        }

    } catch (error) {
        console.warn(`⚠️ No se pudo leer la lista de regalos (${error.message}); el menú usa íconos`);
    }
}

const gateway = new RealtimeGateway({
    port: config.websocketPort,

    /* El overlay recibe el menú y la tabla apenas se conecta. */
    welcome: () => [
        menuEvent(),
        donorBoardEvent(),
        systemEvent('contact_banner', { contact: config.contact })
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

        console.log(
            `⚙️ Worker procesando → ${event.type} | ` +
            `prioridad=${decision.priority}`
        );

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

        console.log(
            `✅ IA completó → ${sourceEvent.type}`
        );

        console.log(
            `🤖 IA → ${result.text}`
        );

        const resilience =
            result.metadata?.resilience;

        if (
            resilience?.fallbackUsed
        ) {
            console.warn(
                `⚠️ IA respondió mediante fallback | ` +
                `providerIndex=${resilience.providerIndex}`
            );
        }

        const audio =
            await speechService?.synthesizeForOverlay(result.text) ?? null;

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

        console.error(
            `❌ IA falló → ${sourceEvent.type} | ` +
            `${error.code ?? 'AI_ERROR'}: ${error.message}`
        );

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

    console.log(
        `📥 TikTok → ${event.type}`
    );

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

            console.log(
                `💎 Apoyo → @${event.user?.username} | ` +
                `regalo "${event.gift?.name}" x${event.gift?.repeatCount ?? 1} = ${coins} ` +
                `(saldo: ${balance}) → desbloquea ${service.label}`
            );
        }
    }

    const result =
        processor.process(event);

    /*
     * VISUAL ya es publicado por EventProcessor.
     *
     * QUEUE / PRIORITY también se muestran en el
     * overlay mientras esperan procesamiento.
     */
    if (result.queued) {

        gateway.broadcast(event);

        console.log(
            `📦 Cola → ${event.type} | ` +
            `prioridad=${result.decision.priority} | ` +
            `tamaño=${processor.queueSize}`
        );
    }

    if (result.dropped) {
        console.warn(
            '⚠️ Evento descartado por capacidad de cola'
        );
    }

    /*
     * Si el evento se cobró pero no entró en la cola, se devuelve:
     * nadie paga por una respuesta que no va a recibir.
     */
    if (!result.queued && result.decision.reason === 'valid_comment') {
        refund(result.decision, event, 'no entró en la cola');
    }

    if (result.decision.reason === 'free_quota_used') {
        console.log(
            `🚫 @${event.user?.username} ya usó su respuesta gratis ` +
            `(faltan ${result.decision.metadata?.hoursUntilFree?.toFixed(1) ?? '?'} h)`
        );
    }
});


/* ============================================================
   START
   ============================================================ */

async function start() {

    try {

        console.log(
            '🚀 Iniciando aplicación...'
        );

        gateway.start();

        console.log(
            `🔌 Conectando con @${config.tiktokUsername}...`
        );

        const session =
            await tiktok.connect();

        /*
         * El worker comienza únicamente después
         * de confirmar la conexión con TikTok.
         */
        worker.start();

        void loadRoomGifts();

        console.log(
            '✅ TikTok conectado'
        );

        console.log(
            `Room ID: ${session.roomId}`
        );

        console.log(
            `📡 WebSocket: ws://127.0.0.1:${config.websocketPort}`
        );

        console.log(
            `📦 Capacidad de cola: ${config.queueMaxSize}`
        );

        console.log(
            '⚙️ QueueWorker iniciado'
        );

        console.log(
            `🤖 IA principal: ${config.aiModels.primary}`
        );

        console.log(
            `🛟 IA fallback: ${config.aiModels.fallback}`
        );

        console.log(
            speechService
                ? `🗣️ Voz: ${config.tts.voice}`
                : '🔇 Voz desactivada (TTS_ENABLED=false)'
        );

        console.log(
            `🎁 Servicios: ${servicePolicy.menu().map(s => `${s.label} (${s.coins})`).join(' · ')}`
        );

        console.log(
            `🆓 Gratis: 1 respuesta cada ${servicePolicy.free.freeEveryHours} h por persona`
        );

        console.log(
            config.contact.enabled && config.contact.text
                ? `📞 Contacto: visible ${config.contact.visibleSeconds}s cada ${config.contact.everyMinutes} min`
                : '📵 Franja de contacto desactivada (streamer.config.json → contact.enabled)'
        );

        console.log(
            'Esperando eventos...\n'
        );

    } catch (error) {

        console.error(
            '❌ Error iniciando aplicación:',
            error
        );

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

    console.log(
        '\n🛑 Cerrando aplicación...'
    );

    try {

        /*
         * Primero dejamos de recibir eventos nuevos.
         */
        tiktok.disconnect();

        /*
         * Esperamos únicamente el trabajo que ya
         * se encuentre en ejecución.
         */
        await worker.stop();

        console.log(
            '📊 EventProcessor:',
            processor.getStats()
        );

        console.log(
            '📊 QueueWorker:',
            worker.getStats()
        );

        console.log(
            '📊 AIService:',
            aiService.getStats()
        );

        console.log(
            '📊 ResilientAIProvider:',
            aiProvider.getStats()
        );

        console.log(
            `📊 Gemini ${config.aiModels.primary}:`,
            primaryAIProvider.getStats()
        );

        console.log(
            `📊 Gemini ${config.aiModels.fallback}:`,
            fallbackAIProvider.getStats()
        );

        if (speechService) {
            console.log(
                '📊 Voz:',
                speechService.getStats()
            );
        }

        console.log(
            '📊 Servicios:',
            servicePolicy.getStats()
        );

        /* La memoria de apoyo de 24 h no debe perderse al cerrar. */
        await ledgerSaver.flush();

        await gateway.stop();

        console.log(
            '✅ Aplicación cerrada correctamente'
        );

    } catch (error) {

        console.error(
            '❌ Error durante el cierre:',
            error.message
        );
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