import assert from 'node:assert/strict';

import { SpeechPlayer, base64ToArrayBuffer } from './overlay/SpeechPlayer.js';
import { musicVolumeFrom } from './overlay/AmbientAudio.js';

/*
 * AudioContext falso: Node no tiene Web Audio.
 */

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

function createFakeContext({ state = 'running', resumeTo = 'running', durationS = 2.5, amplitude = 0.1 } = {}) {

    const context = {
        state,
        sources: [],
        decoded: [],
        pendingDecodes: [],
        manualDecode: false,
        destination: {},

        resume() {
            if (resumeTo === 'never') {
                return new Promise(() => {});
            }

            context.state = resumeTo;
            return Promise.resolve();
        },

        close: () => Promise.resolve(),

        createAnalyser: () => ({
            fftSize: 0,
            connect() {},
            getFloatTimeDomainData(target) {
                target.fill(amplitude);
            }
        }),

        decodeAudioData(buffer) {
            context.decoded.push(buffer);

            if (context.manualDecode) {
                return new Promise(resolve => context.pendingDecodes.push(() => resolve({ duration: durationS })));
            }

            return Promise.resolve({ duration: durationS });
        },

        createBufferSource() {
            const source = {
                started: false,
                stopped: false,
                onended: null,
                connect() {},
                disconnect() {},
                start() {
                    source.started = true;
                },
                stop() {
                    source.stopped = true;
                }
            };

            context.sources.push(source);

            return source;
        }
    };

    return context;
}

const AUDIO = { mimeType: 'audio/mpeg', data: Buffer.from('fake mp3').toString('base64') };


await test('base64ToArrayBuffer decodifica los bytes exactos', () => {
    const bytes = new Uint8Array(base64ToArrayBuffer(Buffer.from([0, 255, 16, 7]).toString('base64')));

    assert.deepEqual([...bytes], [0, 255, 16, 7]);
});

await test('play: decodifica, empieza a sonar y devuelve la duración real', async () => {
    const context = createFakeContext({ durationS: 2.5 });
    const player = new SpeechPlayer({ createContext: () => context });

    const result = await player.play(AUDIO);

    assert.deepEqual(result, { durationMs: 2500 });
    assert.equal(context.sources[0].started, true);
    assert.equal(Buffer.from(context.decoded[0]).toString(), 'fake mp3');
    assert.equal(player.playing, true);
});

await test('level: RMS amplificado y limitado a 1; 0 si no suena', async () => {
    const context = createFakeContext({ amplitude: 0.1 });
    const player = new SpeechPlayer({ createContext: () => context, levelGain: 4 });

    assert.equal(player.level, 0);

    await player.play(AUDIO);
    assert.ok(Math.abs(player.level - 0.4) < 1e-6);

    const loud = new SpeechPlayer({ createContext: () => createFakeContext({ amplitude: 0.9 }) });

    await loud.play(AUDIO);
    assert.equal(loud.level, 1);
});

await test('Al terminar el audio deja de sonar', async () => {
    const context = createFakeContext();
    const player = new SpeechPlayer({ createContext: () => context });

    await player.play(AUDIO);
    context.sources[0].onended();

    assert.equal(player.playing, false);
    assert.equal(player.level, 0);
});

await test('stop() corta el audio actual', async () => {
    const context = createFakeContext();
    const player = new SpeechPlayer({ createContext: () => context });

    await player.play(AUDIO);
    player.stop();

    assert.equal(context.sources[0].stopped, true);
    assert.equal(player.playing, false);
});

await test('Un audio nuevo corta al anterior', async () => {
    const context = createFakeContext();
    const player = new SpeechPlayer({ createContext: () => context });

    await player.play(AUDIO);
    await player.play(AUDIO);

    assert.equal(context.sources[0].stopped, true);
    assert.equal(context.sources[1].started, true);
});

await test('stop() mientras decodifica: el audio viejo nunca suena (resuelve null)', async () => {
    const context = createFakeContext();
    const player = new SpeechPlayer({ createContext: () => context });

    context.manualDecode = true;

    const playing = player.play(AUDIO);

    await new Promise(resolve => setImmediate(resolve));
    player.stop();
    context.pendingDecodes[0]();

    assert.equal(await playing, null);
    assert.equal(context.sources.length, 0);
    assert.equal(player.playing, false);
});

await test('Contexto suspendido que se reanuda: suena normal', async () => {
    const context = createFakeContext({ state: 'suspended', resumeTo: 'running' });
    const player = new SpeechPlayer({ createContext: () => context });

    assert.deepEqual(await player.play(AUDIO), { durationMs: 2500 });
});

await test('Navegador bloquea el audio: AUDIO_BLOCKED sin quedarse colgado', async () => {
    const context = createFakeContext({ state: 'suspended', resumeTo: 'never' });
    const player = new SpeechPlayer({ createContext: () => context });

    const started = Date.now();

    await assert.rejects(player.play(AUDIO), { code: 'AUDIO_BLOCKED' });
    assert.ok(Date.now() - started < 2000);
    assert.equal(player.playing, false);
});

await test('Audio sin datos → AUDIO_INVALID', async () => {
    const player = new SpeechPlayer({ createContext: () => createFakeContext() });

    for (const audio of [undefined, {}, { data: '' }, { data: 42 }]) {
        await assert.rejects(player.play(audio), { code: 'AUDIO_INVALID' });
    }
});


/*
 * Música: el volumen se afina desde la URL para no desplegar por un número.
 * El valor por defecto tiene que OÍRSE bajo la voz: ya pasó que quedara en
 * 0.015 y la música desapareciera del LIVE.
 */
await test('?musica= ajusta el volumen en %, con un fondo audible por defecto', async () => {
    const at = query => musicVolumeFrom(new URLSearchParams(query));

    assert.equal(at('?musica=0'), 0, 'sin música');
    assert.equal(at('?musica=25'), 0.25);
    assert.equal(at('?musica=100'), 1);

    /* Fuera de rango, se recorta. */
    assert.equal(at('?musica=500'), 1);
    assert.equal(at('?musica=-10'), 0);

    /* Sin parámetro o con basura, un fondo suave pero audible. */
    for (const query of ['', '?musica=', '?musica=alto', '?otra=1']) {
        const volume = at(query);

        assert.ok(volume >= 0.04 && volume <= 0.12, `${query} → ${volume}`);
    }
});


console.log(
    `\n🎯 ${passed}/${total} pruebas de SpeechPlayer superadas correctamente.`
);
