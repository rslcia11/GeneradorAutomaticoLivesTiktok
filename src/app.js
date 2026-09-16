import { TikTokLiveAdapter } from './tiktok/TikTokLiveAdapter.js';
import { RealtimeGateway } from './realtime/RealtimeGateway.js';
import { EventProcessor } from './events/EventProcessor.js';
import { EventRuleEngine } from './rules/EventRuleEngine.js';
import { PriorityQueue } from './rules/PriorityQueue.js';
import { QueueWorker } from './workers/QueueWorker.js';

const config = {
    tiktokUsername: 'maulanimations',
    websocketPort: 8080,
    queueMaxSize: 100,
    minGiftDiamondsForPriority: 10,
    workerPollIntervalMs: 100
};

const gateway = new RealtimeGateway({
    port: config.websocketPort
});

const ruleEngine = new EventRuleEngine({
    minGiftDiamondsForPriority:
        config.minGiftDiamondsForPriority
});

const queue = new PriorityQueue({
    maxSize: config.queueMaxSize
});

const processor = new EventProcessor({
    ruleEngine,
    queue,

    onVisualEvent: event => {
        gateway.broadcast(event);
    }
});

/*
 * Handler temporal.
 *
 * En producción esta responsabilidad será sustituida
 * por un servicio independiente (IA, TTS, etc.).
 *
 * Por ahora solo demuestra que el worker consume
 * correctamente la cola.
 */
async function mockHandler(queueItem) {
    const { event, decision } = queueItem;

    console.log(
        `⚙️ Worker procesando → ${event.type} | ` +
        `prioridad=${decision.priority}`
    );

    /*
     * Simulamos una operación asíncrona externa.
     * Por ejemplo, una futura llamada a un modelo de IA.
     */
    await new Promise(resolve => {
        setTimeout(resolve, 300);
    });

    return {
        type: 'mock_response',

        sourceEvent: {
            type: event.type,
            username: event.user?.username ?? null
        },

        text:
            event.type === 'comment'
                ? `Respuesta simulada para: ${event.content}`
                : `Evento ${event.type} procesado`,

        processedAt: Date.now()
    };
}

const worker = new QueueWorker({
    processor,

    handler: mockHandler,

    pollIntervalMs:
        config.workerPollIntervalMs,

    onResult: async (result, queueItem) => {
        console.log(
            `✅ Worker completó → ${queueItem.event.type}`
        );

        console.log(
            `🤖 MOCK → ${result.text}`
        );

        /*
         * Todavía NO publicamos esta respuesta al avatar.
         *
         * Primero queremos demostrar que el ciclo de
         * consumo funciona correctamente.
         */
    },

    onError: async (error, queueItem) => {
        console.error(
            `❌ Worker falló → ${queueItem.event.type}:`,
            error.message
        );
    }
});

const tiktok = new TikTokLiveAdapter(
    config.tiktokUsername
);

tiktok.onEvent(event => {
    console.log(`📥 TikTok → ${event.type}`);

    const result = processor.process(event);

    /*
     * Los eventos QUEUE / PRIORITY también pueden tener
     * representación visual.
     *
     * EventProcessor ya publica los eventos VISUAL mediante
     * onVisualEvent.
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

        const session = await tiktok.connect();

        /*
         * El worker arranca únicamente después de confirmar
         * que la sesión TikTok está conectada.
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
        console.log('Esperando eventos...\n');

    } catch (error) {
        console.error(
            '❌ Error iniciando aplicación:',
            error
        );

        /*
         * Limpieza parcial si el arranque falla.
         */
        try {
            await worker.stop();
        } catch {
            // Worker puede no haberse iniciado.
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
         * Luego esperamos que termine únicamente
         * el trabajo actualmente en ejecución.
         *
         * QueueWorker.stop() no comienza otro trabajo.
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