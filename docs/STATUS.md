# Estado del proyecto — Generador Automático de Lives de TikTok

_Última actualización: 2026-09-18. Actualizar al cerrar cualquier cambio relevante._



## Dónde estamos

**MVP funcional, probado en LIVEs reales.** El mago responde con IA y voz a comentarios y regalos, cambia de pose según la intención, muestra cartas de tarot en 3D durante las lecturas y celebra follows y shares. Los regalos desbloquean servicios; en pantalla hay menú de regalos, tabla de últimos donantes, aviso de IA, franja de contacto, cartel de consulta privada, puesto en la fila y barra de respuesta.

**Modelo de entrega decidido (2026-09-18, [ADR 0001](adr/0001-overlay-alojado.md)):** el desarrollador aloja el backend en un servidor; el tarotista (cliente) **solo pega una URL en OBS**. Un proceso por cliente (`tarot@beto`), Caddy con HTTPS, clave secreta por overlay. El código ya está listo para eso y probado en navegador; **falta el servidor** (Oracle Always Free o Hetzner) y el dominio, que los provee el desarrollador. Guía: [DEPLOY.md](DEPLOY.md).

**En los LIVEs reales** el circuit breaker y los agradecimientos sin IA ya redujeron los "No pude responder", pero los picos (5 comentarios en 3 s) siguen chocando con el límite por minuto de la capa gratis de Gemini. La solución es activar facturación (~$5/mes por cliente).

## Roadmap

| Etapa | Estado | Notas |
|---|---|---|
| 1. Efectos visuales (VFX) | ✅ Hecho | Aura, bola, chispas, anillos, celebraciones |
| 2. Voz (TTS) | 🔄 Funciona, falta timbre | Edge TTS `es-MX-JorgeNeural` con labios sincronizados. **El dueño rechazó el timbre**: quiere voz de viejo sabio y Edge TTS no la tiene |
| 3. Cartas de tarot | ✅ Hecho | Volteo 3D con perspectiva real, haz de luz, onda de choque, brillo, 14 arcanos dibujados por código |
| 4. Economía de regalos + HUD | ✅ Hecho | Saldo por espectador, menú con los regalos reales de TikTok, tabla de donantes, contacto |
| 5. Escenario responsivo | ✅ Hecho | Lienzo fijo 9:16 escalado: idéntico en OBS, celular y monitor horizontal |
| 6. Estabilidad de la IA | ⏳ **Siguiente y urgente** | Cuota agotada, modelo principal fallando, sin pausa ante `429` |
| 7. Arte de la escena | ⏳ Decidido: **anime** | Regenerar base y poses en estilo anime, alineadas píxel a píxel |
| 8. Producción | 🔄 Código listo, falta servidor | ✅ Logging, reconexión, gateway con clave y CSP, `deploy/` con Caddy + systemd. Pendiente: provisionar servidor y dominio, primer cliente |

## Hecho

- **Pipeline TikTok → IA → overlay:** reglas, cola con prioridad, worker serial, Gemini con modelo de respaldo y salida JSON `{ intent, text }`.
- **Economía de regalos** (`src/rules/`):
  - Un regalo compra **una** lectura: las monedas son un saldo que se gasta en el mejor servicio que alcance; el sobrante se acumula y vence a las 24 h.
  - Sin regalos: **una** respuesta corta por persona cada 24 h. Las siguientes preguntas se descartan **antes** de llamar a la IA (también ahorra cuota).
  - Se cobra al aceptar el comentario y se **devuelve** si la cola lo descarta o la IA falla.
  - Los combos de regalo solo cuentan en el evento final (si no, 10 rosas contarían 55 monedas).
  - El saldo se guarda en `./data/support-ledger.json` con escritura atómica.
- **Regalos reales de TikTok** (`src/rules/giftCatalog.js`): al conectar se pide la lista de la sala (`gift/list/`) y cada servicio muestra el regalo más barato que desbloquea **exactamente** ese servicio, con su imagen y precio reales. Si TikTok no responde, el menú usa íconos.
- **Overlay:**
  - **Escenario fijo 9:16** (540 × 960, `src/overlay/stage.js`) escalado entero. El canvas del mago se redibuja a la nitidez de la escala (×2 en OBS).
  - **Cartas 3D** (`animated/cardGeometry.js`, `cardChoreography.js`, `cardArt.js`): mallas proyectadas con cámara; salen de la bola, se barajan en carrusel, se revelan de a una y flotan. Coreografía y proyección son matemática pura, con 32 pruebas.
  - **HUD** (`overlay/hud.js`): menú de servicios, últimos 5 donantes, franja de contacto temporizada, llamado "1 pregunta gratis al día" y aviso de contenido generado por IA.
  - Avatar animado con PixiJS (rig de deformación y poses por intención) y avatar CSS de respaldo.
