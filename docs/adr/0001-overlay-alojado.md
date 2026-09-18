# ADR 0001 — Overlay alojado: un servidor, un puerto, una clave por overlay

- **Estado:** aceptada (2026-09-18)
- **Decide:** Wilson (desarrollador). El cliente (tarotista) solo recibe una URL.

## Contexto

El producto lo usa un tarotista que **no debe abrir una terminal**. Hasta hoy el
backend y el overlay corrían en la PC del streamer en dos procesos
(`npm start` + `npm run overlay`) y el overlay tenía escrita la dirección
`ws://127.0.0.1:8080`. Eso no se puede alojar ni entregar.

Necesitamos que el backend corra 24/7 en un servidor del desarrollador, se
conecte al LIVE del cliente por su nombre de usuario (el LIVE es público, no
hace falta su contraseña) y sirva el overlay por HTTPS para pegarlo en OBS o
TikTok LIVE Studio.

## Decisión

1. **Un solo servidor HTTP por cliente** (`RealtimeGateway`) que sirve los
   archivos del overlay **y** el WebSocket en la ruta `ws`, en el mismo puerto.
   Escucha solo en `127.0.0.1`; **Caddy** termina TLS en 443 y hace de proxy.
   Localmente sigue funcionando igual: `npm start` y abrir la URL.

2. **Una clave secreta por overlay** (`OVERLAY_KEY`, 32 bytes aleatorios en
   base64url). Va en la URL que se pega en OBS: `https://host/beto/?key=...`.
   - Sin clave correcta: `index.html` responde 401 y la conexión WebSocket se
     rechaza **antes** del upgrade. Los archivos estáticos (js, css, imágenes)
     son públicos: son código abierto y no contienen nada del cliente.
   - La comparación es en tiempo constante.
   - Si el servidor no escucha en loopback y no hay clave, **no arranca**.
   - El HTML lleva `referrer: no-referrer` para que la clave no viaje a Google
     Fonts ni al CDN de TikTok.

3. **Un proceso por cliente**, no un backend multi-cliente. Se despliega con una
   unidad `systemd` plantilla (`tarot@beto.service`) que lee
   `/etc/tarot/beto.env` (0600). Cada instancia tiene su puerto, su usuario de
   TikTok, sus claves de API y su ledger. Caddy enruta `/beto/*` a su puerto.
   - Si el LIVE de un cliente se cae o su IA se satura, no arrastra a los demás.
   - Cortar el servicio a un cliente es `systemctl stop tarot@beto`.
   - No hay código nuevo de "tenants": el aislamiento lo da el sistema operativo.

4. **Defensas en el gateway:** verificación de `Origin` contra `Host` en el
   upgrade, tope de clientes simultáneos, `maxPayload` mínimo, mensajes
   entrantes ignorados, cabeceras de seguridad y CSP en el HTML, `/healthz` sin
   datos sensibles para el monitor.

5. **Secretos solo en el servidor.** Las claves de Gemini y de voz viven en el
   `.env` de cada instancia. El cliente nunca las ve. El repo no contiene ni
   claves ni teléfonos ni usuarios.

## Alternativas descartadas

- **Cloudflare Workers / Pages:** no pueden mantener un proceso con una conexión
  abierta a TikTok durante horas. Pages solo serviría el HTML.
- **Instalable en la PC del cliente:** cero hosting, pero todo el soporte cae
  en el desarrollador (antivirus, actualizaciones, rendimiento) y no escala a
  un segundo cliente.
- **Un backend multi-tenant con una cola por cliente:** más código, un fallo
  compartido, y hoy no hay volumen que lo justifique. Se puede migrar después
  sin cambiar la URL del cliente.
- **Clave en cabecera `Sec-WebSocket-Protocol`** en vez de la query: sacaría la
  clave de los logs del proxy, pero OBS igual necesita la clave en la URL de la
  página. Se compensa no registrando la query en Caddy.

## Consecuencias

- Desaparece `npm run overlay` como paso obligatorio; queda solo para
  desarrollo de la página sin backend (captura de pantallas).
- Aparece la carpeta `deploy/` (Caddyfile, unidad systemd, instalador) y
  `docs/DEPLOY.md`.
- Costo: $0 en Oracle Always Free o ~€12/mes en Hetzner para todos los clientes.
