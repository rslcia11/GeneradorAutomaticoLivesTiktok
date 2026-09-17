import assert from 'node:assert/strict';

import { SpeechService } from './tts/SpeechService.js';

let passed = 0;
let total = 0;

async function test(name, fn) {
    total++;

    try {
        await fn();
        passed++;
        console.log(`✅ ${name}`);
    } catch (error) {
        console.error(`❌ ${name}`);
        throw error;
    }
}

function silentLogger() {
    const warnings = [];

    return { warnings, warn: message => warnings.push(message) };
}


await test('Devuelve el audio en base64 con su mimeType', async () => {
    const service = new SpeechService({
        provider: { synthesize: async () => ({ data: Buffer.from('mp3'), mimeType: 'audio/mpeg' }) }
    });

    assert.deepEqual(await service.synthesizeForOverlay('hola'), {
        mimeType: 'audio/mpeg',
        data: Buffer.from('mp3').toString('base64')
    });
});

await test('Si el proveedor falla: null y aviso con código (la respuesta sigue sin voz)', async () => {
    const logger = silentLogger();

    const service = new SpeechService({
        logger,
        provider: {
            synthesize: async () => {
                const error = new Error('servicio caído');
                error.code = 'TTS_TIMEOUT';
                throw error;
            }
        }
    });

    assert.equal(await service.synthesizeForOverlay('hola'), null);
    assert.match(logger.warnings[0], /TTS_TIMEOUT: servicio caído/);
});

await test('Errores que no son Error (strings) tampoco rompen', async () => {
    const logger = silentLogger();

    const service = new SpeechService({
        logger,
        provider: { synthesize: () => Promise.reject('Timed out') }
    });

    assert.equal(await service.synthesizeForOverlay('hola'), null);
    assert.match(logger.warnings[0], /TTS_ERROR: Timed out/);
});

await test('Exige un provider con synthesize()', () => {
    assert.throws(() => new SpeechService(), /synthesize/);
    assert.throws(() => new SpeechService({ provider: {} }), /synthesize/);
});

await test('getStats delega en el proveedor (null si no tiene)', () => {
    const withStats = new SpeechService({ provider: { synthesize() {}, getStats: () => ({ requests: 3 }) } });
    const withoutStats = new SpeechService({ provider: { synthesize() {} } });

    assert.deepEqual(withStats.getStats(), { requests: 3 });
    assert.equal(withoutStats.getStats(), null);
});


console.log(
    `\n🎯 ${passed}/${total} pruebas de SpeechService superadas correctamente.`
);