- **Voz:** `EdgeTTSProvider` + `SpeechService`; si falla, la respuesta sale en texto. El volumen real mueve la boca.
- **Configuración del streamer:** `streamer.config.json` (no se sube) para frase, teléfono, promoción fija y usuario de TikTok. Las claves siguen en `.env`. `TIKTOK_USERNAME` y `PROMO_TEXT/PROMO_ENABLED` también se pueden poner como variables de entorno.
- **Overlay HUD:** notificación de puesto en la fila ("Puesto #N"), barra de respuesta visible durante el audio, spotlight al revelar cada carta de tarot, banner de promoción configurable. El `queue_position` se emite en cada comentario encolado con `position` 1-based.
- **Logging estructurado:** `src/logger.js` con niveles `DEBUG/INFO/WARN/ERROR`. Variable de entorno `LOG_LEVEL`. Todos los `console.*` de `app.js` migrados; worker y reglas usan `DEBUG` para no saturar la consola en producción.
- **Reconexión automática:** si TikTok corta la red durante el LIVE, `TikTokLiveAdapter` detecta el evento `'disconnected'` y `app.js` reintenta hasta 5 veces con backoff exponencial (5 s → 10 s → 20 s → 40 s → 80 s). Si el LIVE termina por `STREAM_END` o el streamer llama a `disconnect()`, no reconecta. Al arrancar, si TikTok rechaza la conexión inicial, también reintenta con el mismo backoff.
- **Gateway alojable** (`src/realtime/`): un servidor sirve la página del overlay y el WebSocket (`ws`) en un puerto; clave `?key=` obligatoria fuera de loopback (comparación en tiempo constante); `Origin` contra `Host`; CSP y cabeceras de seguridad en el HTML; `/healthz`; tope de 8 overlays. El navegador deduce la dirección del socket de la página (`socketUrl.js`), así funciona detrás de `/beto/` con `wss`. 14 pruebas + E2E en Chrome.
- **Despliegue** (`deploy/`): `install.sh` (Node 24, Caddy, usuario `tarot`, firewall), `tarot@.service` endurecido (una instancia por cliente), `nuevo-cliente.sh` (genera clave, puerto y ruta en Caddy, imprime la URL para OBS).
- **Seguridad:** el texto que va a la voz se limpia; solo se cargan imágenes `https`; el teléfono y el usuario nunca van en el código; historial de git sin claves (el teléfono sí quedó en el historial en `3040ee3`, ver deuda).
- **Herramientas:** `npm start` (sirve también el overlay), `npm run overlay` (solo la página, para capturas), `npm test` (24 suites offline) y `node tools/capture-overlay.mjs`.

## En progreso

- Nada activo. El repositorio está limpio y con todas las pruebas en verde.

---

## Decisiones que dependen del dueño (bloquean trabajo)

1. **Motor de voz para el "viejo sabio".** Edge TTS **no tiene** voces de anciano en español; bajarle el tono a Jorge suena robótico y el dueño lo rechazó tras escuchar tres muestras. Opciones evaluadas:
   - **ElevenLabs:** mejor calidad, tiene voces de anciano. Gratis ~10 000 caracteres/mes (≈100 respuestas), luego es pago.
   - **Magnific:** el dueño tiene cuenta, pero el conector devuelve "Server not found" y hay que reconectarlo.
   - **Clonación local** (XTTS, F5-TTS): gratis, pero pesado y con licencias que **prohíben uso comercial**.
