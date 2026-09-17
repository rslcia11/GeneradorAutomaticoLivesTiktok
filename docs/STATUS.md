# Estado del proyecto — Generador Automático de Lives de TikTok

_Última actualización: 2026-09-16. Actualizar al cerrar cualquier cambio relevante._

## Dónde estamos

**MVP funcional y probado en un LIVE real.** El mago responde con IA y voz a comentarios y regalos, cambia de pose según la intención de la respuesta, muestra cartas de tarot en las lecturas y celebra follows y shares. Todo corre gratis en la PC del streamer con OBS.

El **cuello de botella actual** es la capa gratis de Gemini: en el LIVE de prueba se agotó en minutos y desde ahí casi todos los comentarios fallaron. Por eso la **etapa 3 (política de saturación)** es la prioridad.

## Roadmap

| Etapa | Estado | Notas |
|---|---|---|
| 1. Efectos visuales (VFX) | ✅ Hecho | Aura, bola, chispas, anillos, destellos en cartas, celebraciones |
| 2. Voz (TTS) | ✅ Hecho | Edge TTS `es-MX-JorgeNeural`, boca sincronizada con el volumen real |
| 3. Política de saturación | ⏳ **Siguiente** | Ver "Próximos pasos". El LIVE real mostró que es urgente |
| 4. Avatar avanzado | 🔄 MVP hecho | 6 poses por intención. Faltan poses extra y corregir defectos de arte |
| 5. Producción | ⏳ Pendiente | Probar TikTok LIVE Studio, instalador/config por streamer, logging, recuperación |

## Hecho

- **Pipeline TikTok → IA → overlay:**
  - Reglas, cola con prioridad y worker serial.
  - Gemini con fallback de modelo.
  - Salida JSON `{ intent, text }`.
- **Overlay:**
  - Presentación ordenada de interacciones.
  - Avatar CSS de respaldo.
  - Avatar animado con PixiJS: rig de deformación, poses por intención, cartas flotantes y efectos.
- **Voz:**
  - `EdgeTTSProvider` + `SpeechService`: si la voz falla, se responde en texto.
  - `SpeechPlayer` con Web Audio.
  - La duración real del audio controla la interacción.
- **Seguridad:**
  - El WebSocket solo acepta conexiones de `127.0.0.1`, con límite de tamaño de mensaje y control de memoria.
  - El texto que va a la voz se limpia y la configuración de voz se valida.
  - Historial de git limpio de claves.
- **Herramientas:** `npm start`, `npm run overlay`, `npm test` (14 suites offline, 183 pruebas).

## En progreso

- Nada activo en este momento.

## Bloqueado / requiere decisión del dueño

1. **Licencia del proyecto.**
   - `tiktok-live-connector` es **AGPL-3.0**. Si el producto se distribuye u ofrece como servicio, el código que lo usa probablemente deba publicarse bajo AGPL.
   - `package.json` dice `ISC`, que es inconsistente.
   - **Decidir:** adoptar AGPL-3.0, o reemplazar el conector. Consultar con alguien de legal antes de vender o distribuir.
2. **Edge TTS es un servicio no oficial de Microsoft.** Riesgo de términos de servicio y de disponibilidad para un producto con muchos usuarios. Alternativas evaluadas:
   - **Piper:** motor MIT y voz `es_MX-claude` Apache 2.0, offline e ilimitado, pero suena menos natural.
   - **Gemini TTS:** gratis solo 15 solicitudes/día.
3. **Presupuesto de IA.**
   - La capa gratis no alcanza para un LIVE activo.
   - **Decidir:** usar una clave de pago, varios modelos o claves, o reducir llamadas con la etapa 3.

---

## Próximos pasos (en orden)

### 1. Diagnosticar por qué falla el modelo principal ⚡ rápido
- **Problema:** en el LIVE real, `gemini-3.5-flash-lite` falló en **todas** las llamadas y siempre respondió el fallback. Así se gasta el doble de cuota. `ResilientAIProvider` no registra el error del principal, así que se desconoce la causa: cuota, nombre de modelo o incompatibilidad con `responseSchema`.
- **Dónde:** `src/ai/ResilientAIProvider.js`, dentro del bucle de proveedores.
- **Listo cuando:** cada fallo de un proveedor se registra con `code`, `status` y mensaje, y se conoce y corrige la causa.

### 2. Pausa inteligente ante cuota agotada (circuit breaker)
- **Problema:** Google responde `429` con *"Please retry in 14s"* y el worker igual sigue llamando con cada comentario. Todas esas llamadas fallan y el overlay muestra "No pude responder" una y otra vez.
- **Dónde:** `src/ai/GeminiProvider.js` (leer el tiempo de espera) y `src/ai/ResilientAIProvider.js` o `src/workers/QueueWorker.js` (pausar).
- **Listo cuando:**
  - Tras un `429`, no se llama a ese modelo hasta que pase el tiempo indicado.
  - Mientras tanto se usa el otro modelo o se espera sin mostrar un error por cada comentario.
  - Hay pruebas con reloj simulado.

