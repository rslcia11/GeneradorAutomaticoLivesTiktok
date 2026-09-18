# AI Stability — Circuit Breaker + Logging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar por qué falla el modelo principal de Gemini e implementar un circuit breaker por proveedor que evite llamadas HTTP mientras la cuota está agotada, y descarte silenciosamente los comentarios acumulados durante el bloqueo.

**Architecture:** `GeminiProvider` se autogestiona con `#blockedUntil`: cuando recibe un 429 guarda el retry-after y rechaza llamadas posteriores sin tocar la red. `ResilientAIProvider` ya hace fallback; ahora también loguea cada fallo y lanza `AI_ALL_BLOCKED` cuando todos los providers están rate-limited. `QueueWorker` pausa ante `AI_ALL_BLOCKED` y descarta los items acumulados usando `queuedAt` (campo ya existente en cada elemento de cola).

**Tech Stack:** Node.js ≥ 20.6, ES Modules, `node:assert/strict` (sin framework de tests), `globalThis.fetch` (global nativa de Node 18+).

---

## Mapa de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src/ai/GeminiProvider.js` | Modificar | Exportar `parseRetryAfterMs`, añadir circuit breaker |
| `src/ai/ResilientAIProvider.js` | Modificar | Logging al hacer fallback, lanzar `AI_ALL_BLOCKED` |
| `src/workers/QueueWorker.js` | Modificar | Pausa + descarte silencioso con `queuedAt` |
| `src/test-gemini-provider.js` | Crear | Suite offline para `parseRetryAfterMs` + circuit breaker |
| `src/test-resilient-ai-provider.js` | Modificar | Actualizar test roto + tests nuevos |
| `src/test-queue-worker.js` | Modificar | Tests de bloqueo y descarte |
| `scripts/test-offline.js` | Modificar | Añadir `gemini-provider` a la lista de suites |

---

## Task 1: `GeminiProvider` — circuit breaker

**Files:**
- Create: `src/test-gemini-provider.js`
- Modify: `src/ai/GeminiProvider.js`
- Modify: `scripts/test-offline.js`

---

- [ ] **Step 1.1: Crear `src/test-gemini-provider.js` con tests que fallan**

```js
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
```

---

- [ ] **Step 1.2: Verificar que los tests fallan**

```
node src/test-gemini-provider.js
```

Esperado: `❌ parseRetryAfterMs: "retry in 14s" → 14 000` (y otros). `parseRetryAfterMs` no existe aún.

---

- [ ] **Step 1.3: Exportar `parseRetryAfterMs` como función de módulo en `GeminiProvider.js`**

Añadir ANTES de la clase `GeminiProvider` (después de las constantes existentes):

```js
/**
 * Parsea el tiempo de espera sugerido por Google en el mensaje de un error 429.
 * Ej.: "Please retry in 14s" → 14 000. Sin match → 60 000 (default).
 */
export function parseRetryAfterMs(message = '') {
    const match = message.match(/retry in (\d+)s/i);
    return match ? Number(match[1]) * 1_000 : 60_000;
}
```

---

- [ ] **Step 1.4: Añadir campo privado `#blockedUntil` al constructor de `GeminiProvider`**

En el constructor de `GeminiProvider`, después de `this.stats = { ... }`:

```js
this.#blockedUntil = 0;
```

Y declarar el campo privado al inicio de la clase (antes del constructor):

```js
#blockedUntil = 0;
```

---

- [ ] **Step 1.5: Añadir check de bloqueo al inicio de `generate()`**

En `generate()`, como PRIMERA instrucción (antes de `const style = ...`):

```js
if (Date.now() < this.#blockedUntil) {
    const retryAfterMs = this.#blockedUntil - Date.now();
    const error = new Error(
        `Gemini ${this.model} en pausa por cuota agotada`
    );
    error.code = 'GEMINI_RATE_LIMITED';
    error.retryAfterMs = retryAfterMs;
    throw error;
}
```

---

- [ ] **Step 1.6: Establecer `#blockedUntil` cuando llega 429**

