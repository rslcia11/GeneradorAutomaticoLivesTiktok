import assert from 'node:assert/strict';

import { InteractionPresenter } from './overlay/InteractionPresenter.js';

let passed = 0;
let total = 0;

function test(name, fn) {
    total++;

    try {
        fn();
        passed++;
        console.log(`✅ ${name}`);
    } catch (error) {
        console.error(`❌ ${name}`);
        throw error;
    }
}

/*
 * Reloj simulado: los timers solo avanzan con clock.advance().
 */
function createClock() {
    let now = 0;
    let nextId = 1;

    const timers = new Map();

    return {
        setTimer(callback, ms) {
            const id = nextId++;
            timers.set(id, { at: now + ms, callback });
            return id;
        },

        clearTimer(id) {
            timers.delete(id);
        },

        advance(ms) {
            const target = now + ms;

            for (;;) {
                const due = [...timers]
                    .filter(([, timer]) => timer.at <= target)
                    .sort((a, b) => a[1].at - b[1].at)[0];

                if (!due) {
                    break;
                }

                const [id, timer] = due;

                timers.delete(id);
                now = timer.at;
                timer.callback();
            }

            now = target;
        },

        get activeTimers() {
            return timers.size;
        }
    };
}

const SPEECH_MS = 1000;
const FAILURE_MS = 500;
const THINKING_TIMEOUT_MS = 5000;

function createPresenter(options = {}) {
    const clock = createClock();
    const log = [];

    const presenter = new InteractionPresenter({
        onThinking: event => log.push(`thinking:${event.interactionId}`),
        onSpeaking: (event, durationMs) => log.push(`speaking:${event.text}:${durationMs}`),
        onFailed: event => log.push(`failed:${event.interactionId}`),
        onIdle: () => log.push('idle'),
        estimateDurationMs: () => SPEECH_MS,

        failureDurationMs: FAILURE_MS,
        thinkingTimeoutMs: THINKING_TIMEOUT_MS,

        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,

        ...options
    });

    return { presenter, clock, log };
}

const processing = id => ({ type: 'ai_processing', interactionId: id });
const response = (id, text = `R${id}`) => ({ type: 'ai_response', interactionId: id, text });
const failure = id => ({ type: 'ai_error', interactionId: id });


// 1. Flujo básico
test('processing → response → idle', () => {
    const { presenter, clock, log } = createPresenter();

    presenter.processing(processing('A'));
    presenter.response(response('A'));

    assert.equal(presenter.isBusy, true);

    clock.advance(SPEECH_MS);

    assert.deepEqual(log, [
        'thinking:A',
        `speaking:RA:${SPEECH_MS}`,
        'idle'
    ]);

    assert.equal(presenter.isBusy, false);
    assert.equal(clock.activeTimers, 0);
});


// 2. BUG 1: una interacción nueva ya no corta la respuesta en curso
test('Nueva interacción espera a que termine la respuesta actual', () => {
    const { presenter, clock, log } = createPresenter();

    presenter.processing(processing('A'));
    presenter.response(response('A'));

    // El backend ya empezó con B mientras A se está "diciendo".
    presenter.processing(processing('B'));

    assert.deepEqual(log, [
        'thinking:A',
        `speaking:RA:${SPEECH_MS}`
    ]);

    clock.advance(SPEECH_MS);

    assert.deepEqual(log.slice(2), ['thinking:B']);
});


// 3. BUG 1: respuestas que llegan mientras otra se muestra no se pierden
test('Respuesta que llega durante otra se muestra después, en orden', () => {
    const { presenter, clock, log } = createPresenter();

    presenter.processing(processing('A'));
    presenter.response(response('A'));
    presenter.processing(processing('B'));
    presenter.response(response('B'));

    clock.advance(SPEECH_MS);
    clock.advance(SPEECH_MS);

    assert.deepEqual(log, [
        'thinking:A',
        `speaking:RA:${SPEECH_MS}`,
        `speaking:RB:${SPEECH_MS}`,
        'idle'
    ]);
});


// 4. Error
test('ai_error muestra fallo y libera el turno', () => {
    const { presenter, clock, log } = createPresenter();

    presenter.processing(processing('A'));
    presenter.error(failure('A'));
    presenter.processing(processing('B'));

    clock.advance(FAILURE_MS);

    assert.deepEqual(log, [
        'thinking:A',
        'failed:A',
        'thinking:B'
    ]);
});


// 5. Compatibilidad: respuesta sin interactionId ni processing previo
test('Respuesta sin interactionId se muestra (evento de prueba)', () => {
    const { presenter, clock, log } = createPresenter();

    presenter.response({ type: 'ai_response', text: 'Hola' });

    clock.advance(SPEECH_MS);

    assert.deepEqual(log, [
        `speaking:Hola:${SPEECH_MS}`,
        'idle'
    ]);
});


// 6. Overlay conectado a mitad de la interacción
test('Respuesta con ID desconocido se muestra', () => {
    const { presenter, log } = createPresenter();

    presenter.response(response('X'));

    assert.deepEqual(log, [`speaking:RX:${SPEECH_MS}`]);
});


// 7. Duplicados
test('processing y response duplicados se ignoran', () => {
    const { presenter, clock, log } = createPresenter();

    presenter.processing(processing('A'));
    presenter.processing(processing('A'));
    presenter.response(response('A'));
    presenter.response(response('A'));

    clock.advance(SPEECH_MS);

    assert.deepEqual(log, [
        'thinking:A',
        `speaking:RA:${SPEECH_MS}`,
        'idle'
    ]);
});


