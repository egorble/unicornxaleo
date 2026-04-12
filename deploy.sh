#!/bin/bash
###############################################################################
# UnicornX Aleo — Production Deployment Script
# Domain: aleo.unicornx.fun
#
# First deploy:
#   1. Create server env: sudo mkdir -p /opt/unicornxaleo/server
#                         sudo nano /opt/unicornxaleo/.env
#   2. Run:               sudo bash deploy.sh
#
# Update from GitHub:
#   sudo bash /opt/unicornxaleo/update.sh
#
# What it does:
#   - Installs Node.js 20, nginx, certbot, git, curl, jq
#   - Creates `unicornx` system user and /opt/unicornxaleo
#   - Clones/pulls repo, installs deps, builds frontend
#   - Configures nginx with SSL (Let's Encrypt via certbot --nginx)
#   - Installs systemd services (backend :5170, frontend :5171) with auto-restart
#   - Configures data backups, health checks, log rotation
#
# Safe to re-run (idempotent).
###############################################################################

set -euo pipefail

# ─── Configuration ───
DOMAIN="aleo.unicornx.fun"
APP_DIR="/opt/unicornxaleo"
APP_USER="unicornx"
ENV_FILE="${APP_DIR}/.env"
REPO="https://github.com/egorble/unicornxaleo.git"
CERTBOT_WEBROOT="/var/www/certbot"
ADMIN_EMAIL="admin@unicornx.fun"
BACKEND_PORT=5170
FRONTEND_PORT=5171

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
step() { echo -e "\n${CYAN}═══ $1 ═══${NC}"; }

trap 'echo -e "${RED}[FAIL]${NC} deploy.sh aborted at line $LINENO"' ERR

# ─── Pre-flight ───
if [ "$(id -u)" -ne 0 ]; then
    echo "Re-executing with sudo..."
    exec sudo -E bash "$0" "$@"
fi

# Detect project root (where this script lives)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"

log "Project directory: ${PROJECT_DIR}"
log "Target directory:  ${APP_DIR}"
log "Domain:            ${DOMAIN}"
log "App user:          ${APP_USER}"

###############################################################################
# STEP 1: Install system dependencies
###############################################################################
step "1/10 — Installing system dependencies"

apt-get update -qq
apt-get install -y -qq curl gnupg2 ca-certificates lsb-release software-properties-common rsync git jq

# Node.js 20.x (via NodeSource)
if ! command -v node &>/dev/null || [[ "$(node -v)" != v20* && "$(node -v)" != v22* ]]; then
    log "Installing Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
else
    log "Node.js $(node -v) already installed"
fi

# nginx
if ! command -v nginx &>/dev/null; then
    log "Installing nginx..."
    apt-get install -y -qq nginx
else
    log "nginx already installed"
fi

# certbot + nginx plugin
if ! command -v certbot &>/dev/null; then
    log "Installing certbot..."
    apt-get install -y -qq certbot python3-certbot-nginx
else
    log "certbot already installed"
fi

log "Node: $(node -v) | npm: $(npm -v) | nginx: $(nginx -v 2>&1 | cut -d/ -f2)"

###############################################################################
# STEP 2: Create app user
###############################################################################
step "2/10 — Setting up app user"

if id "$APP_USER" &>/dev/null; then
    log "User '$APP_USER' already exists"
else
    useradd --system --shell /usr/sbin/nologin --home-dir "$APP_DIR" --create-home "$APP_USER"
    log "Created system user '$APP_USER'"
fi

###############################################################################
# STEP 3: Create directory structure
###############################################################################
step "3/10 — Creating directory structure"

mkdir -p "${APP_DIR}"/{server,frontend,deploy}
mkdir -p "${APP_DIR}/server/data"
mkdir -p "${APP_DIR}/server/db"
mkdir -p "${APP_DIR}/server/logs"
mkdir -p "$CERTBOT_WEBROOT"
mkdir -p "/opt/unicornxaleo-backups"

chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
chown -R "$APP_USER":"$APP_USER" "/opt/unicornxaleo-backups"

log "Directories created at ${APP_DIR}"

###############################################################################
# STEP 4: Clone/pull from GitHub
###############################################################################
step "4/10 — Fetching code from GitHub"

git config --global --add safe.directory "${APP_DIR}" 2>/dev/null || true