2. **Estilo del arte de la escena: DECIDIDO, anime** ("todo natural como anime y bien hecho"). Falta la herramienta: los tokens de Hugging Face anteriores fueron revocados y Magnific está desconectado.
3. **Presupuesto de IA: recomendado activar facturación de Gemini** (~$5/mes por cliente a 5–10 mil respuestas). Cotización completa de 2026-09-18: voz de viejo sabio con `gpt-4o-mini-tts` ~$10–35/mes (o Fish Audio con clon); ElevenLabs descartado por costo a ese volumen; servidor $0 (Oracle) o €12 (Hetzner) compartido entre clientes. Quién paga qué: las APIs las paga el cliente dentro de la mensualidad.
4. **Licencia del proyecto.** `tiktok-live-connector` es **AGPL-3.0**; `package.json` dice `ISC`, que es inconsistente. Si el producto se distribuye o se ofrece como servicio, probablemente haya que publicar bajo AGPL o reemplazar el conector. Consultar con legal antes de vender.
5. **Riesgo del teléfono en pantalla.** TikTok suele penalizar sacar usuarios de la plataforma con fines comerciales. Hoy la franja aparece 12 s cada 6 min y se apaga con `contact.enabled: false`. Si hay advertencias o baja de alcance, apagarla.

**No hace falta preguntar los precios de los regalos:** el dueño no los conoce. Se leen del LIVE, en las líneas `🎁` (al conectar) y `💎 Apoyo →` (cada regalo).

---

## Pendientes, en orden

### 1. Registrar por qué falla el modelo principal ⚡ rápido
- **Problema:** en los LIVEs reales `gemini-3.5-flash-lite` falla en **todas** las llamadas y siempre responde el de respaldo, gastando el doble de cuota. `ResilientAIProvider` no registra el error, así que se desconoce la causa (cuota, nombre del modelo o incompatibilidad con `responseSchema`).
- **Dónde:** `src/ai/ResilientAIProvider.js`, dentro del bucle de proveedores.
- **Listo cuando:** cada fallo se registra con `code`, `status` y mensaje, y la causa está identificada y corregida.

### 2. Pausa ante cuota agotada (circuit breaker)
- **Problema:** Google responde `429` con *"Please retry in 14s"* y el worker sigue llamando con cada comentario. Todas fallan y el overlay muestra "No pude responder" una y otra vez. **Esto es lo que ve el público hoy.**
- **Dónde:** `src/ai/GeminiProvider.js` (leer la espera) y `ResilientAIProvider` o `src/workers/QueueWorker.js` (pausar).
- **Listo cuando:** tras un `429` no se llama a ese modelo hasta que pase el tiempo indicado; mientras tanto se usa el otro o se espera sin mostrar un error por comentario; hay pruebas con reloj simulado.

### 3. Agradecimientos sin IA
- **Problema:** cada regalo gasta una llamada a Gemini solo para decir "gracias".
- **Dónde:** nuevo módulo de plantillas en `src/ai/`, usado por el worker para `gift` y `subscription`.
- **Listo cuando:** los regalos se agradecen con plantillas variadas (nombre del usuario y del regalo), con voz y pose `thanks`, **sin llamar a Gemini**.

### 4. Política de saturación de la cola
- **Problema:** con muchos comentarios la cola acumula mensajes viejos y responde tarde a cosas irrelevantes.
- **Ideas:** expirar comentarios de más de N segundos; descartar duplicados y saludos sueltos; límite por usuario; priorizar preguntas de tarot.
- **Dónde:** `src/rules/EventRuleEngine.js`, `src/rules/PriorityQueue.js`, `src/events/EventProcessor.js`.
- **Listo cuando:** las reglas son configurables y tienen pruebas.

### 5. Ajustar precios de los servicios con datos reales
- **Problema:** "Prioridad 3 Cartas" (500) y "Prioridad 5 Cartas" (800) son provisionales, copiados del overlay de un competidor.
- **Además:** con el catálogo actual **"Pregunta Rápida" (270) es inalcanzable**, porque cualquier saldo de 270 o más ya desbloquea "Lectura 3 Cartas" (200), que es de **nivel** mayor. `resolveService` elige por nivel, no por precio. Hay que reordenar niveles y precios de forma coherente.
- **Dónde:** `DEFAULT_SERVICES` en `src/rules/serviceCatalog.js`.
- **Listo cuando:** cada servicio del menú se puede comprar con algún regalo real de la sala, y las líneas `🎁` del arranque lo confirman.

