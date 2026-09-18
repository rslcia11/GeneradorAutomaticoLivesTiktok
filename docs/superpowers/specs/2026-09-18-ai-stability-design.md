# Diseño: Estabilidad de la IA — Logging + Circuit Breaker

_Fecha: 2026-09-18_

## Problema

En LIVEs reales, `gemini-3.5-flash-lite` falla en todas las llamadas y siempre responde el modelo de respaldo, gastando el doble de cuota. `ResilientAIProvider` no registra el error, así que la causa es desconocida.

Cuando ambos modelos agotan la cuota (HTTP 429), el worker sigue llamando con cada comentario. El overlay muestra "No pude responder" a cada comentario hasta que la cuota se recupera.

## Objetivo

1. Registrar por qué falla el modelo principal (tarea #1 de STATUS.md).
2. Implementar circuit breaker por proveedor: tras un 429, no llamar a ese modelo hasta que pase el retry-after de Google (tarea #2).
3. Cuando todos los proveedores están bloqueados: pausar el worker y descartar la cola acumulada silenciosamente (sin mostrar error en overlay).

## Decisiones de diseño

- **Descartar comentarios durante bloqueo** (no acumular): cuando la cuota se recupera, los comentarios acumulados tienen > 60 s y son irrelevantes para el público en ese momento.
- **Circuit breaker en `GeminiProvider`** (no en la capa resiliente ni en el worker): cada instancia se autogestiona, mínimo acoplamiento, testeable con reloj simulado.

## Arquitectura

```
GeminiProvider          ResilientAIProvider        QueueWorker
──────────────          ───────────────────        ───────────
#blockedUntil           logging al fallar          blockedUntil
GEMINI_RATE_LIMITED  →  AI_ALL_BLOCKED          →  pausa + drain
retryAfterMs            min(retryAfterMs)           maxItemAgeMs
```

---

## Cambios por archivo

### `src/ai/GeminiProvider.js`

**Campo nuevo:**
```js
#blockedUntil = 0;
```

**Al inicio de `generate()`:**
```js
if (Date.now() < this.#blockedUntil) {
    const retryAfterMs = this.#blockedUntil - Date.now();
    const error = new Error(`Gemini ${this.model} en pausa por cuota agotada`);
    error.code = 'GEMINI_RATE_LIMITED';
    error.retryAfterMs = retryAfterMs;
    throw error;
}
```

**Cuando llega 429 (dentro del bloque `if (!response.ok)`):**
```js
const error = await this.#createHttpError(response);
if (response.status === 429) {
    const retryAfterMs = this.#parseRetryAfter(error.message);
    error.retryAfterMs = retryAfterMs;
    this.#blockedUntil = Date.now() + retryAfterMs;
}
throw error;
```

**Método privado nuevo:**
```js
#parseRetryAfter(message = '') {
    const match = message.match(/retry in (\d+)s/i);
    return match ? Number(match[1]) * 1000 : 60_000;
}
```

**`getStats()` agrega:**
```js
isBlocked: Date.now() < this.#blockedUntil,
blockedUntil: this.#blockedUntil
```

---

### `src/ai/ResilientAIProvider.js`

**`#defaultShouldFallback` agrega:**
```js
if (error?.code === 'GEMINI_RATE_LIMITED') {
    return true;
}
```

**`attempts[]` agrega `retryAfterMs`:**
```js
attempts.push({
    providerIndex: index,
    code: error?.code ?? 'UNKNOWN',
    status: error?.status ?? null,
    message: error?.message ?? null,
    retryAfterMs: error?.retryAfterMs ?? null
});
```

**Logging al hacer fallback (antes de `this.stats.fallbacks++`):**
```js
console.warn(
    `⚠️ Provider ${index} falló` +
    ` | code=${error?.code ?? 'UNKNOWN'}` +
    ` | status=${error?.status ?? '-'}` +
    ` | ${error?.message ?? ''}` +
    ` | usando provider ${index + 1}...`
);
```

**`AI_ALL_BLOCKED` — justo antes del `throw error` del último proveedor:**
```js
const allRateLimited = attempts.every(
    a => a.code === 'GEMINI_RATE_LIMITED' ||
        (a.code === 'GEMINI_HTTP_ERROR' && a.status === 429)
);

if (allRateLimited) {
    const retryAfterMs = Math.min(
        ...attempts.map(a => a.retryAfterMs ?? 60_000)
    );
    const blocked = new Error(
        'Todos los proveedores de IA tienen la cuota agotada'
    );
    blocked.code = 'AI_ALL_BLOCKED';
    blocked.retryAfterMs = retryAfterMs;
    this.stats.failed++;
    throw blocked;
}
```

---

### `src/workers/QueueWorker.js`

**Constructor — parámetro nuevo:**
```js
maxItemAgeMs = 60_000
```
Guardado como `this.maxItemAgeMs`.

**Campos nuevos:**
```js
this.blockedUntil = 0;
this.drainItemsBefore = 0;  // descarta items encolados durante el bloqueo
```

**`#tick()` — al inicio, antes de desencolar:**
```js
const remaining = this.blockedUntil - Date.now();
if (remaining > 0) {
    this.#schedule(Math.min(remaining, 5_000));
    return;
}
```

**`#tick()` — tras desencolar, antes de `this.processing = true`:**
```js
const itemTs = queueItem.event?.timestamp ?? 0;
const age = Date.now() - itemTs;
const isDuringBlock = itemTs > 0 && itemTs < this.drainItemsBefore;
const isStale = age > this.maxItemAgeMs;

if (isDuringBlock || isStale) {
    console.log(
        `🗑️ Descartando ${queueItem.event?.type} ` +
        `(${isDuringBlock ? 'durante bloqueo' : `${Math.round(age / 1000)}s de antigüedad`})`
    );
    this.#schedule(0);
    return;
}
```

**En el `catch` del worker — manejo de `AI_ALL_BLOCKED`:**
```js
if (error?.code === 'AI_ALL_BLOCKED') {
    const retryMs = error.retryAfterMs ?? 60_000;
    this.blockedUntil = Date.now() + retryMs;
    this.drainItemsBefore = this.blockedUntil;
    console.warn(
        `⏸️ IA bloqueada por cuota agotada. ` +
        `Pausa de ${Math.round(retryMs / 1000)}s. ` +
        `Los comentarios durante este período se descartan.`
    );
    this.#schedule(retryMs);
} else {
    this.stats.failed++;
    if (typeof this.onError === 'function') {
        // comportamiento actual
    }
}
```

**`getStats()` agrega:**
```js
blockedUntil: this.blockedUntil
```

---

## Flujo completo ante 429 total

1. `GeminiProvider` (primary) recibe 429 → parsea retry (ej. 14 s) → `#blockedUntil = now + 14s` → lanza `GEMINI_RATE_LIMITED { retryAfterMs: 14000 }`.
2. `ResilientAIProvider` loguea `⚠️ Provider 0 falló | code=GEMINI_RATE_LIMITED` → fallback.
3. `GeminiProvider` (fallback) también bloqueado → lanza `GEMINI_RATE_LIMITED { retryAfterMs: 8000 }`.
4. `ResilientAIProvider` detecta todos rate-limited → lanza `AI_ALL_BLOCKED { retryAfterMs: 8000 }`.
5. `QueueWorker` captura `AI_ALL_BLOCKED` → `blockedUntil = now + 8s` → `#schedule(8000)` → **sin `onError`** (overlay sin error).
6. A los 8 s, timer dispara → `#tick()` → items acumulados tienen > 8 s de edad → `maxItemAgeMs` los descarta → cola vacía → worker reanuda normal.

## Flujo ante 429 solo en primary

1. `GeminiProvider` (primary) recibe 429 → bloqueado.
2. `ResilientAIProvider` → fallback a secondary.
3. Secondary responde OK → resultado normal, `fallbackUsed: true` en metadata.
4. Worker y overlay: sin cambios. El log `⚠️ Provider 0 falló` informa la causa.

---

## Pruebas

Los archivos de prueba existentes siguen en verde sin cambios.

Pruebas nuevas en `src/test-resilient-ai-provider.js` y `src/test-queue-worker.js` (con reloj simulado):

| Caso | Verifica |
|---|---|
| `GeminiProvider` bloqueado → lanza `GEMINI_RATE_LIMITED` sin HTTP | No hace fetch mientras `#blockedUntil` activo |
| Parseo de retry: `"retry in 14s"` → 14 000 ms | Regex correcto |
| Parseo de retry: sin match → 60 000 ms | Default correcto |
| `ResilientAIProvider`: primary falla, fallback OK → `fallbackUsed: true` + log | Log emitido |
| `ResilientAIProvider`: ambos `GEMINI_RATE_LIMITED` → `AI_ALL_BLOCKED` con min retry | Correcto |
| `ResilientAIProvider`: 500 + 429 → **no** `AI_ALL_BLOCKED`, relanza último error | Sin falso positivo |
| `QueueWorker`: `AI_ALL_BLOCKED` → no llama `onError`, sets `blockedUntil` | Sin error en overlay |
| `QueueWorker`: item > `maxItemAgeMs` → descartado silenciosamente | Sin `onError` |

---

## Criterios de "listo"

- [ ] Cada fallo de provider loguea `code`, `status` y mensaje.
- [ ] Tras un 429, `GeminiProvider` no hace HTTP hasta que pase el retry-after.
- [ ] Cuando todos los providers están bloqueados, el overlay no muestra "No pude responder".
- [ ] Los comentarios acumulados durante un bloqueo se descartan cuando el worker reanuda.
- [ ] `npm test` en verde (20 suites existentes + nuevas).
