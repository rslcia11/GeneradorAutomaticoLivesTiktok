# Liveness & Engagement System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que el avatar de TikTok LIVE parezca humano y en constante actividad mediante mensajes autónomos, lecturas espontáneas, cambios de atuendo y trucos del sombrero más frecuentes.

**Architecture:** Nuevo `LivenessWorker` en backend detecta silencio e inyecta eventos `ai_response` / `avatar_shuffle` al gateway. `AnimatedAvatar` y `TarotAvatar` responden a un nuevo evento `outfit_change` con filtros CSS. Truco del sombrero reduce su intervalo de 50–80 s a 18–30 s.

**Tech Stack:** Node.js ESM, PixiJS 8, CSS filters (hue-rotate), setInterval, node:assert/strict

---

## Mapa de archivos

| Archivo | Acción | Responsabilidad |
|---------|--------|-----------------|
| `src/ai/LivenessContent.js` | crear | Catálogo de textos pre-escritos |
| `src/workers/LivenessWorker.js` | crear | Worker autónomo de liveness |
| `src/test-liveness-content.js` | crear | Tests del catálogo |
| `src/test-liveness-worker.js` | crear | Tests del worker |
| `scripts/test-offline.js` | modificar | Registrar nuevas suites |
| `src/app.js` | modificar | Integrar worker, saludos miembros, outfit por regalo |
| `src/overlay/TarotAvatar.js` | modificar | Añadir `setHueShift(deg)` |
| `src/overlay/overlay.js` | modificar | Manejar `outfit_change` y `avatar_shuffle` |
| `src/overlay/animated/AnimatedAvatar.js` | modificar | `setOutfit(id)` + timer trucos |

---

## Task 1: LivenessContent — catálogo de textos

**Files:**
- Create: `src/ai/LivenessContent.js`
- Create: `src/test-liveness-content.js`
- Modify: `scripts/test-offline.js`

- [ ] **Paso 1: Crear `src/ai/LivenessContent.js`**

