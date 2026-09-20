# Liveness & Engagement System — Design Spec
**Date:** 2026-09-20  
**Status:** Approved

## Objetivo

Hacer que el avatar de TikTok LIVE parezca humano y en constante actividad para evitar detección como contenido automatizado. Cuatro comportamientos principales: (1) mensajes de invitación al chat, (2) lecturas espontáneas pre-escritas, (3) animaciones idle más frecuentes, (4) saludar espectadores al entrar.

---

## Componentes

### 1. `src/ai/LivenessContent.js` (nuevo)

Catálogo estático de textos pre-escritos. Sin dependencias externas.

```
export const INVITATIONS  — 15 frases de invitación al chat
export const READINGS     — 20 lecturas cortas (carta + mensaje de destino)
export const GREETINGS    — 12 saludos de bienvenida para miembros nuevos
```

Cada `READINGS[i]` tiene forma `{ card, text, intent: 'tarot_reading' }`.  
Cada `INVITATIONS[i]` tiene forma `{ text, intent: 'invite_share' }`.  
Cada `GREETINGS[i]` es una función `(username) => string`.

---

### 2. `src/workers/LivenessWorker.js` (nuevo)

Worker autónomo que opera en paralelo con `QueueWorker`.

**API:**
```js
const lw = new LivenessWorker({ gateway, onOutfitChange, silenceThresholdMs, log })
lw.start()
lw.stop()
lw.resetSilenceTimer()   // llamado por app.js en cada evento TikTok real
lw.setProcessing(bool)   // llamado por app.js en ai_processing / ai_response
```

**Comportamiento:**
- Arranca un interval de 5 s (poll).
- Mantiene `silenceMs` acumulado. Cuando `silenceMs >= silenceThresholdMs` (default 45 000 ms):
  1. Si `processing === true`: espera (no interrumpe).
  2. Elige acción al azar con pesos: invite 40 %, reading 40 %, shuffle 20 %.
  3. **invite**: broadcast `ai_response` con texto de `INVITATIONS` (round-robin).
  4. **reading**: broadcast `ai_response` con texto de `READINGS` (round-robin), `intent: 'tarot_reading'`.
  5. **shuffle**: broadcast `avatar_shuffle` (solo animación, sin texto).
  6. Resetea `silenceMs` a 0.
- Cada 4 min (configurable `outfitEveryMs`): llama `onOutfitChange()`.

**Eventos que emite al gateway:**
- `ai_response` — mismo contrato que el worker de IA. Campos: `type, text, intent, interactionId, user: null, source: null, audio: null`.
- `avatar_shuffle` — nuevo tipo, solo frontend lo consume. Sin campos adicionales.

**No usa la cola de prioridad ni el AIService.** Es un canal paralelo de baja prioridad.

---

### 3. Saludos a miembros — `src/app.js`

El handler `tiktok.onEvent` ya recibe `member` events. Cambio: 1 de cada 8 eventos `member` (contador módulo 8) dispara un `ai_response` de bienvenida usando `GREETINGS`.

```js
// en el bloque switch de tiktok.onEvent
if (event.type === 'member') {
    memberCounter = (memberCounter + 1) % 8;
    if (memberCounter === 0) {
        const username = event.user?.nickname || event.user?.username || 'viajero';
        gateway.broadcast({
            type: 'ai_response',
            interactionId: randomUUID(),
            text: pick(GREETINGS)(username),
            intent: 'invite_share',
            audio: null,
            user: event.user,
            source: null
        });
    }
}
```

---

### 4. Outfit system — `src/overlay/animated/AnimatedAvatar.js`

**5 paletas de color:**

| ID | Nombre | hueShift (deg) | tint overlay |
|----|--------|---------------|--------------|
| 0 | Púrpura clásico | 0 | 0xa87bff |
| 1 | Azul medianoche | -60 | 0x60a5fa |
| 2 | Dorado | +80 | 0xffd98a |
| 3 | Rojo oscuro | +140 | 0xff6b6b |
| 4 | Verde esmeralda | +160 | 0x6ee7b7 |