Localizar el bloque `if (!response.ok)` en `generate()`:

```js
if (!response.ok) {
    throw await this.#createHttpError(response);
}
```

Reemplazarlo con:

```js
if (!response.ok) {
    const httpError = await this.#createHttpError(response);

    if (response.status === 429) {
        const retryMs = parseRetryAfterMs(httpError.message);
        httpError.retryAfterMs = retryMs;
        this.#blockedUntil = Date.now() + retryMs;
    }

    throw httpError;
}
```

---

- [ ] **Step 1.7: Actualizar `getStats()` en `GeminiProvider`**

```js
getStats() {
    return {
        ...this.stats,
        model: this.model,
        isBlocked: Date.now() < this.#blockedUntil,
        blockedUntil: this.#blockedUntil
    };
}
```

---

- [ ] **Step 1.8: Añadir `gemini-provider` a la lista de suites en `scripts/test-offline.js`**

Localizar el array `SUITES` y añadir `'gemini-provider'` después de `'resilient-ai-provider'`:

```js
const SUITES = [
    'rules',
    'queue',
    'event-processor',
    'queue-worker',
    'ai-service',
    'resilient-ai-provider',
    'gemini-provider',         // ← añadir aquí
    'intents',
    // ... resto igual ...
];
```

---

- [ ] **Step 1.9: Verificar que los tests de `GeminiProvider` pasan**

```
node src/test-gemini-provider.js
```

Esperado: `🎯 6/6 pruebas de GeminiProvider superadas correctamente.`

---

- [ ] **Step 1.10: Verificar que las suites existentes no se rompieron**

```
npm test
```

Esperado: todas las suites existentes en verde (el nuevo `gemini-provider` también).

---

- [ ] **Step 1.11: Commit**

```
git add src/ai/GeminiProvider.js src/test-gemini-provider.js scripts/test-offline.js
git commit -m "feat(ai): GeminiProvider circuit breaker — pausa tras 429, GEMINI_RATE_LIMITED"
```

---

## Task 2: `ResilientAIProvider` — logging + `AI_ALL_BLOCKED`

**Files:**
- Modify: `src/test-resilient-ai-provider.js`
- Modify: `src/ai/ResilientAIProvider.js`

---

- [ ] **Step 2.1: Actualizar test roto y añadir tests que fallan en `test-resilient-ai-provider.js`**

**2.1.a — Actualizar el test "Metadata registra intento fallido anterior"** (ya existe, va a romperse con los nuevos campos):

Localizar `assert.deepEqual(attempts[0], { providerIndex: 0, code: 'GEMINI_HTTP_ERROR', status: 503 })` y reemplazarlo con:

```js
assert.deepEqual(
    attempts[0],
    {
        providerIndex: 0,
        code: 'GEMINI_HTTP_ERROR',
        status: 503,
        message: 'Provider failed',
        retryAfterMs: null
    }
);
```

**2.1.b — Añadir al final del archivo (antes del `console.log` final) los siguientes tests:**