if [ -d "${APP_DIR}/.git" ]; then
    log "Repo exists — pulling latest..."
    sudo -u "$APP_USER" git -C "${APP_DIR}" fetch origin
    # Detect default branch (main / master / other) — avoids hardcoding.
    DEFAULT_BRANCH=$(sudo -u "$APP_USER" git -C "${APP_DIR}" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "")
    if [ -z "$DEFAULT_BRANCH" ]; then
        DEFAULT_BRANCH=$(sudo -u "$APP_USER" git -C "${APP_DIR}" ls-remote --symref origin HEAD 2>/dev/null | awk '/^ref:/ {sub("refs/heads/",""); print $2; exit}')
    fi
    if [ -z "$DEFAULT_BRANCH" ]; then
        err "Could not determine default branch on origin. Has the repo been pushed yet?
Push from your local machine first:
  git push -u origin main"
    fi
    log "Using default branch: ${DEFAULT_BRANCH}"
    sudo -u "$APP_USER" git -C "${APP_DIR}" reset --hard "origin/${DEFAULT_BRANCH}"
else
    log "Cloning repo into ${APP_DIR}..."
    # Save .env before clone
    TEMP_DIR=$(mktemp -d)
    [ -f "$ENV_FILE" ] && cp "$ENV_FILE" "${TEMP_DIR}/.env"
    [ -d "${APP_DIR}/server/data" ] && cp -a "${APP_DIR}/server/data" "${TEMP_DIR}/data" 2>/dev/null || true

    git clone "$REPO" "${APP_DIR}_tmp"
    cp -a "${APP_DIR}_tmp/." "${APP_DIR}/"
    rm -rf "${APP_DIR}_tmp"

    [ -f "${TEMP_DIR}/.env" ] && cp "${TEMP_DIR}/.env" "$ENV_FILE"
    [ -d "${TEMP_DIR}/data" ] && cp -an "${TEMP_DIR}/data/." "${APP_DIR}/server/data/" 2>/dev/null || true
    rm -rf "$TEMP_DIR"

    chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
fi

log "Code synced from GitHub"

###############################################################################
# STEP 5: Environment variables
###############################################################################
step "5/10 — Configuring environment"

if [ -f "$ENV_FILE" ]; then
    log "Environment file found at ${ENV_FILE}"
else
    err "Environment file not found at ${ENV_FILE}
Create it manually before running this script:

  sudo mkdir -p ${APP_DIR}
  sudo nano ${ENV_FILE}

Required variables:
  NODE_ENV=production
  PORT=${BACKEND_PORT}
  PROGRAM_ID=unicornx_v3.aleo
  ADMIN_PRIVATE_KEY=<aleo_admin_private_key>
  ADMIN_ADDRESS=<aleo_admin_address>
  ADMIN_API_KEY=<long_random_string>"
fi

chmod 600 "$ENV_FILE"
chown "$APP_USER":"$APP_USER" "$ENV_FILE"

###############################################################################
# STEP 6: Install dependencies & build
###############################################################################
step "6/10 — Installing dependencies & building frontend"

# Server (production deps only — no devDeps needed at runtime)
log "Installing server dependencies..."
sudo -u "$APP_USER" bash -c "cd '${APP_DIR}/server' && NODE_ENV=production npm ci --omit=dev --silent 2>&1 | tail -1 || NODE_ENV=production npm install --omit=dev --silent 2>&1 | tail -1"
log "Server deps installed"

# Frontend — MUST install devDependencies (vite, typescript, tailwind are devDeps).
# Explicitly override NODE_ENV so the operator's prod .env doesn't cause npm to skip them.
# --legacy-peer-deps handles React 19 peer-dep ERESOLVE conflicts common in the Aleo wallet adapters.
log "Installing frontend dependencies & building..."
set +e
sudo -u "$APP_USER" bash -c "cd '${APP_DIR}/frontend' && NODE_ENV=development npm ci --include=dev --legacy-peer-deps"
CI_RC=$?
if [ $CI_RC -ne 0 ]; then
    warn "npm ci failed (rc=$CI_RC) — falling back to npm install"
    sudo -u "$APP_USER" bash -c "cd '${APP_DIR}/frontend' && NODE_ENV=development npm install --include=dev --legacy-peer-deps" \
        || err "Frontend dependency install failed. Check /opt/unicornxaleo/.npm/_logs/"
