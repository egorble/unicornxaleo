#!/usr/bin/env bash
###############################################################################
# UnicornX Aleo — First-Time Deploy Script
#
# Assumes: Linux server with Node 20+ already installed.
#
# Usage (one-time setup):
#   chmod +x deploy.sh update.sh
#   bash deploy.sh
#
# What it does:
#   1. Clones unicornxaleo repo into $HOME/unicornxaleo
#   2. Installs frontend deps and builds (dist/)
#   3. Installs server deps
#   4. Installs pm2 globally if missing
#   5. Starts two pm2 processes:
#        - unicornx-backend  (node server/index.js on :5170)
#        - unicornx-frontend (serves frontend/dist on :5171 via `serve`)
#   6. pm2 save && pm2 startup
#   7. Prints URLs and useful commands
###############################################################################

set -euo pipefail

REPO_URL="https://github.com/egorble/unicornxaleo.git"
APP_NAME="unicornxaleo"
APP_DIR="${HOME}/${APP_NAME}"
BACKEND_PORT=5170
FRONTEND_PORT=5171
BACKEND_PM2="unicornx-backend"
FRONTEND_PM2="unicornx-frontend"
DOMAIN="aleo.unicornx.fun"

# Flags
USE_SYSTEMD=0
INSTALL_INFRA=0
for arg in "$@"; do
    case "$arg" in
        --systemd)       USE_SYSTEMD=1 ;;
        --install-infra) INSTALL_INFRA=1 ;;
    esac
done

echo "→ Checking prerequisites"
command -v node >/dev/null 2>&1 || { echo "ERROR: node is not installed. Install Node 20+ first."; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "ERROR: npm is not installed."; exit 1; }
command -v git  >/dev/null 2>&1 || { echo "ERROR: git is not installed."; exit 1; }

NODE_MAJOR="$(node -v | sed -E 's/^v([0-9]+)\..*/\1/')"
if [ "${NODE_MAJOR}" -lt 20 ]; then
    echo "ERROR: Node ${NODE_MAJOR} detected. Node 20+ required."
    exit 1
fi
echo "   node=$(node -v)  npm=$(npm -v)"

echo "→ Cloning repository into ${APP_DIR}"
if [ -d "${APP_DIR}/.git" ]; then
    echo "   Repo already exists at ${APP_DIR} — skipping clone"
else
    cd "${HOME}"
    git clone "${REPO_URL}" "${APP_NAME}"
fi

echo "→ Installing & building frontend"
cd "${APP_DIR}/frontend"
npm ci
npm run build

echo "→ Installing server dependencies"
cd "${APP_DIR}/server"
npm ci

echo "→ Ensuring pm2 is installed"
if ! command -v pm2 >/dev/null 2>&1; then
    echo "   pm2 not found — installing globally"
    npm install -g pm2
else
    echo "   pm2 already installed: $(pm2 -v)"
fi

echo "→ Ensuring 'serve' is installed (for static frontend)"
if ! command -v serve >/dev/null 2>&1; then
    npm install -g serve
else
    echo "   serve already installed: $(serve --version 2>/dev/null || echo present)"
fi

echo "→ Starting backend via pm2 (${BACKEND_PM2} on :${BACKEND_PORT})"
cd "${APP_DIR}/server"
pm2 delete "${BACKEND_PM2}" >/dev/null 2>&1 || true
PORT=${BACKEND_PORT} pm2 start index.js --name "${BACKEND_PM2}" --update-env

echo "→ Starting frontend via pm2 (${FRONTEND_PM2} on :${FRONTEND_PORT})"
cd "${APP_DIR}/frontend"
pm2 delete "${FRONTEND_PM2}" >/dev/null 2>&1 || true
pm2 start serve --name "${FRONTEND_PM2}" -- -s dist -l "${FRONTEND_PORT}"

echo "→ Saving pm2 process list"
pm2 save

echo "→ Configuring pm2 startup (systemd)"
pm2 startup systemd -u "$(whoami)" --hp "${HOME}" || true

# ─────────────────────────────────────────────────────────────
# Infra: nginx + logrotate + cron (healthcheck, backup)
# ─────────────────────────────────────────────────────────────
chmod +x "${APP_DIR}/deploy/backup-db.sh" "${APP_DIR}/deploy/healthcheck.sh" 2>/dev/null || true