### 6. Voz de viejo sabio
- **Depende de la decisión 1 del dueño.** El proveedor está detrás de una interfaz (`synthesize(text) → { data, mimeType }`), así que cambiar de motor toca un solo archivo en `src/tts/`.
- **Listo cuando:** la voz suena a anciano sin artificios de tono, el costo por LIVE está medido y documentado, y si el servicio falla la respuesta sigue saliendo en texto.

### 7. Arte de la escena (mago, mesa, fondo)
- **Depende de la decisión 2 del dueño.**
- **Contexto:** hoy el mago es una sola imagen (981 × 1602) más 6 poses alineadas píxel a píxel. Cambiar de estilo implica **regenerar la base y todas las poses**, y volver a ajustar `wizardRig.js` (zonas de deformación) y `ANCHORS` (bola, ojos, manos, cartas).
- **Defectos actuales del arte:** en `thanks-2` la estrellita del sombrero aparece duplicada; la variante 1 de `invite` corta los dedos (hoy se usa la 2). Causa: las poses se recortaron desde la mitad del sombrero. Solución: regenerar con el recorte completo (`x 0–981, y 0–1100`), alinear con SIFT + RANSAC y exportar a WebP.
- **Herramienta usada antes:** Qwen-Image-Edit-2511 en Hugging Face (Space `LPX55/Qwen-Image-Edit-2511-Turbo-Lightning`, ~12 imágenes gratis por día). **Los scripts de generación y alineación no están en el repo**; conviene recrearlos en `tools/arte/`.

### 8. Lo que el dueño pidió del overlay del competidor y todavía falta
| Falta | Qué implica |
|---|---|
| **Puesto en la fila** ("Ya estás en la fila — Puesto #7") | El backend debe publicar la posición de cada usuario en `PriorityQueue` y el overlay mostrarla al comentar |
| **Barra con la respuesta** ("Respondiendo a Mayra" + el texto de la lectura) | Hoy la respuesta solo se escucha y se ve en el globo; el competidor la muestra como subtítulo grande |
| **Carta grande al revelarse** con su nombre | Las cartas 3D ya existen; falta destacar la carta principal en primer plano |
| **Promoción fija** (tipo "Horóscopo de la semana") | Imagen o pastilla configurable desde `streamer.config.json` |

### 9. Configuración por streamer (multi-usuario) ✅
- `TIKTOK_USERNAME` se lee de `TIKTOK_USERNAME` (env) o `tiktokUsername` (streamer.config.json). Lanza error claro si falta.
- `PROMO_TEXT`/`PROMO_ENABLED` controlan el banner de promoción desde env o config.
- `.env.example` documenta todas las variables: `GEMINI_API_KEY`, `TIKTOK_USERNAME`, `LOG_LEVEL`, `TTS_*`, `CONTACT_*`, `PROMO_*`.

### 10. Producción: desplegar el primer cliente
- ✅ Logging, reconexión (con `RECONNECT_MAX_ATTEMPTS=0` = para siempre, espera tope 2 min para no agotar las firmas gratis de Euler), gateway con clave, `deploy/`.
- ⏳ **Provisionar el servidor y el dominio** (lo hace el desarrollador): Oracle Always Free ARM + subdominio. Luego `deploy/install.sh` y `deploy/nuevo-cliente.sh beto`. Ver [DEPLOY.md](DEPLOY.md).
- ⏳ **Probar en OBS del cliente** con la URL `https://…/beto/?avatar=animado&key=…` y en **TikTok LIVE Studio** (motor web no documentado: verificar WebGL, audio y `wss`).
- ⏳ **Esperar el LIVE sin reiniciar:** hoy, si el cliente no está en vivo, `connect()` falla y reintenta con espera creciente; funciona, pero cada intento gasta una firma de Euler. Mejor: consultar si está en vivo (`isLive`) antes de conectar.

### 11. Regalos con imagen real sin pagar Euler
- **Problema:** desde 2026-09-18 la lista de regalos (`gift/list`) exige el plan Business de Euler Stream ($50/mes). El menú cae a íconos.
- **Solución:** cada evento de regalo ya trae nombre, imagen y precio. Guardar un catálogo aprendido (`data/gift-catalog.json`) y usarlo para el menú; se llena solo en los primeros LIVEs. Precios ya vistos: Heart Me 1, Rose 1, Doughnut 30.
- **Dónde:** `src/rules/giftCatalog.js`, `src/app.js` (evento `gift`), un store como `ledgerStore.js`.

