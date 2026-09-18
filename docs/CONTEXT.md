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

### Servicio (service)

- **Definición:** lo que recibe un espectador a cambio de su apoyo: `{ id, label, coins, level, style, cards, menu }` (`src/rules/serviceCatalog.js`).
- **Invariantes:**
  - Existe siempre un servicio gratis (`coins: 0`).
  - `coins` es lo que **cuesta**; `level` es su jerarquía.
  - `resolveService(catalog, saldo)` elige el de **mayor `level`** que el saldo alcance, **no** el más caro. Por eso un servicio caro con nivel bajo puede volverse inalcanzable.
  - `service.cards` manda sobre la intención de la IA: una lectura paga **siempre** muestra cartas y una respuesta gratis **nunca**.
- **Relacionado:** lo decide **ServicePolicy** a partir del **Saldo**.

### Saldo (balance)

- **Definición:** monedas acumuladas por un espectador en las últimas 24 h (`src/rules/SupportLedger.js`).
- **Invariantes:**
  - Un regalo compra **una** lectura: al responder se **gasta** el costo del servicio.
  - El sobrante queda para la próxima pregunta y vence a las 24 h.
  - Si la respuesta no se entrega (cola llena o IA caída), el saldo se **devuelve** (`ServicePolicy.refund`).
  - Sin saldo: **una** respuesta corta cada 24 h por persona.
- **NO es:** una suscripción. Donar no da 24 h de lecturas.

### Regalo de la sala (tiktokGift)

- **Definición:** un regalo real de TikTok con su nombre, imagen y precio, leído de la sala al conectar (`src/rules/giftCatalog.js`).
- **Invariantes:**
  - Los precios **no se escriben a mano**: cambian por país y se leen del LIVE.
  - En el menú, un servicio solo muestra un regalo si enviarlo desbloquea **exactamente** ese servicio.
  - Solo se muestran imágenes `https`. Si TikTok no responde, el menú usa íconos.
- **NO confundir** con el campo `gift` del catálogo, que es un texto descriptivo del servicio.

### Escenario (stage)

- **Definición:** el lienzo fijo de 540 × 960 px sobre el que se diseña todo el overlay (`src/overlay/stage.js`), escalado entero para caber en la ventana.
- **Invariantes:**
  - La proporción es siempre 9:16, la de TikTok.
  - Dentro del escenario **no se usan `vw`/`vh`** ni media queries de orientación: se usa `cqw`/`cqh` o píxeles.
  - El canvas del mago se redibuja a `renderResolution(escala, dpr)` (tope 2) para no verse borroso en OBS.
- **Relacionado:** la escala viaja en la variable CSS `--stage-scale` y en el evento `stagescale`.

### Acto (phase de las cartas)

- **Definición:** cada tramo de la coreografía de una lectura (`src/overlay/animated/cardChoreography.js`): `summon → shuffle → reveal → hover → dismiss`.
- **Invariantes:**
  - Entre acto y acto no hay saltos: cada uno empieza donde terminó el anterior.
  - `time` se reinicia en cada acto; `clock` corre toda la lectura y gobierna el flotar.
  - Cerrar una lectura **nunca** destapa una carta que no se había revelado.
- **Relacionado:** `cardGeometry.js` proyecta la carta en 3D; `tarotCards.js` solo aplica lo que estos deciden.

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
| **HUD** | Los paneles del LIVE: menú de servicios, últimos en apoyar, franja de contacto, llamado gratis y aviso de IA (`overlay/hud.js`) | La escena del mago |
| **Franja de contacto** | Frase y teléfono del tarotista; sale 15 s después de abrir y se repite cada N minutos | Un cartel fijo: nunca queda permanente en pantalla |
| **Aviso de IA** | Texto legal al pie: TikTok exige etiquetar el contenido generado por IA | Un adorno opcional |
| **Respuesta gratis** | Una respuesta corta por persona cada 24 h, sin regalo | Una lectura de cartas |
| **`streamer.config.json`** | Preferencias del tarotista (frase, teléfono, tiempos). **No se sube a git** | Un archivo de secretos: las claves van en `.env` |
| **Offline suites** | Pruebas que no usan red (`npm test`) | `test-adapter` / `test-gemini*`, que usan servicios reales |