**Implementación PixiJS:**  
`this.mesh.tint` interpolado suavemente (`tintBlend` 0→1 en 1.5 s) hacia la paleta destino. El aura, bola y chispas también cambian su tint principal.

**Implementación CSS (avatar fallback):**  
`elements.avatar.style.filter = 'hue-rotate(Xdeg)'` con transición CSS 1.5 s.

**Trigger en overlay.js:**  
Nuevo case en `handleEvent`:
```js
case 'outfit_change':
    animatedAvatar?.setOutfit(event.paletteId);
    avatar.setHueShift(OUTFITS[event.paletteId].hueShift);
    break;
```

**Trigger en LivenessWorker:**  
`onOutfitChange()` → `app.js` → `gateway.broadcast({ type: 'outfit_change', paletteId: nextPaletteId })`. La paleta se elige aleatoriamente (no la actual).

---

### 5. Hat trick timer

`AnimatedAvatar.js` línea ~178:
```js
// Antes:
timer: randomBetween(8, 12)     // primera vez
// ...
tr.timer = randomBetween(50, 80)  // entre trucos
// Después:
timer: randomBetween(6, 10)
tr.timer = randomBetween(18, 30)
```

---

### 6. `avatar_shuffle` — frontend

`overlay.js` nuevo case:
```js
case 'avatar_shuffle':
    if (!presenter.isBusy) {
        avatar.idle();   // resetea a idle + animación de barajar
    }
    break;
```

`TarotAvatar` ya tiene `idle()`. El avatar animado responde via `avatarstatechange`. Sin cambios adicionales al rig.

---

## Integración en `app.js`

```js
import { LivenessWorker } from './workers/LivenessWorker.js';
import { LivenessContent } from './ai/LivenessContent.js';

let memberCounter = 0;
let outfitIndex = 0;

const liveness = new LivenessWorker({
    gateway,
    log: logger,
    silenceThresholdMs: 45_000,
    outfitEveryMs: 4 * 60_000,
    onOutfitChange: () => {
        outfitIndex = (outfitIndex + Math.floor(Math.random() * 4) + 1) % 5;
        gateway.broadcast({ type: 'outfit_change', paletteId: outfitIndex });
    }
});

// En tiktok.onEvent — resetear silencio en cada evento real:
liveness.resetSilenceTimer();

// En el bloque de regalo — outfit por regalo grande (≥ 50 coins):
if (event.type === 'gift' && counted && coins >= 50) {
    outfitIndex = (outfitIndex + Math.floor(Math.random() * 4) + 1) % 5;
    gateway.broadcast({ type: 'outfit_change', paletteId: outfitIndex });
}

// En worker.handler (inicio de ai_processing):
liveness.setProcessing(true);

// En worker.onResult y worker.onError:
liveness.setProcessing(false);

// En start():
liveness.start();

// En shutdown():
await liveness.stop();
```

---

## Cambios por archivo

| Archivo | Tipo | Descripción |
|---------|------|-------------|
| `src/ai/LivenessContent.js` | nuevo | Catálogo de textos pre-escritos |
| `src/workers/LivenessWorker.js` | nuevo | Worker autónomo de liveness |
| `src/app.js` | modificado | Integrar LivenessWorker, saludos de miembros, outfit |
| `src/overlay/overlay.js` | modificado | Cases `outfit_change`, `avatar_shuffle` |
| `src/overlay/animated/AnimatedAvatar.js` | modificado | Outfit tints + hat trick timer |
| `src/overlay/TarotAvatar.js` | modificado | `setHueShift()` para avatar CSS fallback |

---

## Fuera de alcance

- Nuevas imágenes/poses de atuendo (requieren assets de arte)
- IA generativa para mensajes de liveness
- Cambio de outfit por comando manual del streamer