### 12. Quitar `unsafe-eval` de la CSP
- PixiJS 8 compila shaders con `new Function`. Empaquetar el complemento `pixi.js/unsafe-eval` en `src/overlay/vendor/` y quitar `'unsafe-eval'` de `CONTENT_SECURITY_POLICY` en `src/realtime/overlayStatic.js`. La prueba E2E del gateway lo detecta si falta.

---

## Deuda técnica conocida

| Tema | Detalle |
|---|---|
| Archivos del POC inicial | `index.js` e `index.poc-events.js` son experimentos viejos; evaluar si se borran |
| Sin CI | Agregar GitHub Actions que ejecute `npm test` en cada PR |
| Pruebas de red mezcladas con las offline | `test-adapter`, `test-gemini*`, `test-realtime` y `test-ai-overlay` están en `src/` junto a las offline. Moverlas a `scripts/manual/` |
| DOM simulado en `test-hud.js` | No es un DOM real: un error que solo ocurre en el navegador puede pasar desapercibido (ya ocurrió con `setTimeout`, ver abajo) |
| Comentarios con caracteres corruptos | `src/overlay/styles.css` tiene mojibake (p. ej. `Ã—`) en comentarios; no afecta el funcionamiento |
| `node-edge-tts` | No cierra su WebSocket si vence el tiempo (limitación de la librería, mitigada con timeout propio) |
| Teléfono del cliente en el historial de git | Quedó escrito en `src/overlay/index.html` en el commit `3040ee3` (ya no está en el código). Borrarlo exige reescribir la historia y forzar el push, coordinado con los dos desarrolladores. Decisión del dueño |
| El otro desarrollador sube sin correr `npm test` | Una suite llegó rota y cuatro "poses" que no eran el mago llegaron al LIVE. Regla: `npm test` antes de cada push; toda pose se genera de la imagen base y se alinea |

---

## Trampas que ya costaron caro (léelas antes de tocar el código)

1. **Nunca ejecutes `node src/test-*.js` con comodín.** Hay suites que se conectan a TikTok o **gastan cuota de Gemini**. Usa `npm test`.
2. **Un navegador de prueba se conecta al LIVE real.** El overlay se conecta al WebSocket del servidor que sirvió la página; si la sirves desde el backend que está en un LIVE, te metes en el LIVE. Los scripts de captura sirven la página con `scripts/serve-overlay.js` (sin backend) y reemplazan `WebSocket` **antes** de cargarla, como `tools/capture-overlay.mjs`. Para probar el gateway real, levántalo en el puerto 0 (libre), nunca en el 8080.
3. **Node no es el navegador.** `setTimeout` guardado como propiedad y llamado como método (`this.setTimer(...)`) lanza *"Illegal invocation"* en el navegador, pero funciona en Node: la franja de contacto **nunca** apareció durante días con todas las pruebas en verde. Si algo es del navegador, verifícalo en el navegador.
4. **Nada de `vw`/`vh` ni media queries de orientación en el overlay.** Todo vive dentro del escenario fijo 9:16; usa `cqw`/`cqh` o píxeles. Con unidades de ventana, los paneles se agrandan y se enciman en un monitor horizontal.
5. **El menú no puede prometer lo que el regalo no da.** `giftForService` solo muestra un regalo si `unlocks(precio)` devuelve ese mismo servicio.
6. **PixiJS necesita `unsafe-eval`.** Una CSP estricta deja el mago animado en blanco sin ningún error en las pruebas unitarias: solo se ve en un navegador real. Toda cabecera de seguridad nueva se verifica con Chrome.

---

## Cómo retomar el trabajo

1. Lee [CONTEXT.md](CONTEXT.md): es el vocabulario del dominio.
2. `npm install` y `npm test`: las 24 suites deben estar en verde.
3. `npm run overlay` y abre `http://127.0.0.1:5500/index.html?avatar=animado&debug=1`. Con las teclas `1`–`8` y `g` puedes probar **todo el overlay sin TikTok ni Gemini**. (Con backend: `npm start` y la URL que imprime.)
4. Si tocas el overlay, verifica en las tres pantallas: `node tools/capture-overlay.mjs`.
5. Toma el primer pendiente de la lista que no dependa de una decisión del dueño.
