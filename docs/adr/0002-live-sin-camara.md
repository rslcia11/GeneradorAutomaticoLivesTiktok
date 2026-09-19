# ADR 0002 — LIVE con el mago a pantalla completa, sin cámara del tarotista

- **Estado:** aceptada (2026-09-19)
- **Decide:** el dueño del producto. El desarrollador dejó constancia del riesgo.

## Contexto

En el primer LIVE real desde el servidor, TikTok suspendió los regalos y
restringió la visibilidad durante 10 minutos con el motivo *"acciones que se
repiten o prolongan sin mediar interacción, como permanecer fuera de campo o
sin interactuar"*.

Lo que dicen las normas y las guías de creadores (2026):

- Contenido "generado u operado principalmente mediante sistemas automatizados,
  como IA, sin presencia significativa del creador" **no es elegible para
  monetización**.
- Un avatar digital se tolera si **no ocupa más de la mitad del cuadro**.
- Disparadores fuertes: imágenes estáticas, íconos de regalo permanentes,
  textos que piden regalos o follows, bucles repetidos, música con derechos.
- En LIVEs de venta (TikTok Shop) las voces de IA están prohibidas desde mayo
  de 2026; en LIVEs normales no, pero cuentan como señal de automatización.

La opción segura es que el tarotista salga en cámara ocupando más de la mitad
de la pantalla y el mago lo acompañe. El dueño la descartó: el producto es el
mago, y hay cuentas similares que transmiten así sin sanción.

## Decisión

Seguir con el mago a pantalla completa y sin cámara, y reducir al mínimo las
señales de "transmisión desatendida":

1. **Nada fijo en pantalla.** El menú de servicios entra y sale (25 s visible,
   50 s oculto). El teléfono no tiene cartel: viaja dentro de la franja de
   contacto temporizada.
2. **Nunca pedir regalos, likes ni follows** en texto ni en voz. Las frases del
   mago invitan a preguntar; una prueba lo verifica.
3. **Comportamiento según la sala** (`ActivityDirector`): con poca gente y sin
   comentarios el mago habla solo e intensifica la animación; con sala activa
   se calla y deja que las interacciones den el movimiento.
4. **Variedad:** cambios de vestimenta y gestos de reposo alternos (pendiente).
5. **Sesiones y pausas:** se recomienda al cliente no dejar LIVEs de muchas
   horas seguidas.

## Consecuencias

- Ninguna de estas medidas garantiza inmunidad; la política vigente permite a
  TikTok restringir el LIVE de todos modos. Si las restricciones se repiten,
  el plan B es el "modo compañero" (mago en menos de la mitad del cuadro y el
  tarotista en cámara), que el código puede soportar con un cambio de layout.
- El director de sala gasta voz (TTS) aunque nadie pregunte; por eso solo actúa
  con LIVE conectado y al menos un overlay abierto.
- Las frases de relleno son plantillas para no gastar cuota de IA.
