import { RealtimeGateway } from './realtime/RealtimeGateway.js';

const gateway = new RealtimeGateway({
    port: 8080
});

gateway.start();

let counter = 0;

const interval = setInterval(() => {
    counter++;

    const event = {
        platform: 'test',
        type: 'test_event',
        timestamp: Date.now(),
        data: {
            message: `Evento de prueba #${counter}`
        }
    };

    console.log('📡 Enviando:', event);

    gateway.broadcast(event);

}, 3000);

async function shutdown() {
    console.log('\nCerrando prueba...');

    clearInterval(interval);

    try {
        await gateway.stop();
        console.log('✅ Gateway cerrado correctamente');
    } catch (error) {
        console.error('❌ Error cerrando Gateway:', error.message);
    }

    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);