// 8. Timeout de THINKING
test('THINKING sin respuesta se libera y la respuesta tardía se ignora', () => {
    const { presenter, clock, log } = createPresenter();

    presenter.processing(processing('A'));

    clock.advance(THINKING_TIMEOUT_MS);

    assert.equal(presenter.isBusy, false);

    presenter.response(response('A'));

    assert.deepEqual(log, ['thinking:A', 'idle']);
    assert.equal(presenter.isBusy, false);
});


// 9. Una respuesta pendiente no interrumpe a la actual
test('Respuesta de interacción en espera no interrumpe la actual', () => {
    const { presenter, log } = createPresenter();

    presenter.processing(processing('A'));
    presenter.processing(processing('B'));
    presenter.response(response('B'));

    assert.deepEqual(log, ['thinking:A']);
});


// 10. Límite de pendientes
test('Con cola llena se descarta la más antigua y su respuesta tardía', () => {
    const { presenter, clock, log } = createPresenter({ maxPending: 2 });

    presenter.processing(processing('A'));   // actual
    presenter.processing(processing('B'));
    presenter.processing(processing('C'));
    presenter.processing(processing('D'));   // descarta B

    presenter.response(response('A'));
    presenter.response(response('B'));        // ignorada
    presenter.response(response('C'));
    presenter.response(response('D'));

    clock.advance(SPEECH_MS * 3);

    assert.deepEqual(log, [
        'thinking:A',
        `speaking:RA:${SPEECH_MS}`,
        `speaking:RC:${SPEECH_MS}`,
        `speaking:RD:${SPEECH_MS}`,
        'idle'
    ]);
});


// 11. reset
test('reset() limpia todo y vuelve a idle', () => {
    const { presenter, clock, log } = createPresenter();

    presenter.processing(processing('A'));
    presenter.processing(processing('B'));
    presenter.reset();

    assert.equal(presenter.isBusy, false);
    assert.equal(clock.activeTimers, 0);
    assert.deepEqual(log, ['thinking:A', 'idle']);
});


// 11b. Resultados tardíos tras reset (fin del LIVE)
test('reset() ignora resultados tardíos de interacciones descartadas', () => {
    const { presenter, log } = createPresenter();

    presenter.processing(processing('A'));
    presenter.processing(processing('B'));
    presenter.reset();

    presenter.response(response('A'));
    presenter.error(failure('B'));

    assert.equal(presenter.isBusy, false);
    assert.deepEqual(log, ['thinking:A', 'idle']);
});


// 12. reset sin actividad no llama idle
test('reset() sin actividad no emite idle', () => {
    const { presenter, log } = createPresenter();

    presenter.reset();

    assert.deepEqual(log, []);
});


// 13. Sin IDs, cada respuesta se asocia a la interacción en curso
test('Sin interactionId, response resuelve la interacción en THINKING', () => {
    const { presenter, clock, log } = createPresenter();

    presenter.processing({ type: 'ai_processing' });
    presenter.response({ type: 'ai_response', text: 'Hola' });

    clock.advance(SPEECH_MS);

    assert.deepEqual(log, [
        'thinking:undefined',
        `speaking:Hola:${SPEECH_MS}`,
        'idle'
    ]);
});


// Voz: la duración real del audio reemplaza la estimación
test('speechStarted: la respuesta dura lo que el audio + la pausa final', () => {
    const { presenter, clock, log } = createPresenter({ speechTailMs: 100 });
    const answer = response('A');

    presenter.processing(processing('A'));
    presenter.response(answer);

    clock.advance(50);
    assert.equal(presenter.speechStarted(answer, 3000), true);

    // La estimación (1000 ms) ya no termina la respuesta.
    clock.advance(3000);
    assert.equal(presenter.isBusy, true);

    clock.advance(100);
    assert.deepEqual(log.at(-1), 'idle');
    assert.equal(presenter.isBusy, false);
});

test('speechStarted tardío (otra interacción en curso) se ignora', () => {
    const { presenter, clock, log } = createPresenter();
    const answerA = response('A');

    presenter.processing(processing('A'));
    presenter.response(answerA);
    presenter.processing(processing('B'));
    presenter.response(response('B'));

    clock.advance(SPEECH_MS);
    assert.equal(log.at(-1), `speaking:RB:${SPEECH_MS}`);

    // El audio de A terminó de decodificar tarde: no alarga B.
    assert.equal(presenter.speechStarted(answerA, 9000), false);

    clock.advance(SPEECH_MS);
    assert.equal(log.at(-1), 'idle');
});

test('speechStarted ignora duraciones inválidas y estados sin respuesta', () => {
    const { presenter } = createPresenter();
    const answer = response('A');

    presenter.processing(processing('A'));
    assert.equal(presenter.speechStarted(answer, 1000), false);

    presenter.response(answer);

    for (const duration of [0, -5, NaN, Infinity, '2000']) {
        assert.equal(presenter.speechStarted(answer, duration), false);
    }

    // Un objeto distinto con el mismo ID no cuenta.
    assert.equal(presenter.speechStarted(response('A'), 1000), false);
});


// 14. Validación de callbacks
test('Constructor exige callbacks', () => {
    assert.throws(
        () => new InteractionPresenter({}),
        /onThinking/
    );
});


// 15. Validación de maxPending
test('Constructor valida maxPending', () => {
    assert.throws(
        () => createPresenter({ maxPending: 0 }),
        /maxPending/
    );
});


console.log(
    `\n🎯 ${passed}/${total} pruebas de InteractionPresenter superadas correctamente.`
);
