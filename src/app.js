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

const config = {
    tiktokUsername: 'tarotdebeto.co',
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
    }
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

const gateway = new RealtimeGateway({
    port: config.websocketPort
});


/* ============================================================
   REGLAS Y COLA
   ============================================================ */

const ruleEngine = new EventRuleEngine({
    minGiftDiamondsForPriority:
        config.minGiftDiamondsForPriority
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

        return aiService.generateResponse({
            event,

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
                     * Tipo de respuesta: el overlay elige la
                     * animación (p. ej. cartas solo en lecturas).
                     */
                    intent:
                        result.intent,

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