```js
/**
 * Textos pre-escritos para actividad autónoma del avatar.
 * Sin dependencias externas.
 */

export const INVITATIONS = Object.freeze([
    { text: '¿Tienes una pregunta para las cartas? Escríbela en el chat...', intent: 'invite_share' },
    { text: 'Las energías me dicen que alguien necesita una lectura hoy...', intent: 'invite_share' },
    { text: '¿Qué te tiene preocupado? Las cartas pueden mostrarte el camino...', intent: 'invite_share' },
    { text: 'Siento que hay alguien aquí que necesita un mensaje del destino...', intent: 'invite_share' },
    { text: '¿Hay algo que quieras saber sobre tu futuro? Pregúntame...', intent: 'invite_share' },
    { text: 'Los astros están alineados para dar respuestas hoy. ¿Tienes una pregunta?', intent: 'invite_share' },
    { text: 'Las cartas esperan... ¿quién se atreve a preguntar?', intent: 'invite_share' },
    { text: 'Hay una energía poderosa en el aire. ¿Quién tiene una pregunta pendiente?', intent: 'invite_share' },
    { text: 'El universo tiene mensajes para ti. Solo necesitas preguntar...', intent: 'invite_share' },
    { text: '¿Amor, dinero, trabajo? Las cartas lo revelarán todo...', intent: 'invite_share' },
    { text: 'Comenta tu pregunta y las cartas hablarán por ti...', intent: 'invite_share' },
    { text: 'Siento que alguien aquí lleva una carga en el corazón. ¿Quieres que las cartas te ayuden?', intent: 'invite_share' },
    { text: 'Los espíritus del tarot están inquietos... esperan una pregunta...', intent: 'invite_share' },
    { text: '¿Hay algo importante que necesitas saber? Este es el momento...', intent: 'invite_share' },
    { text: 'Las cartas no mienten. ¿Te atreves a conocer la verdad?', intent: 'invite_share' },
]);

export const READINGS = Object.freeze([
    { card: 'El Sol',                    text: 'El Sol ilumina hoy tu camino. La energía positiva fluye a tu alrededor. Es momento de actuar con confianza.',           intent: 'tarot_reading' },
    { card: 'La Luna',                   text: 'La Luna revela que hay cosas ocultas que pronto saldrán a la luz. Confía en tu intuición.',                              intent: 'tarot_reading' },
    { card: 'El Mago',                   text: 'El Mago aparece: tienes todo lo que necesitas para lograr tus metas. La voluntad es tu herramienta más poderosa.',       intent: 'tarot_reading' },
    { card: 'La Emperatriz',             text: 'La Emperatriz trae abundancia y fertilidad. Nuevos comienzos en el área creativa o familiar están por venir.',           intent: 'tarot_reading' },
    { card: 'El Carro',                  text: 'El Carro indica victoria después de un período de lucha. Mantén el control y avanza con determinación.',                 intent: 'tarot_reading' },
    { card: 'La Justicia',               text: 'La Justicia dice que el equilibrio se restaurará. Lo que has sembrado, cosecharás. La verdad prevalecerá.',              intent: 'tarot_reading' },
    { card: 'La Torre',                  text: 'La Torre anuncia un cambio repentino. Lo que se derrumba era necesario que cayera para que algo mejor se construya.',    intent: 'tarot_reading' },
    { card: 'La Estrella',               text: 'La Estrella trae esperanza y renovación. Después de la tormenta, la calma. Hay luz al final del camino.',                intent: 'tarot_reading' },
    { card: 'El Mundo',                  text: 'El Mundo: un ciclo se completa. Has alcanzado un nivel de maestría. Celebra tus logros.',                               intent: 'tarot_reading' },
    { card: 'El Ermitaño',               text: 'El Ermitaño aconseja introspección. La respuesta que buscas está dentro de ti. Busca la soledad para encontrarla.',     intent: 'tarot_reading' },
    { card: 'La Rueda de la Fortuna',    text: 'La Rueda gira. Los cambios que vienen son parte del ciclo natural. Adáptate y fluye con ellos.',                        intent: 'tarot_reading' },
    { card: 'El Loco',                   text: 'El Loco invita a un nuevo comienzo sin miedo. Da el salto de fe. La aventura te espera.',                               intent: 'tarot_reading' },
    { card: 'Los Amantes',               text: 'Los Amantes señalan una decisión importante del corazón. Elige desde el amor, no desde el miedo.',                      intent: 'tarot_reading' },
    { card: 'La Fuerza',                 text: 'La Fuerza: tienes más poder del que crees. La perseverancia suave vence a la fuerza bruta.',                            intent: 'tarot_reading' },
    { card: 'El Sumo Sacerdote',         text: 'El Sumo Sacerdote trae sabiduría tradicional. Busca consejo de alguien con experiencia. La guía espiritual te acompaña.', intent: 'tarot_reading' },
    { card: 'El Diablo',                 text: 'El Diablo advierte: algo te tiene encadenado. Reconoce ese patrón. Tienes el poder de liberarte.',                      intent: 'tarot_reading' },
    { card: 'El Juicio',                 text: 'El Juicio llama al despertar. Es momento de dejar atrás el pasado y responder a un llamado más elevado.',               intent: 'tarot_reading' },
    { card: 'El Emperador',              text: 'El Emperador trae estructura y liderazgo. Es tiempo de tomar el control de tu situación con disciplina.',               intent: 'tarot_reading' },
    { card: 'El Colgado',                text: 'El Colgado pide pausa y reflexión. A veces es necesario ver las cosas desde otro ángulo antes de actuar.',              intent: 'tarot_reading' },
    { card: 'La Templanza',              text: 'La Templanza invita al equilibrio y la paciencia. Mezcla con cuidado los ingredientes de tu vida. La armonía llega.',   intent: 'tarot_reading' },
]);

export const GREETINGS = Object.freeze([
    u => `¡Bienvenido al círculo místico, ${u}! Las cartas te esperaban...`,
    u => `${u} acaba de llegar. ¡Bienvenido! ¿Tienes una pregunta para el tarot?`,
    u => `Las energías se iluminan con tu llegada, ${u}. ¡Bienvenido!`,
    u => `¡${u}! Los astros anunciaron tu visita. ¡Bienvenido al LIVE!`,
    u => `Hola ${u}. Las cartas tienen un mensaje especial para ti hoy...`,
    u => `¡Qué bueno que llegaste, ${u}! Estábamos esperándote.`,
    u => `El universo te trajo aquí, ${u}. ¡Bienvenido!`,
    u => `${u} entra al círculo. ¡Bienvenido, viajero del destino!`,
    u => `¡${u}! Las cartas se mueven al sentir tu presencia.`,
    u => `Bienvenido, ${u}. Aquí las cartas revelan la verdad...`,
    u => `¡Hola ${u}! ¿Listo para descubrir lo que el tarot tiene para ti?`,
    u => `${u} ha llegado. Las energías del día te dan la bienvenida.`,
]);
```

