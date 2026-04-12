#!/bin/bash
###############################################################################
# UnicornX Aleo — Quick Update from GitHub
#
# Usage: sudo bash /opt/unicornxaleo/update.sh
#
# What it does:
#   1. git pull from GitHub
#   2. npm ci for server (if package.json changed)
#   3. npm run build for frontend
#   4. Restart systemd services
#   5. Health check both public endpoints
#
# Safe to run anytime. Does NOT touch: env, SSL, nginx config, data.
###############################################################################

set -euo pipefail

APP_DIR="/opt/unicornxaleo"
APP_USER="unicornx"
DOMAIN="aleo.unicornx.fun"
REPO="https://github.com/egorble/unicornxaleo.git"
BACKEND_PORT=5170
FRONTEND_PORT=5171

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[UPDATE]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

trap 'echo -e "${RED}[FAIL]${NC} update.sh aborted at line $LINENO"' ERR

if [ "$(id -u)" -ne 0 ]; then
    echo "Re-executing with sudo..."
    exec sudo -E bash "$0" "$@"
fi

git config --global --add safe.directory "${APP_DIR}" 2>/dev/null || true

# ─── Ensure remote is correct ───
if [ -d "${APP_DIR}/.git" ]; then
    CURRENT_REMOTE=$(sudo -u "$APP_USER" git -C "$APP_DIR" remote get-url origin 2>/dev/null || echo "")
    if [ "$CURRENT_REMOTE" != "$REPO" ]; then
        sudo -u "$APP_USER" git -C "$APP_DIR" remote remove origin 2>/dev/null || true
        sudo -u "$APP_USER" git -C "$APP_DIR" remote add origin "$REPO"
        log "Fixed remote origin → $REPO"
    fi
fi

# ─── Clone or pull ───
if [ ! -d "${APP_DIR}/.git" ]; then
    log "First-time setup — cloning repo..."
    TEMP_DIR=$(mktemp -d)
    [ -f "${APP_DIR}/.env" ] && cp "${APP_DIR}/.env" "${TEMP_DIR}/.env"
    [ -d "${APP_DIR}/server/data" ] && cp -a "${APP_DIR}/server/data" "${TEMP_DIR}/data" 2>/dev/null || true

    rm -rf "${APP_DIR:?}/.git"
    sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && git init && git remote add origin '$REPO' && git fetch origin main && git checkout -f main"

    [ -f "${TEMP_DIR}/.env" ] && cp "${TEMP_DIR}/.env" "${APP_DIR}/.env"
    [ -d "${TEMP_DIR}/data" ] && cp -an "${TEMP_DIR}/data/." "${APP_DIR}/server/data/" 2>/dev/null || true
    rm -rf "$TEMP_DIR"

    chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
    log "Repo cloned"
else
    log "Pulling latest changes..."
    sudo -u "$APP_USER" git -C "$APP_DIR" fetch origin main
    sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard origin/main
    log "Pull complete"
fi

echo ""
log "Recent commits:"
sudo -u "$APP_USER" git -C "$APP_DIR" log --oneline -5
echo ""

# ─── Install server deps ───
log "Installing server dependencies..."
sudo -u "$APP_USER" bash -c "cd '${APP_DIR}/server' && NODE_ENV=production npm ci --omit=dev --silent 2>&1 | tail -3 || NODE_ENV=production npm install --omit=dev --silent 2>&1 | tail -3"

# ─── Build frontend ───
# Must install devDependencies (vite, typescript, tailwind) to build — override prod NODE_ENV.
log "Installing frontend dependencies & building..."
sudo -u "$APP_USER" bash -c "cd '${APP_DIR}/frontend' && NODE_ENV=development npm ci --include=dev 2>&1 | tail -3 || NODE_ENV=development npm install --include=dev 2>&1 | tail -3"
sudo -u "$APP_USER" bash -c "cd '${APP_DIR}/frontend' && NODE_ENV=production npm run build"
log "Frontend built"

# ─── Ensure data directories exist ───
mkdir -p "${APP_DIR}/server/data"
mkdir -p "${APP_DIR}/server/db"
mkdir -p "${APP_DIR}/server/logs"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# ─── Restart services ───
log "Restarting services..."
systemctl daemon-reload
systemctl restart unicornx-backend
systemctl restart unicornx-frontend

sleep 3

# ─── Verify ───
BE_OK=$(systemctl is-active unicornx-backend)
FE_OK=$(systemctl is-active unicornx-frontend)
NGINX_OK=$(systemctl is-active nginx)

echo ""
echo -e "  ${CYAN}Services:${NC}"
echo -e "  unicornx-backend:    ${BE_OK} $([ "$BE_OK" = "active" ] && echo -e "${GREEN}OK${NC}" || echo -e "${RED}FAIL${NC}")"
echo -e "  unicornx-frontend:   ${FE_OK} $([ "$FE_OK" = "active" ] && echo -e "${GREEN}OK${NC}" || echo -e "${RED}FAIL${NC}")"
echo -e "  nginx:               ${NGINX_OK} $([ "$NGINX_OK" = "active" ] && echo -e "${GREEN}OK${NC}" || echo -e "${RED}FAIL${NC}")"
echo ""

# ─── Health checks (public HTTPS, then local if public fails) ───
check_http() {
    local label="$1" url="$2"
    local code
    code=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")
    if [ "$code" = "200" ]; then
        echo -e "  ${label}: ${code} ${GREEN}OK${NC}"
        return 0
    else
        echo -e "  ${label}: ${code} ${RED}FAIL${NC}"
        return 1
    fi
}

echo -e "  ${CYAN}Health checks:${NC}"
FAIL=0
check_http "https://${DOMAIN}/api/info " "https://${DOMAIN}/api/info" || FAIL=1
check_http "https://${DOMAIN}/         " "https://${DOMAIN}/"         || FAIL=1
check_http "http://127.0.0.1:${BACKEND_PORT}/api/info " "http://127.0.0.1:${BACKEND_PORT}/api/info" || true
check_http "http://127.0.0.1:${FRONTEND_PORT}/       " "http://127.0.0.1:${FRONTEND_PORT}/"       || true

echo ""
log "Recent backend logs:"
journalctl -u unicornx-backend -n 20 --no-pager || true

echo ""
if [ "$FAIL" -ne 0 ]; then
    err "One or more public endpoints returned non-200. Investigate before declaring success."
fi

log "Update complete!"
