import assert from 'node:assert/strict';
import { LivenessWorker } from './workers/LivenessWorker.js';

let passed = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitUntil(cond, { timeoutMs = 500, intervalMs = 10 } = {}) {
    const start = Date.now();
    while (!cond()) {
        if (Date.now() - start >= timeoutMs) throw new Error('Timeout esperando condición');
        await sleep(intervalMs);
    }
}

async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`✅ ${name}`);
    } catch (error) {
        console.error(`❌ ${name}: ${error.message}`);
        throw error;
    }
}

function makeGateway() {
    const broadcasts = [];
    return {
        broadcasts,
        broadcast(event) { broadcasts.push(event); }
    };
}

// 1. Constructor exige gateway con broadcast
await test('Constructor lanza sin gateway válido', async () => {
    assert.throws(() => new LivenessWorker({}), /gateway/);
    assert.throws(() => new LivenessWorker({ gateway: {} }), /gateway/);
});

// 2. start() devuelve true la primera vez, false si ya está corriendo
await test('start() idempotente', async () => {
    const gw = makeGateway();
    const w = new LivenessWorker({ gateway: gw, silenceThresholdMs: 9999, tickMs: 50 });
    assert.equal(w.start(), true);
    assert.equal(w.start(), false);
    w.stop();
});

// 3. Emite ai_response tras silenceThresholdMs
await test('Emite ai_response tras superar silenceThresholdMs', async () => {
    const gw = makeGateway();
    const w = new LivenessWorker({ gateway: gw, silenceThresholdMs: 60, tickMs: 30 });
    w.start();
    await waitUntil(() => gw.broadcasts.length > 0, { timeoutMs: 800 });
    w.stop();
    const ev = gw.broadcasts[0];
    assert.ok(['ai_response', 'avatar_shuffle'].includes(ev.type), `tipo inesperado: ${ev.type}`);
});

// 4. resetSilenceTimer() reinicia el contador
await test('resetSilenceTimer() reinicia contador de silencio', async () => {
    const gw = makeGateway();
    const w = new LivenessWorker({ gateway: gw, silenceThresholdMs: 80, tickMs: 30 });
    w.start();
    await sleep(50);           // acumula 30–60 ms (menos que el umbral)
    w.resetSilenceTimer();     // reinicia a 0
    await sleep(60);           // sigue siendo insuficiente
    w.stop();
    assert.equal(gw.broadcasts.length, 0, 'No debe emitir si se reinició el timer');
});

// 5. setProcessing(true) bloquea la emisión
await test('setProcessing(true) bloquea emisión aunque haya silencio', async () => {
    const gw = makeGateway();
    const w = new LivenessWorker({ gateway: gw, silenceThresholdMs: 60, tickMs: 30 });
    w.setProcessing(true);
    w.start();
    await sleep(200);
    w.stop();
    assert.equal(gw.broadcasts.length, 0, 'No debe emitir mientras processing=true');
});

// 6. setProcessing(false) libera la emisión
await test('setProcessing(false) permite emisión', async () => {
    const gw = makeGateway();
    const w = new LivenessWorker({ gateway: gw, silenceThresholdMs: 60, tickMs: 30 });
    w.setProcessing(true);
    w.start();
    await sleep(100);
    w.setProcessing(false);
    await waitUntil(() => gw.broadcasts.length > 0, { timeoutMs: 600 });
    w.stop();
    assert.ok(gw.broadcasts.length > 0);
});

// 7. onOutfitChange se llama cada outfitEveryMs
await test('onOutfitChange se llama tras outfitEveryMs', async () => {
    const gw = makeGateway();
    let outfitCalls = 0;
    const w = new LivenessWorker({
        gateway: gw,
        silenceThresholdMs: 9999,
        outfitEveryMs: 70,
        tickMs: 30,
        onOutfitChange: () => { outfitCalls++; }
    });
    w.start();
    await waitUntil(() => outfitCalls >= 1, { timeoutMs: 500 });
    w.stop();
    assert.ok(outfitCalls >= 1);
});

// 8. stop() detiene la actividad
await test('stop() detiene emisiones futuras', async () => {
    const gw = makeGateway();
    const w = new LivenessWorker({ gateway: gw, silenceThresholdMs: 60, tickMs: 30 });
    w.start();
    await waitUntil(() => gw.broadcasts.length > 0, { timeoutMs: 500 });
    const countAfterStop = gw.broadcasts.length;
    w.stop();
    await sleep(150);
    assert.equal(gw.broadcasts.length, countAfterStop, 'No debe emitir después de stop()');
});

// 9. ai_response incluye type, text, intent, interactionId, audio:null
await test('ai_response cumple contrato mínimo', async () => {
    const gw = makeGateway();
    const w = new LivenessWorker({ gateway: gw, silenceThresholdMs: 30, tickMs: 15 });
    w.start();
    // Espera hasta obtener un ai_response (puede tardar varios ticks si salen shuffles)
    await waitUntil(
        () => gw.broadcasts.some(e => e.type === 'ai_response'),
        { timeoutMs: 1500 }
    );
    w.stop();
    const ev = gw.broadcasts.find(e => e.type === 'ai_response');
    assert.equal(typeof ev.text, 'string');
    assert.ok(ev.text.length > 0);
    assert.ok(['invite_share', 'tarot_reading'].includes(ev.intent));
    assert.equal(typeof ev.interactionId, 'string');
    assert.equal(ev.audio, null);
});

// 10. Puede reiniciarse tras stop
await test('Puede reiniciarse tras stop()', async () => {
    const gw = makeGateway();
    const w = new LivenessWorker({ gateway: gw, silenceThresholdMs: 60, tickMs: 30 });
    w.start();
    await waitUntil(() => gw.broadcasts.length > 0, { timeoutMs: 500 });
    w.stop();
    gw.broadcasts.length = 0;
    w.start();
    await waitUntil(() => gw.broadcasts.length > 0, { timeoutMs: 500 });
    w.stop();
    assert.ok(gw.broadcasts.length > 0);
});

console.log(`\n🎯 ${passed}/10 pruebas de LivenessWorker superadas correctamente.`);