```js
await test(
    'GEMINI_RATE_LIMITED → hace fallback al siguiente provider',
    async () => {
        const provider = new ResilientAIProvider({
            providers: [
                errorProvider({ code: 'GEMINI_RATE_LIMITED', message: 'Bloqueado' }),
                successProvider('fallback-rate-limited')
            ]
        });

        const result = await provider.generate({});

        assert.equal(result.text, 'fallback-rate-limited');
        assert.equal(result.metadata.resilience.fallbackUsed, true);
    }
);

await test(
    'Ambos providers GEMINI_RATE_LIMITED → lanza AI_ALL_BLOCKED con min retryAfterMs',
    async () => {
        function rateLimitedProvider(retryAfterMs) {
            return {
                async generate() {
                    const error = new Error('Rate limited');
                    error.code = 'GEMINI_RATE_LIMITED';
                    error.retryAfterMs = retryAfterMs;
                    throw error;
                }
            };
        }

        const provider = new ResilientAIProvider({
            providers: [
                rateLimitedProvider(14_000),
                rateLimitedProvider(8_000)
            ]
        });

        await assert.rejects(
            () => provider.generate({}),
            error => {
                assert.equal(error.code, 'AI_ALL_BLOCKED');
                assert.equal(error.retryAfterMs, 8_000);
                return true;
            }
        );
    }
);

await test(
    'Error mixto (503 + GEMINI_RATE_LIMITED) → NO lanza AI_ALL_BLOCKED',
    async () => {
        const provider = new ResilientAIProvider({
            providers: [
                errorProvider({ code: 'GEMINI_HTTP_ERROR', status: 503 }),
                errorProvider({ code: 'GEMINI_RATE_LIMITED', message: 'Rate limited' })
            ]
        });

        await assert.rejects(
            () => provider.generate({}),
            error => {
                assert.notEqual(error.code, 'AI_ALL_BLOCKED');
                return true;
            }
        );
    }
);

await test(
    'Fallback loguea warning con código y proveedor',
    async () => {
        const warnings = [];
        const originalWarn = console.warn;
        console.warn = (...args) => warnings.push(args.join(' '));

        try {
            const provider = new ResilientAIProvider({
                providers: [
                    errorProvider({ code: 'GEMINI_TIMEOUT', message: 'Tardó mucho' }),
                    successProvider('ok')
                ]
            });

            await provider.generate({});

            assert.ok(warnings.length > 0, 'Debe emitir al menos un warning');
            assert.ok(
                warnings[0].includes('Provider 0'),
                `Warning debe mencionar "Provider 0". Recibido: "${warnings[0]}"`
            );
            assert.ok(
                warnings[0].includes('GEMINI_TIMEOUT'),
                `Warning debe incluir el código. Recibido: "${warnings[0]}"`
            );
        } finally {
            console.warn = originalWarn;
        }
    }
);

await test(
    'AI_ALL_BLOCKED contabiliza en stats.failed',
    async () => {
        function rateLimitedProvider() {
            return {
                async generate() {
                    const error = new Error('Rate limited');
                    error.code = 'GEMINI_RATE_LIMITED';
                    error.retryAfterMs = 10_000;
                    throw error;
                }
            };
        }

        const provider = new ResilientAIProvider({
            providers: [
                rateLimitedProvider(),
                rateLimitedProvider()
            ]
        });

        try {
            await provider.generate({});
        } catch { /* esperado */ }

        assert.equal(provider.getStats().failed, 1);
    }
);
```

---

- [ ] **Step 2.2: Verificar que los nuevos tests fallan**

```
node src/test-resilient-ai-provider.js
```

Esperado: varios `❌` (los nuevos tests + el test de metadata roto).

---

- [ ] **Step 2.3: Añadir `message` y `retryAfterMs` al objeto `attempts` en `ResilientAIProvider.js`**

Localizar el bloque `attempts.push(...)` en el `catch`:

```js
attempts.push({
    providerIndex: index,
    code: error?.code ?? 'UNKNOWN',
    status: error?.status ?? null
});
```

Reemplazar con:

```js
attempts.push({
    providerIndex: index,
    code: error?.code ?? 'UNKNOWN',
    status: error?.status ?? null,
    message: error?.message ?? null,
    retryAfterMs: error?.retryAfterMs ?? null
});
```

---

- [ ] **Step 2.4: Añadir logging al hacer fallback en `ResilientAIProvider.js`**

Localizar `this.stats.fallbacks++;` en el `catch`. Añadir el `console.warn` ANTES:

```js
console.warn(
    `⚠️ Provider ${index} falló` +
    ` | code=${error?.code ?? 'UNKNOWN'}` +
    ` | status=${error?.status ?? '-'}` +
    ` | ${error?.message ?? ''}` +
    ` | usando provider ${index + 1}...`
);

this.stats.fallbacks++;
```

---

- [ ] **Step 2.5: Añadir `GEMINI_RATE_LIMITED` a `#defaultShouldFallback`**

