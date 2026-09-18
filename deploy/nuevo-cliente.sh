#!/usr/bin/env bash
#
# Crea la instancia de un cliente nuevo:
#
#   sudo bash deploy/nuevo-cliente.sh beto
#
# Genera /etc/tarot/beto.env con una OVERLAY_KEY nueva y el siguiente puerto
# libre, abre el editor para completar TIKTOK_USERNAME y las claves de API,
# escribe la ruta /beto/ en Caddy, enciende tarot@beto y muestra la URL que
# se le entrega al cliente.

set -euo pipefail

NAME="${1:?Uso: nuevo-cliente.sh <nombre-sin-espacios>}"
[[ "$NAME" =~ ^[a-z0-9-]+$ ]] || { echo "El nombre solo admite a-z, 0-9 y guion"; exit 1; }

APP=/opt/tarot/app
ENV_FILE=/etc/tarot/$NAME.env
DOMAIN=$(sed -n 's/^Environment=TAROT_DOMAIN=//p' /etc/systemd/system/caddy.service.d/tarot.conf)

if [[ -e $ENV_FILE ]]; then
    echo "Ya existe $ENV_FILE. Para regenerar la clave, edítalo y reinicia tarot@$NAME."
    exit 1
fi

# Siguiente puerto: 8081, 8082, ... según los .env existentes.
# `|| true`: en el primer cliente no hay ningún .env y grep falla (set -e).
LAST=$(grep -hs '^GATEWAY_PORT=' /etc/tarot/*.env | cut -d= -f2 | sort -n | tail -1 || true)
PORT=$(( ${LAST:-8080} + 1 ))
KEY=$(cd "$APP" && node scripts/make-key.js)

install -m 0600 -o root -g root "$APP/deploy/instancia.env.template" "$ENV_FILE"
sed -i "s/^GATEWAY_PORT=.*/GATEWAY_PORT=$PORT/; s/^OVERLAY_KEY=.*/OVERLAY_KEY=$KEY/" "$ENV_FILE"

echo "▶ Completa TIKTOK_USERNAME, GEMINI_API_KEY y los datos del cliente:"
"${EDITOR:-nano}" "$ENV_FILE"

printf 'handle_path /%s/* {\n    reverse_proxy 127.0.0.1:%s\n}\n' "$NAME" "$PORT" > "/etc/caddy/clientes/$NAME.caddy"
# El dominio vive en el entorno del servicio de Caddy, no en esta shell.
TAROT_DOMAIN="$DOMAIN" caddy validate --config /etc/caddy/Caddyfile >/dev/null
systemctl reload caddy

systemctl enable --now "tarot@$NAME"

cat <<EOF

✅ Instancia tarot@$NAME en el puerto $PORT, ruta https://$DOMAIN/$NAME/

   URL para OBS / TikTok LIVE Studio (fuente de navegador, 1080×1920):

       https://$DOMAIN/$NAME/?avatar=animado&key=$KEY

   Logs:  sudo journalctl -u tarot@$NAME -f
EOF
