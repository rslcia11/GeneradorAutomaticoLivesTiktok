import { TikTokLiveAdapter } from './tiktok/TikTokLiveAdapter.js';
import { RealtimeGateway } from './realtime/RealtimeGateway.js';
import { EventProcessor } from './events/EventProcessor.js';
import { EventRuleEngine } from './rules/EventRuleEngine.js';
import { PriorityQueue } from './rules/PriorityQueue.js';
import { QueueWorker } from './workers/QueueWorker.js';
import { AIService } from './ai/AIService.js';
import { GeminiProvider } from './ai/GeminiProvider.js';
import { ResilientAIProvider } from './ai/ResilientAIProvider.js';

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
    }
};

/*
 * Configuración sensible.
 *
 * GEMINI_API_KEY debe cargarse desde el entorno:
 * node --env-file=.env .\src\app.js
 */
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

/*
 * Realtime / Overlay
 */
const gateway = new RealtimeGateway({
    port: config.websocketPort
});

/*
 * Reglas y cola
 */
const ruleEngine = new EventRuleEngine({
    minGiftDiamondsForPriority:
        config.minGiftDiamondsForPriority
});

const queue = new PriorityQueue({
    maxSize: config.queueMaxSize
});

/*
 * Procesamiento de eventos
 */
const processor = new EventProcessor({
    ruleEngine,
    queue,

    onVisualEvent: event => {
        gateway.broadcast(event);
    }
});

/*
 * Proveedores Gemini.
 *
 * El modelo Flash-Lite es el principal para priorizar
 * baja latencia en el LIVE.
 *
 * El segundo modelo se utiliza únicamente cuando el
 * principal falla por condiciones transitorias admitidas
 * por ResilientAIProvider.
 */
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

/*
 * Política de resiliencia.
 *
 * Ejemplos:
 * 429 / 5xx / timeout
 *      ↓
 * siguiente provider
 *
 * Errores de configuración como 401/403/404
 * no se ocultan mediante fallback.
 */
const aiProvider =
    new ResilientAIProvider({
        providers: [
            primaryAIProvider,
            fallbackAIProvider
        ]
    });

/*
 * AIService permanece desacoplado del proveedor concreto.
 */
const aiService = new AIService({
    provider: aiProvider,

    /*
     * Debe ser mayor que el timeout individual de un
     * provider para permitir que el fallback tenga
     * oportunidad de ejecutarse.
     *
     * Dos providers × 15 s + margen.
     */
    timeoutMs:
        (config.aiTimeoutMs * 2) + 5000
});

/*
 * Worker consumidor de PriorityQueue.
 *
 * QueueWorker no conoce Gemini ni la estrategia
 * de fallback. Únicamente delega a AIService.
 */
const worker = new QueueWorker({
    processor,

    pollIntervalMs:
        config.workerPollIntervalMs,

    handler: async queueItem => {
        const { event, decision } = queueItem;

        console.log(
            `⚙️ Worker procesando → ${event.type} | ` +
            `prioridad=${decision.priority}`
        );

        return aiService.generateResponse({
            event,

            context: {
                platform: 'tiktok'
            }
        });
    },

    onResult: async (result, queueItem) => {
        console.log(
            `✅ IA completó → ${queueItem.event.type}`
        );

        console.log(
            `🤖 IA → ${result.text}`
        );

        const resilience =
            result.metadata?.resilience;

        if (resilience?.fallbackUsed) {
            console.warn(
                `⚠️ IA respondió mediante fallback | ` +
                `providerIndex=${resilience.providerIndex}`
            );
        }

        /*
         * Todavía NO enviamos la respuesta de IA
         * al avatar.
         *
         * Esa salida tendrá su propio contrato/evento
         * para no mezclar eventos TikTok con respuestas
         * generadas por el sistema.
         */
    },

    onError: async (error, queueItem) => {
        console.error(
            `❌ IA falló → ${queueItem.event.type} | ` +
            `${error.code ?? 'AI_ERROR'}: ${error.message}`
        );
    }
});

/*
 * TikTok
 */
const tiktok = new TikTokLiveAdapter(
    config.tiktokUsername
);

tiktok.onEvent(event => {
    console.log(`📥 TikTok → ${event.type}`);

    const result = processor.process(event);

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

async function start() {
    try {
        console.log('🚀 Iniciando aplicación...');

        gateway.start();

        console.log(
            `🔌 Conectando con @${config.tiktokUsername}...`
        );

        const session =
            await tiktok.connect();

        /*
         * El worker arranca solamente después
         * de confirmar la conexión con TikTok.
         */
        worker.start();

        console.log('✅ TikTok conectado');
        console.log(`Room ID: ${session.roomId}`);

        console.log(
            `📡 WebSocket: ws://localhost:${config.websocketPort}`
        );

        console.log(
            `📦 Capacidad de cola: ${config.queueMaxSize}`
        );

        console.log('⚙️ QueueWorker iniciado');

        console.log(
            `🤖 IA principal: ${config.aiModels.primary}`
        );

        console.log(
            `🛟 IA fallback: ${config.aiModels.fallback}`
        );

        console.log('Esperando eventos...\n');

    } catch (error) {
        console.error(
            '❌ Error iniciando aplicación:',
            error
        );

        /*
         * Limpieza parcial ante fallo durante startup.
         */
        try {
            await worker.stop();
        } catch {
            // Worker puede no haberse iniciado.
        }

        try {
            tiktok.disconnect();
        } catch {
            // TikTok puede no haberse conectado.
        }

        try {
            await gateway.stop();
        } catch {
            // Gateway puede no haberse iniciado completamente.
        }

        process.exit(1);
    }
}

let shuttingDown = false;

async function shutdown() {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    console.log('\n🛑 Cerrando aplicación...');

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

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await start();