fi
set -e

# Verify vite is actually present before trying to build
if [ ! -x "${APP_DIR}/frontend/node_modules/.bin/vite" ]; then
    err "vite binary missing at ${APP_DIR}/frontend/node_modules/.bin/vite after install.
Try manually:
  cd ${APP_DIR}/frontend
  sudo -u ${APP_USER} bash -c 'NODE_ENV=development npm install --include=dev --legacy-peer-deps'
  ls node_modules/.bin/vite"
fi

sudo -u "$APP_USER" bash -c "cd '${APP_DIR}/frontend' && NODE_ENV=production npm run build"
log "Frontend built at ${APP_DIR}/frontend/dist"

# Pre-warm `serve` so the systemd unit starts fast (npx would otherwise download)
log "Ensuring 'serve' is cached for the app user..."
sudo -u "$APP_USER" bash -c "npx --yes serve --version >/dev/null 2>&1 || true"

# Final ownership
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

###############################################################################
# STEP 7: Install systemd services
###############################################################################
step "7/10 — Installing systemd services"

# Substitute @USER@ / @HOME@ placeholders then write to /etc/systemd/system/
install_unit() {
    local name="$1"
    local src="${APP_DIR}/deploy/${name}"
    local dst="/etc/systemd/system/${name}"
    if [ ! -f "$src" ]; then
        err "Missing systemd unit template: $src"
    fi
    sed -e "s|@USER@|${APP_USER}|g" -e "s|@HOME@|${APP_DIR}|g" "$src" > "$dst"
    chmod 644 "$dst"
    log "Installed $dst"
}

install_unit "unicornx-backend.service"
install_unit "unicornx-frontend.service"

# Clean up legacy pm2 processes if any
if command -v pm2 &>/dev/null; then
    sudo -u "$APP_USER" pm2 delete unicornx-backend 2>/dev/null || true
    sudo -u "$APP_USER" pm2 delete unicornx-frontend 2>/dev/null || true
fi

systemctl daemon-reload
systemctl enable unicornx-backend
systemctl enable unicornx-frontend

# Restart fresh
systemctl stop unicornx-backend 2>/dev/null || true
systemctl stop unicornx-frontend 2>/dev/null || true
sleep 2
fuser -k ${BACKEND_PORT}/tcp 2>/dev/null || true
fuser -k ${FRONTEND_PORT}/tcp 2>/dev/null || true
sleep 1

systemctl start unicornx-backend
systemctl start unicornx-frontend

log "Services installed and started"

sleep 3
for svc in unicornx-backend unicornx-frontend; do
    if systemctl is-active --quiet "$svc"; then
        log "${svc}: RUNNING"
    else
        warn "${svc}: NOT RUNNING — check: journalctl -u ${svc} -n 50"
    fi
done

###############################################################################
# STEP 8: Configure nginx
###############################################################################
step "8/10 — Configuring nginx"

NGINX_CONF="/etc/nginx/sites-available/${DOMAIN}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"

if [ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
    log "No SSL cert yet — installing temporary HTTP config for certbot..."
    cat > "$NGINX_CONF" << TMPNGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root ${CERTBOT_WEBROOT};
        allow all;
    }

    location / {
        return 200 'UnicornX Aleo setup in progress...';
        add_header Content-Type text/plain;
    }
}
TMPNGINX
else
    log "SSL cert exists — installing full nginx config..."
    cp "${APP_DIR}/deploy/nginx.conf" "$NGINX_CONF"
fi

ln -sf "$NGINX_CONF" "$NGINX_ENABLED"
rm -f /etc/nginx/sites-enabled/default

nginx -t
# Start nginx if not running, otherwise reload. Also enable at boot.
systemctl enable nginx >/dev/null 2>&1 || true
if systemctl is-active --quiet nginx; then
    systemctl reload nginx
    log "nginx reloaded"
else
    systemctl start nginx
    log "nginx started"
fi

###############################################################################
# STEP 9: SSL Certificate (Let's Encrypt via certbot --nginx)
###############################################################################
step "9/10 — SSL Certificate"

