import { TikTokLiveAdapter } from './tiktok/TikTokLiveAdapter.js';
import { RealtimeGateway } from './realtime/RealtimeGateway.js';

const config = {
    tiktokUsername: 'maulanimations',
    websocketPort: 8080
};

const gateway = new RealtimeGateway({
    port: config.websocketPort
});

const tiktok = new TikTokLiveAdapter(
    config.tiktokUsername
);

// Todo evento normalizado recibido desde TikTok
// se publica hacia los clientes WebSocket.
tiktok.onEvent(event => {
    console.log(
        `📥 TikTok → ${event.type}`
    );

    gateway.broadcast(event);
});

async function start() {
    try {
        console.log('🚀 Iniciando aplicación...');

        gateway.start();

        console.log(
            `🔌 Conectando con @${config.tiktokUsername}...`
        );

        const session = await tiktok.connect();

        console.log('✅ TikTok conectado');
        console.log(`Room ID: ${session.roomId}`);
        console.log(
            `📡 WebSocket: ws://localhost:${config.websocketPort}`
        );
        console.log('Esperando eventos...\n');

    } catch (error) {
        console.error(
            '❌ Error iniciando aplicación:',
            error
        );

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
        tiktok.disconnect();
        await gateway.stop();

        console.log('✅ Aplicación cerrada correctamente');
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