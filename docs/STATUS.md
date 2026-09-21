# Estado del proyecto — Generador Automático de Lives de TikTok

_Última actualización: 2026-09-20. Actualizar al cerrar cualquier cambio relevante._

## Dónde estamos

**EN PRODUCCIÓN con el primer cliente.** El backend corre en un servidor Oracle Always Free (`tarot@beto`, Ubuntu, Caddy con HTTPS) en `https://magotarot.duckdns.org/beto/`. El cliente (@berlinuniberso) transmite con TikTok LIVE Studio usando la fuente **Link** a 1080×1920 y ya hizo el primer LIVE real el 2026-09-19. Guía de operación: [DEPLOY.md](DEPLOY.md).

**Lo que pasó en ese LIVE, y manda sobre todo lo demás:** TikTok suspendió los regalos y restringió la visibilidad 10 minutos por *"acciones que se repiten o prolongan sin mediar interacción"*. Investigado: el contenido operado por IA sin presencia del creador no es elegible para monetización; los paneles estáticos, los íconos de regalo permanentes y los textos que piden regalos son los disparadores más fuertes; un avatar es tolerado si no ocupa más de la mitad del cuadro. **El dueño decidió seguir con el mago a pantalla completa, sin cámara**, y pidió imitar a las cuentas que aguantan: nada fijo, más variedad, comportamiento según la actividad de la sala. Ver [ADR 0002](adr/0002-live-sin-camara.md).

**Servidor actualizado el 2026-09-20** (`32450d2`, director de sala, menú rotativo, saludos sin género). Para llevar cualquier commit nuevo: `sudo TAROT_DOMAIN=magotarot.duckdns.org bash /opt/tarot/app/deploy/install.sh` (reinicia la instancia unos segundos; el overlay del cliente se reconecta solo).

### Reglas del negocio que no se negocian (2026-09-20, del dueño)

1. **Regalar = leer.** Quien regala cualquier cosa recibe una lectura del nivel que valga ese regalo (rosa → oráculo del día; 270 → tres cartas; 800 → cinco). El menú es una **lista de recompensas**, no una meta que se va llenando. Se retiró el contador de monedas por sesión que se había puesto en el menú.
2. **La lectura gratis es una PREGUNTA cada 24 h, no un comentario.** "Qué lindo tu gato" no gasta la cuota; "me volverá a hablar" sí. Lo decide `src/rules/questions.js` (`isQuestion`), y el motor ignora con `not_a_question` lo que no pregunta.
3. **La atención depende de cuánta gente haya.** Con sala vacía el mago saluda a cada persona que entra, contesta cada "hola", agradece cada compartido y algún like. Con sala llena, se calla: las interacciones ya dan movimiento. Lo decide `ActivityDirector.allowAck(kind)` (tasa por tipo según ánimo, cooldown por tipo, 6 s mínimo entre dos). **Nunca contadores fijos** ("1 de cada 15 likes"): con sala llena son una ametralladora de frases repetidas, que es lo que TikTok castiga.
4. **Toda frase del mago va con voz y marcada como suya** (`source.type: 'idle'`). Un `ai_response` con `audio: null` es boca moviéndose en silencio, y sin `source` el overlay rotula "Respuesta para Usuario".
5. **Agradecer no es pedir, ni prometer.** "Gracias por compartir" sí; "eso tiene su recompensa" no (carnada de interacción). Las frases viven en `src/live/ackLines.js` y el test las revisa contra palabras prohibidas y género.
6. **Nada fijo en pantalla** ([ADR 0002](adr/0002-live-sin-camara.md)). El menú entra 25 s y se va 50 s; ahora hay un test que lo vigila, porque el ciclo se quitó una vez sin que nada avisara.

## Roadmap

| Etapa | Estado | Notas |
|---|---|---|
| 1. Efectos visuales (VFX) | ✅ Hecho | Aura, bola, chispas, anillos, celebraciones, esfera armilar, música ambiental |
| 2. Voz (TTS) | 🔄 Funciona, falta timbre | Edge TTS `es-MX-JorgeNeural`. El dueño quiere voz de viejo sabio; cotizado `gpt-4o-mini-tts` (~$10–35/mes) |
| 3. Cartas de tarot | ✅ Hecho | 3D; solo aparecen en lecturas y se guardan solas a los 5 s |
| 4. Economía de regalos + HUD | ✅ Hecho | Saldo por espectador, menú rotativo, donantes, franja de contacto con teléfono, puesto en fila, barra de respuesta |
| 5. Escenario responsivo | ✅ Hecho | Lienzo fijo 9:16 |
| 6. Estabilidad de la IA | ✅ Hecho | Circuit breaker ante 429, agradecimientos sin IA, filtro de saludos, un comentario por usuario en cola. Falta activar facturación de Gemini |
| 7. Producción | ✅ Desplegado | Servidor, HTTPS, clave por overlay, un proceso por cliente, `deploy/` |
| 8. Sobrevivir a la política de LIVE desatendido | 🔄 **En curso** | Director de sala, menú rotativo, sin cartel fijo. Falta: cambios de ropa, más variedad de animación |
| 9. Arte de la escena | ⏳ Decidido: **anime** | Regenerar base y poses alineadas. Magnific ya está conectado |