if [ "${INSTALL_INFRA}" -eq 1 ]; then
    echo "→ --install-infra: installing nginx config, logrotate, cron jobs"

    if command -v sudo >/dev/null 2>&1 && command -v nginx >/dev/null 2>&1; then
        sudo cp "${APP_DIR}/deploy/nginx.conf" "/etc/nginx/sites-available/${DOMAIN}"
        sudo ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
        sudo nginx -t && sudo systemctl reload nginx || echo "   (nginx -t failed — inspect config before reload)"
    else
        echo "   skipped nginx (sudo or nginx missing)"
    fi

    # Logrotate: expand $HOME in the shipped template before installing
    if command -v sudo >/dev/null 2>&1; then
        TMP_LR="$(mktemp)"
        sed "s#\$HOME#${HOME}#g" "${APP_DIR}/deploy/logrotate.conf" > "$TMP_LR"
        sudo cp "$TMP_LR" /etc/logrotate.d/unicornx
        rm -f "$TMP_LR"
        echo "   installed /etc/logrotate.d/unicornx"
    fi

    # Cron: daily backup + health check every 5 min (user crontab, idempotent)
    CRON_TAG="# unicornx-managed"
    (crontab -l 2>/dev/null | grep -v "$CRON_TAG" ; \
     echo "0 3 * * * ${APP_DIR}/deploy/backup-db.sh ${CRON_TAG}" ; \
     echo "*/5 * * * * ${APP_DIR}/deploy/healthcheck.sh ${CRON_TAG}") | crontab -
    echo "   cron installed: DB backup (03:00 daily), health check (every 5min)"
else
    echo ""
    echo "→ Infra not installed (pm2 is running the app). To install nginx + cron + logrotate, re-run:"
    echo "     bash deploy.sh --install-infra"
fi

if [ "${USE_SYSTEMD}" -eq 1 ]; then
    echo "→ --systemd: installing unicornx-backend.service (alternative to pm2)"
    if command -v sudo >/dev/null 2>&1; then
        USER_NAME="$(whoami)"
        # %i/%h expansion only works with --user or template units; expand manually.
        TMP_UNIT="$(mktemp)"
        sed -e "s#^User=%i#User=${USER_NAME}#" \
            -e "s#%h#${HOME}#g" \
            "${APP_DIR}/deploy/unicornx-backend.service" > "$TMP_UNIT"
        sudo cp "$TMP_UNIT" /etc/systemd/system/unicornx-backend.service
        rm -f "$TMP_UNIT"
        sudo systemctl daemon-reload
        echo "   installed /etc/systemd/system/unicornx-backend.service"
        echo "   NOTE: stop the pm2 backend before enabling systemd to avoid port clash:"
        echo "     pm2 delete ${BACKEND_PM2}"
        echo "     sudo systemctl enable --now unicornx-backend"
    fi
else
    echo ""
    echo "→ Systemd alternative available (pm2 is primary). To install backend as systemd unit:"
    echo "     bash deploy.sh --systemd"
    echo "   Manual install:"
    echo "     sudo cp deploy/unicornx-backend.service /etc/systemd/system/"
    echo "     sudo systemctl daemon-reload && sudo systemctl enable --now unicornx-backend"
fi

echo ""
echo "=============================================================="
echo " UnicornX Aleo deployed successfully."
echo "--------------------------------------------------------------"
echo "  Backend:    http://localhost:${BACKEND_PORT}"
echo "  Backend API health: http://localhost:${BACKEND_PORT}/api/info"
echo "  Frontend:   http://localhost:${FRONTEND_PORT}"
echo ""
echo "  Public domain (configure via nginx): https://aleo.unicornx.fun"
echo "  See nginx/aleo.unicornx.fun.conf for a ready reverse-proxy config."
echo ""
echo " App directory: ${APP_DIR}"
echo ""
echo " Next steps:"
echo "   1. Point the DNS A record for aleo.unicornx.fun at this server's IP."
echo "   2. sudo cp nginx/aleo.unicornx.fun.conf /etc/nginx/sites-available/"
echo "   3. sudo ln -s /etc/nginx/sites-available/aleo.unicornx.fun.conf \\"
echo "                 /etc/nginx/sites-enabled/"
echo "   4. sudo certbot --nginx -d aleo.unicornx.fun      # SSL"
echo "   5. sudo nginx -t && sudo systemctl reload nginx"
echo ""
echo " Useful commands:"
echo "   pm2 status"
echo "   pm2 logs ${BACKEND_PM2}"
echo "   pm2 logs ${FRONTEND_PM2}"
echo "   pm2 restart ${BACKEND_PM2} ${FRONTEND_PM2}"
echo "   bash ${APP_DIR}/update.sh           # pull latest & redeploy"
echo "   bash ${APP_DIR}/deploy/healthcheck.sh   # manual health check"
echo "   ls ${HOME}/unicornxaleo-backups/        # daily data backups"
echo "=============================================================="
