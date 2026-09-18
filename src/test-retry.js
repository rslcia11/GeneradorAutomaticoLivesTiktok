import assert from 'node:assert/strict';

import { retryWithBackoff } from './tiktok/retryWithBackoff.js';

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

/* Reloj falso: registra las esperas en vez de dormir. */
function fakeSleep() {
    const waits = [];

    return { waits, sleep: async ms => { waits.push(ms); } };
}

/* Falla `failures` veces y luego responde `value`. */
function flaky(failures, value = 'ok') {
    let calls = 0;

    const attempt = async () => {
        calls++;

        if (calls <= failures) {
            throw new Error(`fallo ${calls}`);
        }

        return value;
    };

    return { attempt, calls: () => calls };
}


await test('A la primera: no espera nada', async () => {
    const { waits, sleep } = fakeSleep();

    assert.equal(await retryWithBackoff(flaky(0).attempt, { sleep }), 'ok');
    assert.deepEqual(waits, []);
});

await test('Espera creciente entre intentos: base, ×2, ×4', async () => {
    const { waits, sleep } = fakeSleep();

    assert.equal(await retryWithBackoff(flaky(3).attempt, { baseDelayMs: 5000, sleep }), 'ok');
    assert.deepEqual(waits, [5000, 10_000, 20_000]);
});

await test('Con tope de intentos, rechaza con el último error', async () => {
    const { sleep } = fakeSleep();
    const { attempt, calls } = flaky(99);

    await assert.rejects(retryWithBackoff(attempt, { maxAttempts: 3, sleep }), /fallo 3/);
    assert.equal(calls(), 3);
});

await test('maxAttempts 0 = para siempre, y la espera no pasa del tope', async () => {
    const { waits, sleep } = fakeSleep();

    /* 20 fallos: con "0 intentos" mal interpretado, esto rechazaba al instante. */
    assert.equal(await retryWithBackoff(flaky(20).attempt, { maxAttempts: 0, baseDelayMs: 5000, maxDelayMs: 120_000, sleep }), 'ok');
    assert.equal(waits.length, 20);
    assert.equal(Math.max(...waits), 120_000);
});

await test('Si se detiene la app, deja de reintentar y resuelve undefined', async () => {
    const { sleep } = fakeSleep();
    const { attempt, calls } = flaky(99);
    let stop = false;

    const result = await retryWithBackoff(attempt, {
        maxAttempts: 0,
        stopped: () => stop,
        onRetry: ({ attempt: n }) => { if (n === 2) stop = true; },
        sleep
    });

    assert.equal(result, undefined);
    assert.equal(calls(), 2);
});

await test('onRetry recibe el intento, el error y la espera', async () => {
    const { sleep } = fakeSleep();
    const seen = [];

    await retryWithBackoff(flaky(1).attempt, { baseDelayMs: 100, sleep, onRetry: info => seen.push(info) });

    assert.equal(seen.length, 1);
    assert.equal(seen[0].attempt, 1);
    assert.equal(seen[0].delayMs, 100);
    assert.match(seen[0].error.message, /fallo 1/);
});


console.log(`\n🎯 ${passed}/${total} pruebas de reintentos superadas correctamente.`);