- [ ] **Paso 2: Crear `src/test-liveness-content.js`**

```js
import assert from 'node:assert/strict';
import { INVITATIONS, READINGS, GREETINGS } from './ai/LivenessContent.js';

let passed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`✅ ${name}`);
    } catch (error) {
        console.error(`❌ ${name}`);
        throw error;
    }
}

test('INVITATIONS tiene 15 entradas', () => {
    assert.equal(INVITATIONS.length, 15);
});

test('Cada INVITATION tiene text e intent invite_share', () => {
    for (const entry of INVITATIONS) {
        assert.equal(typeof entry.text, 'string');
        assert.ok(entry.text.length > 0);
        assert.equal(entry.intent, 'invite_share');
    }
});

test('READINGS tiene 20 entradas', () => {
    assert.equal(READINGS.length, 20);
});

test('Cada READING tiene card, text e intent tarot_reading', () => {
    for (const entry of READINGS) {
        assert.equal(typeof entry.card, 'string');
        assert.equal(typeof entry.text, 'string');
        assert.ok(entry.card.length > 0);
        assert.ok(entry.text.length > 0);
        assert.equal(entry.intent, 'tarot_reading');
    }
});

test('GREETINGS tiene 12 entradas', () => {
    assert.equal(GREETINGS.length, 12);
});

test('Cada GREETING es función que devuelve string con el username', () => {
    for (const fn of GREETINGS) {
        assert.equal(typeof fn, 'function');
        const result = fn('TestUser');
        assert.equal(typeof result, 'string');
        assert.ok(result.includes('TestUser'));
    }
});

test('INVITATIONS, READINGS y GREETINGS son inmutables (Object.isFrozen)', () => {
    assert.ok(Object.isFrozen(INVITATIONS));
    assert.ok(Object.isFrozen(READINGS));
    assert.ok(Object.isFrozen(GREETINGS));
});

console.log(`\n🎯 ${passed}/7 pruebas de LivenessContent superadas correctamente.`);
```

- [ ] **Paso 3: Registrar suite en `scripts/test-offline.js`**

Localiza el array `SUITES` y añade `'liveness-content'` al final (antes del cierre `]`):

```js
// Busca la línea:
    'speech-service'
// Reemplaza por:
    'speech-service',
    'liveness-content'
```

- [ ] **Paso 4: Ejecutar tests**

```bash
node src/test-liveness-content.js
```

Salida esperada: `🎯 7/7 pruebas de LivenessContent superadas correctamente.`

- [ ] **Paso 5: Commit**

```bash
git add src/ai/LivenessContent.js src/test-liveness-content.js scripts/test-offline.js
git commit -m "feat(liveness): add LivenessContent pre-written text catalog"
```

---

## Task 2: LivenessWorker — worker autónomo

