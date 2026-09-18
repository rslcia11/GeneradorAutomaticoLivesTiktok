import assert from 'node:assert/strict';
import { parseRetryAfterMs, GeminiProvider } from './ai/GeminiProvider.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`✅ ${name}`);
    } catch (error) {
        failed++;
        console.error(`❌ ${name}`);
        console.error(`   ${error.message}`);
    }
}

// ── parseRetryAfterMs ──────────────────────────────────────────

await test('parseRetryAfterMs: "retry in 14s" → 14 000', async () => {
    assert.equal(
        parseRetryAfterMs('Please retry in 14s'),
        14_000
    );
});

await test('parseRetryAfterMs: "retry in 60s" dentro de texto → 60 000', async () => {
    assert.equal(
        parseRetryAfterMs('Quota exceeded. Please retry in 60s after billing fix.'),
        60_000
    );
});

await test('parseRetryAfterMs: sin match → default 60 000', async () => {
    assert.equal(parseRetryAfterMs('You exceeded your current quota'), 60_000);
    assert.equal(parseRetryAfterMs(''), 60_000);
    assert.equal(parseRetryAfterMs(), 60_000);
});

// ── Circuit breaker ────────────────────────────────────────────

await test('Tras 429, isBlocked=true y la siguiente llamada lanza GEMINI_RATE_LIMITED sin HTTP', async () => {
    const originalFetch = globalThis.fetch;

    let fetchCalls = 0;

    globalThis.fetch = async () => {
        fetchCalls++;
        return {
            ok: false,
            status: 429,
            json: async () => ({
                error: { message: 'Please retry in 14s' }
            })
        };
    };

    const provider = new GeminiProvider({
        apiKey: 'test-key',
        model: 'gemini-test',
        timeoutMs: 5_000
    });

    const event = {
        type: 'comment',
        content: 'Hola',
        user: { username: 'tester' }
    };

    // Primera llamada: debe recibir GEMINI_HTTP_ERROR + establecer bloqueo
    let firstError;

    try {
        await provider.generate({ event });
    } catch (e) {
        firstError = e;
    }

    assert.equal(firstError?.code, 'GEMINI_HTTP_ERROR');
    assert.equal(firstError?.status, 429);
    assert.equal(firstError?.retryAfterMs, 14_000);
    assert.equal(provider.getStats().isBlocked, true);
    assert.ok(provider.getStats().blockedUntil > Date.now());

    // Segunda llamada: debe lanzar GEMINI_RATE_LIMITED sin hacer HTTP
    const fetchCallsBeforeSecond = fetchCalls;

    let secondError;

    try {
        await provider.generate({ event });
    } catch (e) {
        secondError = e;
    }

    assert.equal(secondError?.code, 'GEMINI_RATE_LIMITED');
    assert.ok(secondError?.retryAfterMs > 0);
    assert.equal(fetchCalls, fetchCallsBeforeSecond, 'No debe hacer HTTP durante bloqueo');

    globalThis.fetch = originalFetch;
});

await test('Sin 429, isBlocked=false', async () => {
    const provider = new GeminiProvider({
        apiKey: 'test-key',
        model: 'gemini-test',
        timeoutMs: 5_000
    });

    assert.equal(provider.getStats().isBlocked, false);
    assert.equal(provider.getStats().blockedUntil, 0);
});

// ── getStats ───────────────────────────────────────────────────

await test('getStats incluye model, isBlocked y blockedUntil', async () => {
    const provider = new GeminiProvider({
        apiKey: 'test-key',
        model: 'gemini-test',
        timeoutMs: 5_000
    });

    const stats = provider.getStats();

    assert.equal(stats.model, 'gemini-test');
    assert.ok('isBlocked' in stats);
    assert.ok('blockedUntil' in stats);
});

// ──────────────────────────────────────────────────────────────

console.log('\n────────────────────────────────────────');
console.log(`🎯 ${passed}/${passed + failed} pruebas de GeminiProvider superadas correctamente.`);

if (failed > 0) {
    process.exitCode = 1;
}