if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
    log "SSL certificate already exists for ${DOMAIN}"
    EXPIRY=$(openssl x509 -enddate -noout -in "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" | cut -d= -f2)
    log "Certificate expires: ${EXPIRY}"
    certbot renew --quiet --no-self-upgrade 2>/dev/null || true
else
    log "Requesting SSL certificate for ${DOMAIN}..."
    certbot --nginx \
        -d "$DOMAIN" \
        --non-interactive \
        --agree-tos \
        -m "$ADMIN_EMAIL" \
        --no-eff-email \
        --redirect || warn "certbot --nginx failed; falling back to webroot"

    if [ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
        certbot certonly \
            --webroot \
            --webroot-path="$CERTBOT_WEBROOT" \
            --domain "$DOMAIN" \
            --non-interactive \
            --agree-tos \
            --email "$ADMIN_EMAIL" \
            --no-eff-email
    fi

    if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
        log "SSL certificate obtained!"
        cp "${APP_DIR}/deploy/nginx.conf" "$NGINX_CONF"
        nginx -t
        systemctl reload nginx
        log "nginx updated with SSL config"
    else
        err "Failed to obtain SSL certificate. Check DNS: dig ${DOMAIN} should point to this server's IP."
    fi
fi

systemctl enable --now certbot.timer 2>/dev/null || true

###############################################################################
# STEP 10: Cron jobs, log rotation, healthcheck
###############################################################################
step "10/10 — Cron jobs & log rotation"

chmod +x "${APP_DIR}/deploy/backup-db.sh"
chmod +x "${APP_DIR}/deploy/healthcheck.sh"
chmod +x "${APP_DIR}/update.sh" 2>/dev/null || true

# Root crontab: health check runs every 5min (needs systemctl), backup at 03:00
CRON_TAG="# unicornx-managed"
(crontab -l 2>/dev/null | grep -v "$CRON_TAG") | {
    cat
    echo "MAILTO=${ADMIN_EMAIL}"
    echo "0 3 * * * ${APP_DIR}/deploy/backup-db.sh ${CRON_TAG}"
    echo "*/5 * * * * ${APP_DIR}/deploy/healthcheck.sh ${CRON_TAG}"
} | crontab -

log "Cron installed: data backup (03:00 daily), health check (every 5min)"

cp "${APP_DIR}/deploy/logrotate.conf" /etc/logrotate.d/unicornx
log "Log rotation configured"

###############################################################################
# Verification
###############################################################################
step "Deployment Complete"

echo ""
log "Domain:   https://${DOMAIN}"
log "API:     https://${DOMAIN}/api/info"
log "Frontend: https://${DOMAIN}/"
echo ""

API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:${BACKEND_PORT}/api/info" 2>/dev/null || echo "000")
FE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:${FRONTEND_PORT}/" 2>/dev/null || echo "000")

echo -e "  ${CYAN}Local services:${NC}"
echo -e "  backend  :${BACKEND_PORT}/api/info    ${API_STATUS} $([ "$API_STATUS" = "200" ] && echo -e "${GREEN}OK${NC}" || echo -e "${RED}FAIL${NC}")"
echo -e "  frontend :${FRONTEND_PORT}/              ${FE_STATUS} $([ "$FE_STATUS" = "200" ] && echo -e "${GREEN}OK${NC}" || echo -e "${RED}FAIL${NC}")"
echo ""

echo -e "${CYAN}Useful commands:${NC}"
echo "  sudo bash ${APP_DIR}/update.sh           # Update from GitHub"
echo "  systemctl status unicornx-backend        # backend status"
echo "  systemctl status unicornx-frontend       # frontend status"
echo "  journalctl -u unicornx-backend -f        # backend logs (live)"
echo "  journalctl -u unicornx-frontend -f       # frontend logs (live)"
echo "  systemctl restart unicornx-backend       # restart backend"
echo "  nginx -t && systemctl reload nginx       # reload nginx"
echo "  certbot renew --dry-run                  # test cert renewal"
echo "  ls /opt/unicornxaleo-backups/            # data backups"
echo "  tail -f ${APP_DIR}/server/logs/healthcheck.log"
echo ""
echo -e "${YELLOW}If services fail, check:${NC}"
echo "  - Secrets in ${ENV_FILE}"
echo "  - DNS: dig ${DOMAIN} → should return this server's IP"
echo "  - Firewall: ports 80, 443 open"
echo ""
