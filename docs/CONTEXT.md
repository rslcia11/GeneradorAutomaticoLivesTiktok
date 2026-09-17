# Contexto del dominio — Generador Automático de Lives de TikTok

Glosario de los términos **tal como se usan en este código**. Es solo vocabulario: el funcionamiento está en el [README](../README.md) y el estado en [STATUS.md](STATUS.md).

Si un término cambia de significado, actualiza su entrada. Si aparece una entidad central nueva, agrégala.

---

## Entidades

### Evento (event)

- **Definición:** algo que ocurre en el LIVE (comentario, regalo, like, follow, share, suscripción, espectadores, fin de LIVE), normalizado por `TikTokLiveAdapter` a `{ platform, type, timestamp, user, ... }`.
- **Invariantes:** siempre tiene `type` (string). Los tipos válidos son `comment`, `gift`, `like`, `follow`, `share`, `member`, `room_user`, `subscription` y `stream_end`.
- **Relacionado:** lo evalúa **EventRuleEngine** y produce una **Decisión**.

### Decisión (decision)

- **Definición:** qué hacer con un evento: `{ action, priority, reason, event }`.
- **Invariantes:**
  - `action` ∈ `ignore | visual | queue | priority`.
  - `priority` ∈ `10 (LOW) | 50 (NORMAL) | 80 (HIGH) | 100 (CRITICAL)`.
- **Relacionado:**
  - `visual` se envía directo al overlay.
  - `queue` y `priority` entran a la **Cola**.

### Cola (PriorityQueue) / Elemento de cola (queue item)

- **Definición:** eventos que esperan respuesta de la IA, ordenados por prioridad. Un elemento es `{ event, decision }`, y al procesarse recibe un **interactionId**.
- **Invariantes:**
  - Capacidad máxima de 100 elementos. Si está llena y llega un evento de **mayor** prioridad, se saca el de menor prioridad; si llega uno de prioridad igual o menor, se descarta el nuevo.
  - `QueueWorker` procesa **un elemento a la vez**.
- **Relacionado:** `QueueWorker` convierte cada elemento en una **Interacción**.

### Interacción (interaction)

- **Definición:** el ciclo completo de responder a un evento de la cola:
  1. `ai_processing` (el mago piensa).
  2. `ai_response` (habla) o `ai_error` (falla).
  3. Termina cuando acaba la voz o su duración estimada.
- **Invariantes:**
  - Los tres eventos de una interacción comparten el mismo `interactionId` (UUID).
  - En el overlay solo se presenta **una interacción a la vez**, en orden.
- **Relacionado:** la orquesta **InteractionPresenter** en el overlay.

### Intención (intent)

- **Definición:** el tipo de respuesta que dio la IA, usado para elegir la pose y si salen las cartas.
- **Invariantes:**
  - Valores posibles: `tarot_reading | thanks | comment | invite_share` (`src/ai/intents.js`).
  - Regalos y suscripciones son **siempre** `thanks`.
  - Si el valor es inválido o falta, es `comment`.
- **Relacionado:** determina la **Pose**. Las **Cartas flotantes** salen solo con `tarot_reading`.

### Estado del avatar (avatar state)

- **Definición:** en qué está el mago, según `TarotAvatar`.
- **Invariantes:**
  - Valores posibles: `idle | listening | thinking | speaking | reacting`.
  - Hay un solo estado a la vez.
  - Cada cambio emite el evento DOM `avatarstatechange` con `{ state, intent }`.
- **Relacionado:** junto con la intención, define la **Pose**.

### Pose

- **Definición:** una imagen completa del mago en un gesto, generada con IA y **alineada píxel a píxel** con la imagen base (981 × 1602).
- **Invariantes:**
  - `base` es la imagen original.
  - Las demás poses están en `assets/poses/` y registradas en `POSE_FILES` (`animated/poses.js`).
  - Todas comparten la misma malla de deformación.
  - Una pose que no carga no rompe nada: se muestra `base`.
- **Relacionado:** `selectPose(state, intent)` la elige y **PoseBlender** hace la transición.

### Proveedor (provider)

- **Definición:** adaptador intercambiable a un servicio externo.
- **Invariantes:**
  - **IA:** `generate(input) → { text, intent, metadata }`.
  - **Voz:** `synthesize(text) → { data: Buffer, mimeType }`.
- **Relacionado:**
  - `AIService` envuelve `ResilientAIProvider`, que prueba `GeminiProvider` principal y luego el de respaldo.
  - `SpeechService` envuelve `EdgeTTSProvider`.

---

## Glosario

| Término | Significa | NO significa |
|---|---|---|
| **Overlay** | La página web (`src/overlay/`) que OBS muestra encima del stream | El backend ni la app de TikTok |
| **Gateway** | `RealtimeGateway`: WebSocket del backend al overlay en `127.0.0.1:8080` | Una API pública; no acepta mensajes entrantes |
| **Evento visual** | Evento que se muestra sin pasar por la IA (likes, follows, shares) | Un evento ignorado |
| **Celebración** (`celebrate`) | Efecto visual superpuesto (estrellas, anillos) por regalo, follow, share o suscripción | Un cambio de estado: no interrumpe al mago |
| **Reaccionar** (`reacting`) | Estado breve del avatar ante un evento cuando no está ocupado | Una respuesta de IA |
| **Presenter** | `InteractionPresenter`: único dueño del **tiempo** de cada interacción | Un componente visual; no toca el DOM |
| **Duración estimada** | Tiempo de habla calculado por cantidad de palabras, usado si no hay audio | La duración real, que la da la voz con `speechStarted` |
| **Voz / TTS** | Audio MP3 de la respuesta, generado por Edge TTS y enviado en base64 dentro de `ai_response.audio` | Un requisito: si falla, la respuesta sale en texto |
| **Nivel de voz** (speech level) | Volumen real (0..1) de la voz en cada cuadro, que abre la boca del mago | El ritmo sintético de sílabas, que se usa solo sin audio |
| **Fallback** | Usar el modelo Gemini de respaldo cuando falla el principal | Reintentar con el mismo modelo |
| **Rig / deformador** (deformer) | Zonas de la malla que se mueven por código (respiración, cabeza, boca, parpadeo, gato, vela) en `wizardRig.js` | Huesos de un esqueleto 3D |
| **`baseOnly`** | Deformador anclado a la imagen base (manos, ojos), atenuado cuando se ve otra pose | Un deformador desactivado |
| **Pin** | Zona de la malla que **nunca** se deforma (bola, mesa) | Un deformador |
| **PoseBlender** | Transición entre poses: la nueva aparece encima y descarta las de abajo | Una mezcla entre todas las poses a la vez |
| **Cartas flotantes** (FloatingCards) | Arcanos dibujados por código que aparecen solo en `tarot_reading` | Las cartas pintadas sobre la mesa en la imagen |
| **Offline suites** | Pruebas que no usan red (`npm test`) | `test-adapter` / `test-gemini*`, que usan servicios reales |