### 3. Agradecimientos sin IA
- **Problema:** cada regalo gasta una llamada a Gemini solo para decir "gracias".
- **Dónde:** nuevo módulo de plantillas en `src/ai/`, usado desde el worker para `gift` y `subscription`.
- **Listo cuando:** los regalos se agradecen con plantillas variadas (nombre del usuario y del regalo) con voz y pose `thanks`, **sin llamar a Gemini**.

### 4. Política de saturación de la cola
- **Problema:** con muchos comentarios, la cola acumula mensajes viejos y responde tarde a cosas irrelevantes.
- **Ideas:**
  - Expirar comentarios de más de N segundos.
  - Descartar duplicados o spam ("hola", emojis).
  - Límite por usuario.
  - Priorizar preguntas de tarot.
- **Dónde:** `src/rules/EventRuleEngine.js`, `src/rules/PriorityQueue.js`, `src/events/EventProcessor.js`.
- **Listo cuando:** las reglas son configurables y tienen pruebas.

### 5. Configuración por streamer
- **Problema:** el usuario de TikTok está fijo en el código (`config.tiktokUsername = 'tarotdebeto.co'` en `src/app.js`, y también en `index.js`, `index.poc-events.js` y `src/test-adapter.js`).
- **Listo cuando:** se lee de `TIKTOK_USERNAME` en `.env` con validación, y `.env.example` documenta **todas** las variables (`GEMINI_API_KEY`, `TIKTOK_USERNAME`, `TTS_*`).

### 6. Corregir defectos de arte de las poses
- **Defectos:**
  - En `thanks-2` y otras, la estrellita del sombrero aparece duplicada.
  - La variante 1 de `invite` corta los dedos; hoy se usa la 2.
- **Causa:** las poses se generaron recortando desde la mitad del sombrero.
- **Solución:** regenerar enviando la imagen completa de ancho y desde la punta del sombrero (recorte `x 0–981, y 0–1100`), alinear con SIFT + RANSAC y exportar a WebP.
- **Poses nuevas sugeridas:** celebrar regalo, pensando (acariciando la barba), escuchando.
- **Herramienta:** Qwen-Image-Edit-2511 en Hugging Face (Space `LPX55/Qwen-Image-Edit-2511-Turbo-Lightning`, ~12 imágenes/día gratis). Los scripts de generación y alineación **no están en el repo**: conviene recrearlos en `tools/arte/`.

### 7. Producción (etapa 5)
- **Probar en TikTok LIVE Studio:** el motor de su fuente web no está documentado; verificar WebGL, audio y módulos ES.
- **Recuperación ante caídas:**
  - Reconectar a TikTok si se corta el LIVE o la red.
  - Hoy, si la cuenta no está en LIVE al iniciar, el proceso termina.
- **Logging:** estructurado y con niveles (hoy es `console.*`).
- **Rendimiento:** medir CPU/GPU en PCs modestas; existe `?fps=30`.
- **Instalación para no técnicos:** script o ejecutable.

---

## Deuda técnica conocida

| Tema | Detalle |
|---|---|
| Archivos del POC inicial | `index.js` e `index.poc-events.js` son experimentos viejos; evaluar si se borran |
| Sin CI | Agregar GitHub Actions que ejecute `npm test` en cada PR |
| Tests de red mezclados con offline | `test-adapter`, `test-gemini*`, `test-realtime` y `test-ai-overlay` están en `src/` junto a los offline. Moverlos a `scripts/manual/` |
| Comentarios con caracteres corruptos | `src/overlay/styles.css` tiene mojibake (p. ej. `Ã—`) en comentarios; no afecta el funcionamiento |
| `node-edge-tts` | No cierra su WebSocket si vence el tiempo (limitación de la librería, mitigada con timeout propio) |
| Gateway sin verificación de origen | Solo acepta `127.0.0.1`, pero cualquier página abierta en el navegador del streamer podría conectarse. Evaluar `verifyClient` por `Origin` |

## Cómo retomar el trabajo

1. Lee [CONTEXT.md](CONTEXT.md) para el vocabulario.
2. `npm install` y `npm test`: todo debe estar en verde.
3. `npm run overlay` y abre `http://127.0.0.1:5500/index.html?avatar=animado&debug=1`. Prueba las teclas `1`–`8` y `g` **sin necesidad de TikTok ni Gemini**.
4. Toma el primer paso pendiente de la lista de arriba.