**Files:**
- Create: `src/workers/LivenessWorker.js`
- Create: `src/test-liveness-worker.js`
- Modify: `scripts/test-offline.js`

- [ ] **Paso 1: Crear `src/test-liveness-worker.js`** (fallos primero)

```js
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
```

- [ ] **Paso 2: Ejecutar tests — deben FALLAR**

```bash
node src/test-liveness-worker.js
```

Salida esperada: error `Cannot find module './workers/LivenessWorker.js'`

- [ ] **Paso 3: Crear `src/workers/LivenessWorker.js`**

```js
import { randomUUID } from 'node:crypto';
import { INVITATIONS, READINGS, GREETINGS } from '../ai/LivenessContent.js';

const TICK_MS_DEFAULT = 5_000;

export class LivenessWorker {

    constructor({
        gateway,
        silenceThresholdMs = 45_000,
        outfitEveryMs      = 4 * 60_000,
        tickMs             = TICK_MS_DEFAULT,
        onOutfitChange     = null,
        log                = console
    } = {}) {

        if (!gateway || typeof gateway.broadcast !== 'function') {
            throw new Error('LivenessWorker requiere gateway con broadcast()');
        }

        this.gateway            = gateway;
        this.silenceThresholdMs = silenceThresholdMs;
        this.outfitEveryMs      = outfitEveryMs;
        this.tickMs             = tickMs;
        this.onOutfitChange     = typeof onOutfitChange === 'function' ? onOutfitChange : null;
        this.log                = log;

        this.silenceMs    = 0;
        this.outfitMs     = 0;
        this.processing   = false;
        this.running      = false;
        this._interval    = null;

        /* Round-robin para no repetir seguido. */
        this._inviteIdx  = 0;
        this._readingIdx = 0;
    }

    start() {
        if (this.running) return false;

        this.running = true;

        this._interval = setInterval(() => {
            this.silenceMs += this.tickMs;
            this.outfitMs  += this.tickMs;

            if (this.outfitMs >= this.outfitEveryMs) {
                this.outfitMs = 0;
                this.onOutfitChange?.();
            }

            if (
                this.silenceMs >= this.silenceThresholdMs &&
                !this.processing
            ) {
                this.silenceMs = 0;
                this.#emitLiveness();
            }
        }, this.tickMs);

        return true;
    }

    stop() {
        if (!this.running) return;
        clearInterval(this._interval);
        this._interval = null;
        this.running   = false;
    }

    resetSilenceTimer() {
        this.silenceMs = 0;
    }

    setProcessing(bool) {
        this.processing = Boolean(bool);
    }

    #emitLiveness() {
        const r = Math.random();

        if (r < 0.4) {
            this.#emitInvite();
        } else if (r < 0.8) {
            this.#emitReading();
        } else {
            this.#emitShuffle();
        }
    }

    #emitInvite() {
        const entry = INVITATIONS[this._inviteIdx % INVITATIONS.length];
        this._inviteIdx++;

        this.gateway.broadcast({
            platform:        'system',
            type:            'ai_response',
            interactionId:   randomUUID(),
            text:            entry.text,
            intent:          entry.intent,
            audio:           null,
            user:            null,
            source:          null
        });

        this.log.debug?.('🎭 Liveness invite emitido');
    }

    #emitReading() {
        const entry = READINGS[this._readingIdx % READINGS.length];
        this._readingIdx++;

        this.gateway.broadcast({
            platform:        'system',
            type:            'ai_response',
            interactionId:   randomUUID(),
            text:            `✨ ${entry.card}: ${entry.text}`,
            intent:          entry.intent,
            audio:           null,
            user:            null,
            source:          null
        });

        this.log.debug?.('🃏 Liveness reading emitido');
    }

    #emitShuffle() {
        this.gateway.broadcast({
            platform: 'system',
            type:     'avatar_shuffle'
        });

        this.log.debug?.('🔀 Liveness shuffle emitido');
    }
}
```

