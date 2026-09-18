# Despliegue — el cliente solo pega una URL

Cómo poner el mago en un servidor para que un tarotista lo use **sin abrir una
terminal**. La decisión de diseño está en [ADR 0001](adr/0001-overlay-alojado.md).

```
   Cliente (OBS / TikTok LIVE Studio)
        │  https://mago.ejemplo.com/beto/?avatar=animado&key=…
        ▼
   ┌─ Servidor ───────────────────────────────────────────┐
   │  Caddy :443 (HTTPS)                                  │
   │    /beto/*  ──►  tarot@beto   127.0.0.1:8081         │
   │    /ana/*   ──►  tarot@ana    127.0.0.1:8082         │
   │                    │  cada uno: su usuario de TikTok, │
   │                    │  sus claves, su ledger           │
   └────────────────────┼─────────────────────────────────┘
                        ▼
                  TikTok LIVE (público, sin contraseña del cliente)
```

## 0. Lo que necesitas antes

| Qué | Dónde | Costo |
|---|---|---|
| Un servidor Ubuntu 24.04 con IP pública | Oracle Cloud Always Free (ARM, 2 núcleos / 12 GB) o cualquier VPS | $0 / ~€12 mes |
| Un dominio o subdominio apuntando a esa IP (registro `A`) | Tu registrador, o DuckDNS gratis | $0–10 al año |
| Puertos 22, 80 y 443 abiertos **en el panel del proveedor** (Oracle: "Security List" de la VCN) | Panel del proveedor | — |
| La clave de Gemini del cliente (o la tuya, si se la cobras) | [Google AI Studio](https://aistudio.google.com/) | ~$5/mes |

> Oracle: crea la instancia con la imagen **Ubuntu 24.04 (aarch64)** y la
> forma `VM.Standard.A1.Flex`. Si dice que no hay capacidad, cambia de
> *availability domain* o vuelve a intentar más tarde.

## 1. Instalar el servidor (una sola vez)

Entra por SSH y ejecuta:

```bash
git clone https://github.com/rslcia11/GeneradorAutomaticoLivesTiktok.git /tmp/tarot
sudo TAROT_DOMAIN=mago.ejemplo.com bash /tmp/tarot/deploy/install.sh
```

Deja instalado Node 24, Caddy con certificado automático, el código en
`/opt/tarot/app` (solo lectura para las instancias) y el firewall. Al terminar
dice `✅ Servidor listo`.

Para **actualizar el código** más adelante, se corre el mismo comando: baja la
rama `main`, reinstala dependencias y reinicia las instancias.

## 2. Crear un cliente

```bash
sudo bash /opt/tarot/app/deploy/nuevo-cliente.sh beto
```

Se abre el editor sobre `/etc/tarot/beto.env`. Rellena:

- `TIKTOK_USERNAME` — el usuario del cliente **sin la @**.
- `GEMINI_API_KEY`.
- `CONTACT_TEXT`, `CONTACT_PHONE` — su frase y su teléfono (o `CONTACT_ENABLED=false`).
- `PROMO_TEXT` si quiere la pastilla fija.

`OVERLAY_KEY` y `GATEWAY_PORT` ya vienen generados: no los toques.

Al guardar, el script enciende `tarot@beto`, registra la ruta `/beto/` en Caddy
e imprime **la URL que le mandas al cliente**:

```
https://mago.ejemplo.com/beto/?avatar=animado&key=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

## 3. Lo que hace el cliente

En OBS (o TikTok LIVE Studio): **Fuentes → Navegador**, pegar la URL, ancho
`1080`, alto `1920`. Nada más. El mago aparece "Conectando..." hasta que el
cliente sale en vivo, y se conecta solo.

La URL es su llave: si la comparte, cualquiera ve su overlay. Si se filtra,
cambia `OVERLAY_KEY` en su `.env`, reinicia la instancia y mándale la nueva.

## 4. Operar

```bash
sudo systemctl status tarot@beto          # ¿está corriendo?
sudo journalctl -u tarot@beto -f          # logs en vivo (🎁, 💎, IA, errores)
sudo systemctl restart tarot@beto         # tras editar su .env
sudo systemctl stop tarot@beto            # cortar el servicio (no pagó, etc.)
curl https://mago.ejemplo.com/beto/healthz  # {"ok":true,"tiktok":"connected",...}
```

Regenerar la clave de un cliente:

```bash
cd /opt/tarot/app && node scripts/make-key.js   # copia la salida a OVERLAY_KEY
sudo nano /etc/tarot/beto.env && sudo systemctl restart tarot@beto
```

## 5. Seguridad: qué protege qué

| Riesgo | Defensa |
|---|---|
| Alguien adivina la dirección del servidor | La página y el WebSocket responden 401 sin `?key=`. La clave tiene 256 bits y se compara en tiempo constante. |
| La clave viaja a otro sitio (Google Fonts, CDN de TikTok) | `Referrer-Policy: no-referrer` en cabecera y en el HTML. |
| La clave queda en logs | Caddy no escribe logs de acceso; la app la enmascara en su log. |
| Otra página web abre el WebSocket con la URL robada | `Origin` debe coincidir con `Host`. |
| Inyección de scripts en el overlay | CSP: scripts solo del propio origen, nunca inline. (`unsafe-eval` queda por PixiJS; ver STATUS.) |
| Un proceso comprometido lee claves de otro cliente | Cada instancia corre con **su propio usuario efímero** (`DynamicUser`) y `ProtectProc=invisible`: no ve los procesos ni el entorno de las demás. El `.env` es `0600 root` y solo systemd lo lee. Solo escribe en su `/var/lib/tarot-<cliente>`. |
| La clave queda en el log de errores de Caddy (upstream caído mientras la instancia reinicia) | El Caddyfile excluye `http.log.error`. Verificar tras instalar: `systemctl stop tarot@beto`, abrir el overlay, y `journalctl -u caddy \| grep key=` debe salir vacío. |
| La página se pide con otra forma (`/%2findex.html`, `/.//index.html`) para saltarse la clave | Las rutas con `//`, `\` o `:` se rechazan, y la clave se exige según el archivo que se serviría, no según cómo se escribió la URL. Con prueba. |
| Una dependencia ejecuta código como root al instalar | `npm ci --ignore-scripts`. |
| Abuso de conexiones | Tope de 8 overlays por instancia; mensajes entrantes ignorados; `maxPayload` 1 KB. |
| Sin HTTPS | Caddy: certificado automático, HSTS. OBS carga `wss://`. |
| Reintentos infinitos agotan la cuota gratis de Euler Stream | Reconexión con espera creciente hasta 2 min: ~720 firmas/día como máximo, bajo el tope de 2.500. |

Lo que **no** cubre: si el cliente pega la URL en un lugar público, es su
llave. Y el contenido del LIVE (comentarios) es texto no confiable: el overlay
lo pinta con `textContent`, nunca como HTML.

## 6. Probar en tu PC antes de desplegar

Es lo mismo, sin Caddy:

```powershell
npm start
# ▶ 🖥️  Overlay para OBS: http://127.0.0.1:8080/?avatar=animado
```

Con `OVERLAY_KEY` en tu `.env`, la URL local también exige la clave, igual que
en el servidor.