## Hecho recientemente (2026-09-19)

- **Director de sala** (`src/live/ActivityDirector.js`, `idleLines.js`): mide espectadores y participación (comentarios, regalos, follows, shares; entrar o dar like no cuenta) y decide el ánimo `quiet | warming | busy`. Con sala callada el mago habla solo cada ~75 s con frases de plantilla (sin IA, sin pedir regalos ni follows, sin repetirse) y manda `scene_mood` al overlay para subir la animación en reposo. Nunca habla encima de una respuesta, ni sin LIVE, ni sin overlay conectado. 14 pruebas.
- **HUD sin nada fijo:** el menú de servicios aparece 25 s y se oculta 50 s; el cartel estático del teléfono se eliminó y el número viaja dentro de la franja temporizada.
- **Servidor alojado** ([ADR 0001](adr/0001-overlay-alojado.md)): `RealtimeGateway` sirve página + WebSocket con clave `?key=` (comparación en tiempo constante, decidida por el archivo servido, no por cómo se escribe la URL), Origin contra Host, CSP, `/healthz`. `deploy/` con `install.sh`, `nuevo-cliente.sh`, Caddyfile y unidad systemd con `DynamicUser` por cliente. Revisión de seguridad hecha; dos hallazgos corregidos (bypass de clave por `/%2findex.html`, clave en el log de errores de Caddy).
- **Reconexión unificada** (`retryWithBackoff`): con `RECONNECT_MAX_ATTEMPTS=0` espera el próximo LIVE para siempre, tope 2 min entre intentos (≈720 firmas de Euler al día, bajo el límite gratis de 2 500).
- **Del otro dev, integrado en main:** logging estructurado, circuit breaker, plantillas de agradecimiento, filtros de cola, puesto en fila, barra de respuesta, promo configurable, esfera armilar, música y efectos, menú estilo TikTok con contador hasta medianoche, cartas solo en lecturas.

- **2026-09-20, unificación:** el otro dev subió un `LivenessWorker` (invitaciones, cartas del día, saludos a recién llegados, cambio de atuendo por tinte del aura, barajada) que hacía lo mismo que el director de sala, y con los dos activos el mago hablaba el doble y sin voz. Se dejó **un solo cerebro**: `ActivityDirector` decide cuándo, y `idleLines.js` mezcla ambos catálogos (`LivenessContent.js`) con intención (`invite_share` o `tarot_reading`), siempre con voz. El atuendo cambia cada 4 min y con regalos ≥ 50 monedas; la barajada sale cada 90 s con sala callada. `src/workers/LivenessWorker.js` y `src/test-liveness-worker.js` quedan **sin uso** hasta que el otro dev confirme retirarlos.

- **2026-09-20, frases:** los saludos asumían género ("¡Bienvenido, Mayra!") cuando el apodo de TikTok no dice nada del género de quien entra. Se reescribieron los 22 saludos sin género (hay un test que lo vigila) y los catálogos crecieron: 43 frases con sala callada, 16 con gente, 7 con sala movida. La memoria del director pasó de 4 a 12 frases sin repetir. Al escribir frases nuevas: **el catálogo más corto manda**, porque si la memoria supera su tamaño `fresh()` entra en modo reciclaje y solo se garantiza no repetir las últimas `largo - 1`. En los agradecimientos, sin apodo se dice "alma generosa" en vez de "amigo".

## En progreso

- Etapa 8: variedad de animación y cambios de ropa del mago (pendientes 1 y 2).

---

## Decisiones que dependen del dueño

1. **Motor de voz para el "viejo sabio".** Recomendado `gpt-4o-mini-tts` con instrucción de anciano (~$0,015/min); alternativa Fish Audio con clon. ElevenLabs descartado por costo. Falta que el dueño apruebe el gasto.
2. **Arte anime.** Decidido el estilo; Magnific está conectado. Falta que el dueño apruebe el consumo de créditos.
3. **Facturación de Gemini** (~$5/mes por cliente). Sin esto, los picos de comentarios siguen chocando con el límite por minuto de la capa gratis.
4. **Música ambiental** (`assets/audio/ambient.mp3`, "The Hooded Man" de Peter Gundry, 8 MB): confirmar licencia para uso comercial o cambiarla por música libre. TikTok detecta audio con derechos y puede silenciar el LIVE.
5. **Licencia del proyecto.** `tiktok-live-connector` es AGPL-3.0 y `package.json` dice ISC. Consultar antes de vender.
6. **Teléfono en el historial de git** (commit `3040ee3`): borrarlo exige reescribir la historia con los dos desarrolladores coordinados.

**No hace falta preguntar los precios de los regalos:** se leen del LIVE (líneas `💎 Apoyo →`). Vistos: Heart Me 1, Rose 1, Doughnut 30.

---

## Pendientes, en orden (para el otro desarrollador)