- [ ] **Paso 4: Ejecutar tests — deben PASAR**

```bash
node src/test-liveness-worker.js
```

Salida esperada: `🎯 10/10 pruebas de LivenessWorker superadas correctamente.`

- [ ] **Paso 5: Registrar suite en `scripts/test-offline.js`**

```js
// Busca la línea:
    'liveness-content'
// Reemplaza por:
    'liveness-content',
    'liveness-worker'
```

- [ ] **Paso 6: Ejecutar suite completa**

```bash
npm test
```

Salida esperada: todas las suites superadas incluyendo `liveness-content` y `liveness-worker`.

- [ ] **Paso 7: Commit**

```bash
git add src/workers/LivenessWorker.js src/test-liveness-worker.js scripts/test-offline.js
git commit -m "feat(liveness): add LivenessWorker autonomous activity worker"
```

---

## Task 3: Integrar LivenessWorker en app.js

**Files:**
- Modify: `src/app.js`

- [ ] **Paso 1: Añadir imports al tope de `src/app.js`**

Busca el bloque de imports existente y añade al final del grupo de imports:

```js
import { LivenessWorker } from './workers/LivenessWorker.js';
import { GREETINGS } from './ai/LivenessContent.js';
```

- [ ] **Paso 2: Añadir variable `memberCounter` y `outfitIndex` tras `const recentDonors = [];`**

Busca la línea:
```js
const recentDonors = [];
```

Añade debajo:
```js
let memberCounter = 0;
let outfitIndex   = 0;

function nextOutfit() {
    outfitIndex = (outfitIndex + Math.floor(Math.random() * 4) + 1) % 5;
    gateway.broadcast({ type: 'outfit_change', paletteId: outfitIndex });
}

function pickGreeting(username) {
    return GREETINGS[Math.floor(Math.random() * GREETINGS.length)](username);
}
```

- [ ] **Paso 3: Crear el LivenessWorker tras la declaración de `gateway`**

Busca el bloque:
```js
const gateway = new RealtimeGateway({
```

Después de cerrar ese bloque (`});`), añade:

```js
const liveness = new LivenessWorker({
    gateway,
    log:                logger,
    silenceThresholdMs: 45_000,
    outfitEveryMs:      4 * 60_000,
    onOutfitChange:     nextOutfit
});
```

- [ ] **Paso 4: Añadir `liveness.resetSilenceTimer()` y manejar eventos `member` en `tiktok.onEvent`**

**4a — resetSilenceTimer en cada evento real.**

Busca en `tiktok.onEvent`:
```js
tiktok.onEvent(event => {

    logger.debug(`📥 TikTok → ${event.type}`);
```

Añade una línea debajo del `logger.debug`:
```js
    liveness.resetSilenceTimer();
```

**4b — Saludo a miembros.**

Busca el bloque existente del regalo (que ya tiene `servicePolicy.registerGift`):
```js
    if (event.type === 'gift') {
        /* Un combo en curso no suma: solo cuenta el evento final. */
        const { coins, counted, balance, service } =
            servicePolicy.registerGift(event);

        if (counted) {
            rememberDonor(event, coins, balance);
            gateway.broadcast(donorBoardEvent());

            logger.info(
                `💎 Apoyo → @${event.user?.username} | ` +
                `regalo "${event.gift?.name}" x${event.gift?.repeatCount ?? 1} = ${coins} ` +
                `(saldo: ${balance}) → desbloquea ${service.label}`
            );
        }
    }
```