En el método `#defaultShouldFallback`, añadir ANTES del bloque `if (error?.code === 'GEMINI_TIMEOUT')`:

```js
if (error?.code === 'GEMINI_RATE_LIMITED') {
    return true;
}
```

---

- [ ] **Step 2.6: Añadir lógica `AI_ALL_BLOCKED` en el bloque `if (!canFallback)`**

Localizar:

```js
if (!canFallback) {
    this.stats.failed++;
    throw error;
}
```

Reemplazar con:

```js
if (!canFallback) {
    const allRateLimited =
        attempts.length > 0 &&
        attempts.every(
            a =>
                a.code === 'GEMINI_RATE_LIMITED' ||
                (a.code === 'GEMINI_HTTP_ERROR' &&
                    a.status === 429)
        );

    if (allRateLimited) {
        const retryAfterMs = Math.min(
            ...attempts.map(
                a => a.retryAfterMs ?? 60_000
            )
        );

        const blockedError = new Error(
            'Todos los proveedores de IA tienen la cuota agotada'
        );

        blockedError.code = 'AI_ALL_BLOCKED';
        blockedError.retryAfterMs = retryAfterMs;

        this.stats.failed++;

        throw blockedError;
    }

    this.stats.failed++;
    throw error;
}
```

---

- [ ] **Step 2.7: Verificar que todos los tests de `ResilientAIProvider` pasan**

```
node src/test-resilient-ai-provider.js
```

Esperado: todos los tests en verde (los originales + los 5 nuevos).

---

- [ ] **Step 2.8: Verificar suite completa**

```
npm test
```

Esperado: todas las suites en verde.

---

- [ ] **Step 2.9: Commit**

```
git add src/ai/ResilientAIProvider.js src/test-resilient-ai-provider.js
git commit -m "feat(ai): ResilientAIProvider — logging de fallback y error AI_ALL_BLOCKED"
```

---

## Task 3: `QueueWorker` — pausa + descarte silencioso

**Files:**
- Modify: `src/test-queue-worker.js`
- Modify: `src/workers/QueueWorker.js`

**Nota:** `QueueWorker` usa `queueItem.queuedAt` (campo ya existente en `EventProcessor.#enqueue`) en lugar de `event.timestamp`. Es más robusto: siempre está definido y representa cuándo el item entró a la cola.

---

- [ ] **Step 3.1: Añadir tests que fallan al final de `test-queue-worker.js`**

Añadir ANTES del `console.log` final (el que dice `🎯 ${passed}/15`):