Regla antes de empezar cualquiera: `npm test` en verde antes de cada push, y todo cambio del overlay verificado en navegador real (`node tools/capture-overlay.mjs`). Toda pose nueva se genera **a partir de la imagen base** y alineada píxel a píxel; una imagen suelta no es una pose.

### 1. Cambios de ropa del mago 🎨
- **Qué pidió el dueño:** que el mago cambie de vestimenta seguido, como en otras cuentas.
- **Cómo:** variantes de la imagen base con otra túnica/sombrero (color, bordados), generadas con Magnific **desde la misma base** para que la malla siga alineada. Se cargan como "skins" (misma malla, otra textura) y el director de sala pide un cambio cada N minutos o al cambiar el ánimo, con fundido como el de `PoseBlender`.
- **Dónde:** `src/overlay/animated/AnimatedAvatar.js` (`#showPose`, texturas), `poses.js`, `assets/poses/`, evento nuevo `scene_outfit` desde `src/app.js` (junto a `scene_mood`).
- **Listo cuando:** hay al menos 3 vestimentas, cambian solas sin saltos, y `test-poses` verifica que cada archivo existe y está registrado.

### 2. Más variedad de animación en reposo
- **Problema:** en reposo el mago repite el mismo ciclo; TikTok lo lee como bucle.
- **Cómo:** gestos de reposo alternos (mirar la bola, acariciar al gato, hojear el libro, mover la vela) elegidos al azar sin repetir el último; la energía que manda `scene_mood` (`this.energy` en `AnimatedAvatar`) decide cada cuánto.
- **Dónde:** `AnimatedAvatar.js` (`#updateMagicTrick`, `#updateArmillary`), `wizardRig.js`.
- **Listo cuando:** en 2 minutos de reposo no se repite la misma secuencia y el fondo tiene movimiento continuo.

### 3. Actualizar el servidor y verificar en el próximo LIVE
- `sudo TAROT_DOMAIN=magotarot.duckdns.org bash /opt/tarot/app/deploy/install.sh` y mirar `journalctl -u tarot@beto -f`. Deben aparecer líneas `🎭 Sala quiet: el mago habla solo`. Si TikTok restringe otra vez, subir la frecuencia del director (`IDLE_EVERY_MS`) y bajar la del menú (`MENU_VISIBLE_MS`).

### 4. Regalos con imagen real sin pagar Euler
- La lista `gift/list` exige el plan Business de Euler ($50/mes). Cada evento de regalo ya trae nombre, imagen y precio: guardar un catálogo aprendido (`data/gift-catalog.json`, store como `ledgerStore.js`) y usarlo en `decorateMenu`. Se llena solo en los primeros LIVEs.

### 5. Ajustar precios y niveles de los servicios
- "Pregunta Rápida" y "Lectura 3 Cartas" se intercambiaron (`7d5e3ce`); confirmar con las líneas `💎` del próximo LIVE que cada servicio es comprable con un regalo real. `DEFAULT_SERVICES` en `src/rules/serviceCatalog.js`.

### 6. Superposiciones del HUD a 1080×1920
- La franja de contacto tapa el título "Últimos en apoyar" cuando coinciden. Mover la franja o retrasarla mientras el tablero cambia. Verificar con `tools/capture-overlay.mjs`.

### 7. Voz de viejo sabio
- Depende de la decisión 1 del dueño. Cambiar de motor toca un solo archivo en `src/tts/` (interfaz `synthesize(text) → { data, mimeType }`). Medir el costo por LIVE.

### 8. Arte anime de la escena
- Depende de la decisión 2. Regenerar base y 6 poses alineadas (recorte completo `x 0–981, y 0–1100`), reajustar `wizardRig.js` y `ANCHORS`. Dejar los scripts en `tools/arte/`.

### 9. Esperar el LIVE sin gastar firmas
- Hoy `connect()` falla y reintenta cada 2 min cuando el cliente no está en vivo. Mejor consultar si está en vivo antes de conectar (`isLive` del conector) y conectar solo entonces.

### 10. Quitar `unsafe-eval` de la CSP
- Empaquetar `pixi.js/unsafe-eval` en `src/overlay/vendor/` y quitar `'unsafe-eval'` de `CONTENT_SECURITY_POLICY` en `src/realtime/overlayStatic.js`. La prueba E2E del gateway lo detecta si falta.

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
| Subidas sin correr `npm test` | Ya pasó dos veces: una suite rota y cuatro "poses" que no eran el mago llegaron al LIVE; y `document.getElementById` dentro del HUD en vez de recibir el elemento. Regla: `npm test` antes de cada push |

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
2. `npm install` y `npm test`: las 26 suites deben estar en verde.
3. `npm run overlay` y abre `http://127.0.0.1:5500/index.html?avatar=animado&debug=1`. Con las teclas `1`–`8` y `g` puedes probar **todo el overlay sin TikTok ni Gemini**. (Con backend: `npm start` y la URL que imprime.)
4. Si tocas el overlay, verifica en las tres pantallas: `node tools/capture-overlay.mjs`.
5. Toma el primer pendiente de la lista que no dependa de una decisión del dueño.