Reemplaza ese bloque completo por (añade `nextOutfit()` para regalos grandes y el saludo de miembro al final):
```js
    if (event.type === 'gift') {
        /* Un combo en curso no suma: solo cuenta el evento final. */
        const { coins, counted, balance, service } =
            servicePolicy.registerGift(event);

        if (counted) {
            rememberDonor(event, coins, balance);
            gateway.broadcast(donorBoardEvent());

            logger.info(
                `💎 Apoyo → @${event.user?.username} | ` +
                `regalo "${event.gift?.name}" x${event.gift?.repeatCount ?? 1} = ${coins} ` +
                `(saldo: ${balance}) → desbloquea ${service.label}`
            );

            /* Regalo grande (≥ 50 monedas): cambiar atuendo. */
            if (coins >= 50) {
                nextOutfit();
            }
        }
    }

    /* Saludo a miembros nuevos: 1 de cada 8. */
    if (event.type === 'member') {
        memberCounter = (memberCounter + 1) % 8;

        if (memberCounter === 0) {
            const username =
                event.user?.nickname ||
                event.user?.username ||
                'viajero';

            gateway.broadcast({
                platform:      'system',
                type:          'ai_response',
                interactionId: randomUUID(),
                text:          pickGreeting(username),
                intent:        'invite_share',
                audio:         null,
                user:          event.user ?? null,
                source:        null
            });
        }
    }
```

- [ ] **Paso 5: Sincronizar `liveness.setProcessing()` con el QueueWorker**

Busca el handler del QueueWorker:
```js
    handler: async queueItem => {
```

Al inicio de ese handler (justo antes de `const { event, decision } = queueItem;`), añade:
```js
        liveness.setProcessing(true);
```

Busca el callback `onResult`:
```js
    onResult: async (
        result,
        queueItem
    ) => {
```

Al inicio de `onResult`, añade:
```js
        liveness.setProcessing(false);
```

Busca el callback `onError`:
```js
    onError: async (
        error,
        queueItem
    ) => {
```

Al inicio de `onError`, añade:
```js
        liveness.setProcessing(false);
```

- [ ] **Paso 6: Arrancar y detener liveness en `start()` / `shutdown()`**

En la función `start()`, busca:
```js
        worker.start();
```

Añade inmediatamente después:
```js
        liveness.start();
        logger.info('🎭 LivenessWorker iniciado');
```

En la función `shutdown()`, busca:
```js
        await worker.stop();
```

Añade inmediatamente después:
```js
        liveness.stop();
```

- [ ] **Paso 7: Verificar que la aplicación arranca sin errores**

```bash
node --env-file=.env src/app.js
```

Observa los logs iniciales. Debe aparecer `🎭 LivenessWorker iniciado` sin errores.  
Detén con Ctrl+C.

- [ ] **Paso 8: Commit**

```bash
git add src/app.js
git commit -m "feat(liveness): integrate LivenessWorker, member greetings, outfit on gift"
```

---

## Task 4: TarotAvatar — setHueShift para avatar CSS

**Files:**
- Modify: `src/overlay/TarotAvatar.js`

- [ ] **Paso 1: Añadir `setHueShift(deg)` a `TarotAvatar`**

En `src/overlay/TarotAvatar.js`, localiza el método `idle()`:
```js
    idle() {

        this.setState(
            TarotAvatar.STATES.IDLE,
            {
                status: 'Esperando interacción...'
            }
        );
    }
```

Añade el nuevo método **después** de `idle()` y **antes** de `estimateSpeechDuration`:

```js
    /**
     * Aplica un giro de matiz (hue-rotate) a la imagen del avatar CSS.
     * Solo afecta al avatar CSS; el avatar PixiJS gestiona su propio tint.
     *
     * @param {number} deg  Grados de rotación. 0 = sin filtro.
     */
    setHueShift(deg) {

        if (this.destroyed) {
            return;
        }

        this.image.style.transition = 'filter 1.5s ease';
        this.image.style.filter     = deg === 0 ? '' : `hue-rotate(${deg}deg)`;
    }
```

- [ ] **Paso 2: Añadir test en `src/test-tarot-avatar.js`**

Abre `src/test-tarot-avatar.js`. Localiza el final del archivo (antes del `console.log` final) y añade el siguiente test. Primero observa cuántos tests hay para actualizar el conteo:

