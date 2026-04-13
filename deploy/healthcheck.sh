#!/bin/bash
# UnicornX Aleo — Health check & auto-restart
# Runs via cron: */5 * * * * /opt/unicornxaleo/deploy/healthcheck.sh
#
# For cron alerting, set MAILTO= at the top of the crontab. Any non-zero
# exit (below) produces stderr output that cron mails to MAILTO.

set -uo pipefail

APP_DIR="/opt/unicornxaleo"
LOG_FILE="${APP_DIR}/server/logs/healthcheck.log"
MAX_RETRIES=3
RETRY_DELAY=5

mkdir -p "$(dirname "$LOG_FILE")"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

FAIL=0

check_service() {
    local name="$1"
    local url="$2"
    local service="$3"

    local HTTP_CODE="000"
    for i in $(seq 1 $MAX_RETRIES); do
        # Generous timeout — backend can be CPU-bound generating ZK proofs.
        HTTP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 30 "$url" 2>/dev/null || echo "000")

        if [ "$HTTP_CODE" = "200" ]; then
            return 0
        fi

        if [ "$i" -lt "$MAX_RETRIES" ]; then
            sleep "$RETRY_DELAY"
        fi
    done

    # Don't restart the backend mid-transaction. `leo execute` pins CPU at
    # 100% for several minutes generating ZK proofs, during which routine
    # endpoints time out — that's expected, not a failure mode.
    if [ "$service" = "unicornx-backend" ] && pgrep -x leo >/dev/null 2>&1; then
        log "INFO: $name slow but leo execute in progress — skipping restart"
        return 0
    fi

    # Also skip if the systemd unit is up but just busy.
    if systemctl is-active --quiet "$service"; then
        log "INFO: $name unhealthy (HTTP $HTTP_CODE) but $service is active — skipping restart"
        return 0
    fi

    # Service genuinely down — restart and re-check
    log "WARN: $name unhealthy (HTTP $HTTP_CODE after $MAX_RETRIES retries). Restarting $service..."
    systemctl restart "$service" 2>/dev/null || true
    sleep 5

    HTTP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
        log "OK: $name recovered after restart"
    else
        log "ERROR: $name still unhealthy after restart (HTTP $HTTP_CODE)"
        # Emit to stderr so cron MAILTO catches it
        echo "UnicornX Aleo: $name DOWN (HTTP $HTTP_CODE) at $(date)" >&2
        FAIL=1
    fi
}

# Public HTTPS endpoints
check_service "API"      "https://aleo.unicornx.fun/api/info" "unicornx-backend"
check_service "Frontend" "https://aleo.unicornx.fun/"         "unicornx-frontend"

# nginx
if ! systemctl is-active --quiet nginx; then
    log "WARN: nginx is down. Restarting..."
    systemctl restart nginx 2>/dev/null || true
    if systemctl is-active --quiet nginx; then
        log "OK: nginx restarted"
    else
        echo "UnicornX Aleo: nginx DOWN at $(date)" >&2
        FAIL=1
    fi
fi

exit $FAIL
