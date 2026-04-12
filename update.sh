#!/usr/bin/env bash
###############################################################################
# UnicornX Aleo — Update/Redeploy Script
#
# Usage (after first-time deploy.sh has been run):
#   chmod +x deploy.sh update.sh    # one time
#   bash update.sh
#
# What it does:
#   1. git pull in app directory
#   2. npm ci + build in frontend/
#   3. npm ci in server/
#   4. pm2 restart unicornx-frontend unicornx-backend
#   5. Health check: curl :5170/api/info and :5171/  (fail loudly on 5xx / no response)
###############################################################################

set -euo pipefail

APP_NAME="unicornxaleo"
# Resolve script directory so update.sh works whether launched from repo or elsewhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# If this script lives inside the repo, use that; otherwise fall back to $HOME/unicornxaleo.
if [ -d "${SCRIPT_DIR}/.git" ] || [ -f "${SCRIPT_DIR}/server/index.js" ]; then
    APP_DIR="${SCRIPT_DIR}"
else
    APP_DIR="${HOME}/${APP_NAME}"
fi

BACKEND_PORT=5170
FRONTEND_PORT=5171
BACKEND_PM2="unicornx-backend"
FRONTEND_PM2="unicornx-frontend"

if [ ! -d "${APP_DIR}/.git" ]; then
    echo "ERROR: ${APP_DIR} is not a git checkout. Run deploy.sh first."
    exit 1
fi

echo "→ Pulling latest changes in ${APP_DIR}"
cd "${APP_DIR}"
git pull

echo "→ Installing & building frontend"
cd "${APP_DIR}/frontend"
npm ci
npm run build

echo "→ Installing server dependencies"
cd "${APP_DIR}/server"
npm ci

echo "→ Restarting pm2 processes"
pm2 restart "${FRONTEND_PM2}" "${BACKEND_PM2}" --update-env

echo "→ Waiting for services to come up"
sleep 3

echo "→ Health check: backend http://localhost:${BACKEND_PORT}/api/info"
BACKEND_CODE="$(curl -s -o /tmp/unicornx_backend_health -w '%{http_code}' --max-time 10 "http://localhost:${BACKEND_PORT}/api/info" || echo '000')"
echo "   HTTP ${BACKEND_CODE}"
if [ "${BACKEND_CODE}" = "000" ]; then
    echo "ERROR: Backend did not respond on :${BACKEND_PORT}"
    exit 1
fi
if [ "${BACKEND_CODE}" -ge 500 ]; then
    echo "ERROR: Backend returned ${BACKEND_CODE} (5xx)"
    cat /tmp/unicornx_backend_health || true
    exit 1
fi

echo "→ Health check: frontend http://localhost:${FRONTEND_PORT}/"
FRONTEND_CODE="$(curl -s -o /tmp/unicornx_frontend_health -w '%{http_code}' --max-time 10 "http://localhost:${FRONTEND_PORT}/" || echo '000')"
echo "   HTTP ${FRONTEND_CODE}"
if [ "${FRONTEND_CODE}" = "000" ]; then
    echo "ERROR: Frontend did not respond on :${FRONTEND_PORT}"
    exit 1
fi
if [ "${FRONTEND_CODE}" -ge 500 ]; then
    echo "ERROR: Frontend returned ${FRONTEND_CODE} (5xx)"
    exit 1
fi

echo ""
echo "=============================================================="
echo " UnicornX Aleo update complete."
echo "   Backend:  http://localhost:${BACKEND_PORT}  (HTTP ${BACKEND_CODE})"
echo "   Frontend: http://localhost:${FRONTEND_PORT} (HTTP ${FRONTEND_CODE})"
echo "=============================================================="