```js
// Añadir antes del console.log final:
await test('setHueShift() aplica filter a la imagen', async () => {
    const root   = document.createElement('div');
    const image  = document.createElement('img');
    const status = document.createElement('span');
    const ta     = new TarotAvatar({ root, image, statusElement: status });

    ta.setHueShift(80);
    assert.match(image.style.filter, /hue-rotate\(80deg\)/);

    ta.setHueShift(0);
    assert.equal(image.style.filter, '');
});

await test('setHueShift() no lanza si destroyed', async () => {
    const root  = document.createElement('div');
    const image = document.createElement('img');
    const ta    = new TarotAvatar({ root, image });

    ta.destroy();
    assert.doesNotThrow(() => ta.setHueShift(90));
});
```

Actualiza el número en el `console.log` final del test file: añade 2 al conteo actual (los dos tests nuevos). Ejemplo: si era `🎯 N/N pruebas`, pasa a `🎯 N+2/N+2`.

- [ ] **Paso 3: Ejecutar tests de TarotAvatar**

```bash
node src/test-tarot-avatar.js
```

Todos los tests deben pasar.

- [ ] **Paso 4: Commit**

```bash
git add src/overlay/TarotAvatar.js src/test-tarot-avatar.js
git commit -m "feat(liveness): add TarotAvatar.setHueShift for CSS outfit tinting"
```

---

## Task 5: overlay.js — manejar outfit_change y avatar_shuffle

**Files:**
- Modify: `src/overlay/overlay.js`

- [ ] **Paso 1: Añadir constante `OUTFIT_HUES` al inicio de `overlay.js`**

Busca la línea (cerca del inicio del archivo, tras los imports):
```js
const WS_URL = socketUrl(window.location);
```

Añade debajo:
```js
/* Grados de hue-rotate por paleta de atuendo (5 paletas, índice 0–4). */
const OUTFIT_HUES = Object.freeze([0, -60, 80, 140, 160]);
```

- [ ] **Paso 2: Añadir cases en el switch de `handleEvent`**

Busca el `switch (event.type)` en la función `handleEvent`. Localiza el case `stream_end`:
```js
        case 'stream_end':
            handleStreamEnd();
            break;
```

Añade los dos nuevos cases **antes** del `case 'member'`:

```js
        case 'outfit_change':
            handleOutfitChange(event);
            break;

        case 'avatar_shuffle':
            handleAvatarShuffle();
            break;
```

- [ ] **Paso 3: Añadir las dos funciones handler**

Busca la función `handleStreamEnd()` en el archivo y añade las dos funciones nuevas **después** de ella:

```js
/* ============================================================
   OUTFIT CHANGE
   ============================================================ */

function handleOutfitChange(event) {

    const id = typeof event.paletteId === 'number'
        ? Math.max(0, Math.min(4, Math.floor(event.paletteId)))
        : 0;

    const hue = OUTFIT_HUES[id] ?? 0;

    animatedAvatar?.setOutfit(id);
    avatar.setHueShift(hue);
}


/* ============================================================
   AVATAR SHUFFLE
   ============================================================ */

function handleAvatarShuffle() {

    if (!presenter.isBusy) {
        avatar.idle();
    }
}
```

- [ ] **Paso 4: Verificar que el overlay arranca sin errores de sintaxis**

```bash
node scripts/serve-overlay.js
```

Debe arrancar sin errores. Detén con Ctrl+C.

- [ ] **Paso 5: Commit**

```bash
git add src/overlay/overlay.js
git commit -m "feat(liveness): handle outfit_change and avatar_shuffle events in overlay"
```

---

## Task 6: AnimatedAvatar — setOutfit y timer de trucos

**Files:**
- Modify: `src/overlay/animated/AnimatedAvatar.js`

- [ ] **Paso 1: Añadir constante `OUTFITS` junto a las otras constantes**

