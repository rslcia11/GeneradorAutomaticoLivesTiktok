#!/usr/bin/env bash
#
# Instala el servidor en Ubuntu 24.04 (x86 o ARM, p. ej. Oracle Always Free).
# En máquinas de 1 GB (Oracle E2.1.Micro) crea antes 2 GB de swap.
# Se ejecuta UNA vez, como root:
#
#   sudo TAROT_DOMAIN=mago.ejemplo.com bash deploy/install.sh
#
# Deja: Node 24, Caddy con HTTPS automático, el usuario `tarot`, el código en
# /opt/tarot/app, la unidad tarot@.service y el firewall abierto solo en
# 22, 80 y 443. NO crea ninguna instancia: eso es `deploy/nuevo-cliente.sh`.
#
# Idempotente: se puede volver a correr para actualizar el código.

set -euo pipefail

: "${TAROT_DOMAIN:?Define TAROT_DOMAIN=tu.dominio.com}"
REPO="${TAROT_REPO:-https://github.com/rslcia11/GeneradorAutomaticoLivesTiktok.git}"
BRANCH="${TAROT_BRANCH:-main}"
APP=/opt/tarot/app

if [[ ! -e /swapfile ]] && (( $(awk '/MemTotal/ {print $2}' /proc/meminfo) < 1500000 )); then
    echo "▶ Swap de 2 GB (poca RAM)"
    fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
    echo "/swapfile none swap sw 0 0" >> /etc/fstab
    echo "vm.swappiness=10" > /etc/sysctl.d/90-swap.conf && sysctl -q -p /etc/sysctl.d/90-swap.conf
fi

echo "▶ Paquetes base"
apt-get update -qq
apt-get install -y -qq curl git ufw debian-keyring debian-archive-keyring apt-transport-https ca-certificates

if ! command -v node >/dev/null || [[ "$(node -v)" != v24* ]]; then
    echo "▶ Node 24"
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
    apt-get install -y -qq nodejs
fi

if ! command -v caddy >/dev/null; then
    echo "▶ Caddy"
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy
fi

echo "▶ Grupo de lectura del código"
# Cada instancia corre con su propio usuario efímero (DynamicUser); este
# grupo solo le permite leer /opt/tarot. No hay un usuario `tarot` que inicie sesión.
getent group tarot >/dev/null || groupadd --system tarot
install -d -o root -g root -m 0700 /etc/tarot

echo "▶ Código ($BRANCH)"
if [[ -d $APP/.git ]]; then
    git -C "$APP" fetch --quiet origin "$BRANCH"
    git -C "$APP" checkout --quiet "origin/$BRANCH"
else
    git clone --quiet --branch "$BRANCH" "$REPO" "$APP"
fi
# --ignore-scripts: npm corre como root; ninguna dependencia necesita scripts de instalación.
(cd "$APP" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)
chown -R root:tarot /opt/tarot
chmod -R g-w,o-rwx /opt/tarot

echo "▶ systemd y Caddy"
install -m 0644 "$APP/deploy/tarot@.service" /etc/systemd/system/tarot@.service
systemctl daemon-reload

install -d -m 0755 /etc/caddy/clientes
# Solo la primera vez: después el Caddyfile es del servidor, no del repo.
[[ -e /etc/caddy/Caddyfile.tarot ]] || {
    install -m 0644 "$APP/deploy/Caddyfile" /etc/caddy/Caddyfile
    touch /etc/caddy/Caddyfile.tarot
}
mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironment=TAROT_DOMAIN=%s\n' "$TAROT_DOMAIN" > /etc/systemd/system/caddy.service.d/tarot.conf
systemctl daemon-reload
systemctl enable --now caddy
systemctl reload caddy || systemctl restart caddy

echo "▶ Firewall"
if iptables -S INPUT 2>/dev/null | grep -q -- '-j REJECT --reject-with icmp-host-prohibited'; then
    # Imágenes de Oracle Cloud: traen iptables propio que rechaza todo menos
    # el 22 (aunque el panel diga otra cosa). Se abre ahí; ufw encima sería
    # un segundo firewall peleando con el primero.
    for port in 80 443; do
        iptables -C INPUT -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT 2>/dev/null ||
            iptables -I INPUT 5 -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT
    done
    netfilter-persistent save >/dev/null 2>&1 || iptables-save > /etc/iptables/rules.v4
else
    ufw allow OpenSSH >/dev/null
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
    ufw --force enable >/dev/null
fi

# Las instancias ya creadas se reinician con el código nuevo.
for unit in $(systemctl list-units --plain --no-legend 'tarot@*' | awk '{print $1}'); do
    systemctl restart "$unit"
done

cat <<EOF

✅ Servidor listo en https://$TAROT_DOMAIN
   Siguiente: sudo bash $APP/deploy/nuevo-cliente.sh beto
EOF