```js
// 16. AI_ALL_BLOCKED no llama onError ni cuenta como fallo
await test('AI_ALL_BLOCKED → sin onError, establece blockedUntil', async () => {
    const processor = createProcessor();
    let onErrorCalled = false;

    addComment(processor, 'cuota agotada');

    const worker = new QueueWorker({
        processor,
        pollIntervalMs: 10,

        handler: async () => {
            const error = new Error('Cuota agotada');
            error.code = 'AI_ALL_BLOCKED';
            error.retryAfterMs = 15_000;
            throw error;
        },

        onError: async () => {
            onErrorCalled = true;
        }
    });

    worker.start();

    await waitUntil(
        () => worker.blockedUntil > 0,
        { timeoutMs: 500 }
    );

    await worker.stop();

    assert.equal(onErrorCalled, false, 'onError no debe llamarse');
    assert.ok(
        worker.blockedUntil > Date.now(),
        'blockedUntil debe estar en el futuro'
    );
    assert.equal(
        worker.drainItemsBefore,
        worker.blockedUntil
    );
    assert.equal(
        worker.getStats().failed,
        0,
        'No debe contar como fallo'
    );
});


// 17. Worker no desencola mientras está bloqueado
await test('No procesa items mientras blockedUntil está en el futuro', async () => {
    const processor = createProcessor();
    let handlerCalls = 0;

    addComment(processor, 'Bloqueado');

    const worker = new QueueWorker({
        processor,
        pollIntervalMs: 10,
        handler: async () => { handlerCalls++; }
    });

    // Bloquear manualmente antes de arrancar
    worker.blockedUntil = Date.now() + 300;

    worker.start();

    await sleep(100);

    assert.equal(handlerCalls, 0, 'Handler no debe llamarse mientras bloqueado');
    assert.equal(processor.queueSize, 1, 'Item debe seguir en cola');

    await worker.stop();
});


// 18. Item más viejo que maxItemAgeMs se descarta silenciosamente
await test('Item antiguo (> maxItemAgeMs) se descarta sin llamar onError', async () => {
    const processor = createProcessor();
    let handlerCalls = 0;
    let onErrorCalled = false;

    // Añadir item con timestamp antiguo para que queuedAt también sea viejo.
    // Usamos un wrapper que sobreescribe queuedAt después de encolar.
    addComment(processor, 'viejo');

    // Hack: el item ya está en la cola — manipulamos queuedAt directamente
    // accediendo a la cola interna para simular un item que lleva 2 minutos esperando.
    const item = processor.peek();
    item.queuedAt = Date.now() - 120_000; // 2 minutos de antigüedad

    const worker = new QueueWorker({
        processor,
        pollIntervalMs: 10,
        maxItemAgeMs: 60_000,

        handler: async () => { handlerCalls++; },
        onError: async () => { onErrorCalled = true; }
    });

    worker.start();

    await waitUntil(
        () => processor.queueSize === 0,
        { timeoutMs: 500 }
    );

    await worker.stop();

    assert.equal(handlerCalls, 0, 'Handler no debe llamarse para item antiguo');
    assert.equal(onErrorCalled, false, 'onError no debe llamarse para item antiguo');
    assert.equal(worker.getStats().failed, 0, 'No debe contar como fallo');
});


// 19. Item con queuedAt durante bloqueo se descarta al reanudar
await test('Item encolado durante bloqueo se descarta cuando el worker reanuda', async () => {
    const processor = createProcessor();
    let handlerCalls = 0;

    addComment(processor, 'durante-bloqueo');

    const worker = new QueueWorker({
        processor,
        pollIntervalMs: 10,
        handler: async () => { handlerCalls++; }
    });

    // Simular: el bloqueo "acaba de terminar" pero el item fue encolado durante él.
    // drainItemsBefore = ahora → cualquier item con queuedAt < ahora será descartado.
    worker.drainItemsBefore = Date.now() + 1; // +1ms de margen

    worker.start();

    await waitUntil(
        () => processor.queueSize === 0,
        { timeoutMs: 500 }
    );

    await worker.stop();

    assert.equal(handlerCalls, 0, 'Item durante bloqueo no debe procesarse');
});
```

También actualizar el `console.log` final de `test-queue-worker.js` de `15` a `19`:

```js
console.log(
    `\n🎯 ${passed}/19 pruebas de QueueWorker superadas correctamente.`
);
```

---

- [ ] **Step 3.2: Verificar que los nuevos tests fallan**

```
node src/test-queue-worker.js
```

Esperado: los 4 tests nuevos con `❌`. Los 15 existentes siguen en verde.

---

- [ ] **Step 3.3: Añadir campos nuevos al constructor de `QueueWorker`**

En el constructor, añadir `maxItemAgeMs` al destructuring:

```js
constructor({
    processor,
    handler,
    pollIntervalMs = 100,
    maxItemAgeMs = 60_000,
    onResult = null,
    onError = null
} = {}) {
```

Y dentro del constructor, después de `this.onError = onError;`, añadir:

```js
this.maxItemAgeMs = maxItemAgeMs;
this.blockedUntil = 0;
this.drainItemsBefore = 0;
```

---

- [ ] **Step 3.4: Actualizar `getStats()` en `QueueWorker`**

```js
getStats() {
    return {
        ...this.stats,
        running: this.running,
        processing: this.processing,
        queueSize: this.processor.queueSize,
        blockedUntil: this.blockedUntil
    };
}
```

---

- [ ] **Step 3.5: Actualizar `#tick()` en `QueueWorker` — check de bloqueo y descarte**

