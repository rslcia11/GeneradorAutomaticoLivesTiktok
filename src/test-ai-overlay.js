import { RealtimeGateway } from './realtime/RealtimeGateway.js';

const PORT = 8080;

const gateway = new RealtimeGateway({
    port: PORT
});

const testEvent = {
    platform: 'system',
    type: 'ai_response',
    timestamp: Date.now(),

    source: {
        platform: 'tiktok',
        type: 'comment',
        timestamp: Date.now()
    },

    user: {
        id: 'test-user-id',
        username: 'usuario_prueba',
        nickname: 'Usuario Prueba'
    },

    text: '¡Hola! Esta es una respuesta de prueba del avatar.',

    ai: {
        provider: 'test',
        model: 'test-model',
        fallbackUsed: false,
        providerIndex: 0
    }
};

async function main() {
    console.log('🧪 Prueba local IA → WebSocket → Overlay');
    console.log(`📡 WebSocket: ws://localhost:${PORT}`);

    gateway.start();

    /*
     * Damos tiempo para abrir/conectar el overlay
     * antes de publicar el evento.
     */
    console.log('');
    console.log('👉 Abre el overlay en el navegador.');
    console.log('⏳ El evento se enviará en 10 segundos...');

    await wait(10000);

    console.log('');
    console.log('📤 Enviando ai_response...');

    gateway.broadcast(testEvent);

    console.log('✅ ai_response enviado');
    console.log(`💬 ${testEvent.text}`);

    /*
     * Dejamos unos segundos para que el navegador
     * procese y muestre el evento.
     */
    await wait(5000);

    console.log('');
    console.log('🛑 Cerrando WebSocket...');

    await gateway.stop();

    console.log('✅ Prueba terminada correctamente');
}

function wait(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

try {
    await main();
} catch (error) {
    console.error(
        '❌ Falló la prueba:',
        error
    );

    try {
        await gateway.stop();
    } catch {
        // El gateway puede no haberse iniciado.
    }

    process.exitCode = 1;
}