En `AnimatedAvatar.js`, busca el bloque de constantes cerca del inicio (junto a `COLORS`, `STATE_PROFILES`, etc.). Añade después de la definición de `CELEBRATION_S`:

```js
/*
 * Paletas de atuendo: filtro CSS aplicado al canvas del mago.
 * Índice 0 = sin filtro (Púrpura clásico original).
 */
const OUTFITS = Object.freeze([
    { hue:   0, sat: 1.0 },   /* 0 — Púrpura clásico  */
    { hue: -60, sat: 1.1 },   /* 1 — Azul medianoche  */
    { hue:  80, sat: 1.2 },   /* 2 — Dorado            */
    { hue: 140, sat: 0.9 },   /* 3 — Rojo oscuro       */
    { hue: 160, sat: 1.1 },   /* 4 — Verde esmeralda   */
]);
```

- [ ] **Paso 2: Añadir el método `setOutfit(id)` a la clase**

Busca el método público `setSpeechLevel(level)`:
```js
    setSpeechLevel(level) {
        this.speech.setExternalLevel(level);
    }
```

Añade el nuevo método **después** de `setSpeechLevel`:

```js
    /**
     * Cambia la paleta de color del canvas mediante un filtro CSS.
     * La transición de 1.5 s ocurre en el compositor del navegador
     * sin costo para el render de PixiJS.
     *
     * @param {number} id  Índice de paleta (0–4).
     */
    setOutfit(id) {

        if (!this.host) {
            return;
        }

        const outfit = OUTFITS[id] ?? OUTFITS[0];

        this.host.style.transition = 'filter 1.5s ease';
        this.host.style.filter     = outfit.hue === 0
            ? ''
            : `hue-rotate(${outfit.hue}deg) saturate(${outfit.sat})`;
    }
```

- [ ] **Paso 3: Reducir el intervalo del truco del sombrero**

Busca la línea en el constructor (dentro de `this.trick = { ... }`):
```js
            timer:   randomBetween(8, 12),     /* segundos hasta el próximo truco */
```

Cámbiala por:
```js
            timer:   randomBetween(6, 10),     /* segundos hasta el próximo truco */
```

Luego busca en `#updateMagicTrick`, al final de la función, la línea:
```js
                tr.timer = randomBetween(50, 80);
```

Cámbiala por:
```js
                tr.timer = randomBetween(18, 30);
```

- [ ] **Paso 4: Verificar el overlay visualmente**

Abre el overlay en el navegador con `?avatar=animado&demo=1`:

```
http://localhost:8080/?avatar=animado&demo=1
```

1. Espera ~10 s — debería dispararse el primer truco del sombrero.
2. Abre DevTools y ejecuta en la consola:
   ```js
   window.animatedAvatar.setOutfit(2)   // Dorado
   ```
   El mago debe cambiar gradualmente a tonos dorados en 1.5 s.
3. Ejecuta `window.animatedAvatar.setOutfit(0)` para volver al púrpura.

- [ ] **Paso 5: Commit**

```bash
git add src/overlay/animated/AnimatedAvatar.js
git commit -m "feat(liveness): add setOutfit(), reduce hat trick interval to 18-30s"
```

---

## Verificación final

- [ ] **Ejecutar suite completa de tests**

```bash
npm test
```

Todas las suites deben pasar, incluyendo `liveness-content` y `liveness-worker`.

- [ ] **Prueba de integración manual**

Arranca la aplicación completa:
```bash
node --env-file=.env src/app.js
```

Abre el overlay en OBS o el navegador: `http://localhost:8080/?avatar=animado`

Verifica:
1. Tras 45 s de silencio → el mago emite una invitación o lectura espontánea (texto aparece en el comment-card).
2. Cada ~4 min → el mago cambia de paleta de color gradualmente.
3. Cada ~18–30 s → truco del sombrero con emoji flotante.
4. Cada 8° visitante (`member` event) → el mago saluda por nombre.
5. Con un regalo grande (≥ 50 monedas) → cambio de atuendo inmediato.