Localizar el método `#tick()`. Reemplazarlo COMPLETO con:

```js
async #tick() {
    if (!this.running || this.processing) {
        this.#schedule();
        return;
    }

    // Circuit breaker: pausa mientras la cuota esté agotada
    const blockRemaining = this.blockedUntil - Date.now();

    if (blockRemaining > 0) {
        this.#schedule(Math.min(blockRemaining, 5_000));
        return;
    }

    const queueItem = this.processor.next();

    if (!queueItem) {
        this.#schedule();
        return;
    }

    // Descartar items que llegaron durante un bloqueo o son demasiado viejos
    const queuedAt = queueItem.queuedAt ?? 0;
    const age = queuedAt > 0 ? Date.now() - queuedAt : 0;
    const isDuringBlock =
        queuedAt > 0 && queuedAt < this.drainItemsBefore;
    const isStale = age > this.maxItemAgeMs;

    if (isDuringBlock || isStale) {
        console.log(
            `🗑️ Descartando ${queueItem.event?.type} ` +
            `(${isDuringBlock
                ? 'encolado durante bloqueo'
                : `${Math.round(age / 1_000)}s de antigüedad`})`
        );
        this.#schedule(0);
        return;
    }

    this.processing = true;

    let blockRetryMs = null;

    try {
        const result = await this.handler(queueItem);

        this.stats.processed++;

        if (typeof this.onResult === 'function') {
            try {
                await this.onResult(result, queueItem);
            } catch (callbackError) {
                console.error(
                    '❌ Error en onResult:',
                    callbackError
                );
            }
        }

    } catch (error) {
        if (error?.code === 'AI_ALL_BLOCKED') {
            const retryMs = error.retryAfterMs ?? 60_000;
            this.blockedUntil = Date.now() + retryMs;
            this.drainItemsBefore = this.blockedUntil;
            blockRetryMs = retryMs;

            console.warn(
                `⏸️ IA bloqueada por cuota agotada. ` +
                `Pausa de ${Math.round(retryMs / 1_000)}s. ` +
                `Comentarios encolados durante este período se descartan.`
            );

        } else {
            this.stats.failed++;

            if (typeof this.onError === 'function') {
                try {
                    await this.onError(error, queueItem);
                } catch (callbackError) {
                    console.error(
                        '❌ Error en onError:',
                        callbackError
                    );
                }
            } else {
                console.error(
                    '❌ Error procesando elemento de cola:',
                    error
                );
            }
        }

    } finally {
        this.processing = false;

        const delay = blockRetryMs !== null
            ? blockRetryMs
            : (this.processor.queueSize > 0
                ? 0
                : this.pollIntervalMs);

        this.#schedule(delay);
    }
}
```

---

- [ ] **Step 3.6: Verificar que todos los tests de `QueueWorker` pasan**

```
node src/test-queue-worker.js
```

Esperado: `🎯 19/19 pruebas de QueueWorker superadas correctamente.`

---

- [ ] **Step 3.7: Verificar suite completa**

```
npm test
```

Esperado: `✅ 21/21 suites offline superadas.`

---

- [ ] **Step 3.8: Commit**

```
git add src/workers/QueueWorker.js src/test-queue-worker.js
git commit -m "feat(worker): QueueWorker — pausa ante AI_ALL_BLOCKED, descarte silencioso de items viejos"
```

---

## Task 4: Verificación final

- [ ] **Step 4.1: Correr suite completa una última vez**

```
npm test
```

Esperado: todas las suites en verde, incluyendo la nueva `gemini-provider`.

- [ ] **Step 4.2: Verificar que el flujo completo de bloqueo funciona en app.js**

Revisar que `src/app.js` pasa `onError` al `QueueWorker` (línea ~380). El error `AI_ALL_BLOCKED` ya NO llegará a `onError` gracias al cambio en `#tick()` — confirmarlo leyendo el código.

No se requiere cambio en `app.js`. El `onError` existente solo recibirá errores reales (no rate-limit).
