#!/bin/bash
# UnicornX Aleo — Health check
# Runs via cron: */5 * * * * $HOME/unicornxaleo/deploy/healthcheck.sh
#
# Checks public endpoints and alerts on 5xx/timeouts.
# Exits 1 if either endpoint is unhealthy (so cron MAILTO catches it).

set -uo pipefail

LOG_FILE="${HOME}/unicornxaleo/server/logs/healthcheck.log"
DOMAIN="https://aleo.unicornx.fun"
MAX_RETRIES=3
RETRY_DELAY=5
TIMEOUT=10

mkdir -p "$(dirname "$LOG_FILE")"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Returns HTTP code, or "000" on timeout / connection failure
check_url() {
    local name="$1"
    local url="$2"

    for i in $(seq 1 $MAX_RETRIES); do
        CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" "$url" 2>/dev/null || echo "000")

        if [ "$CODE" = "000" ]; then
            [ "$i" -lt "$MAX_RETRIES" ] && sleep "$RETRY_DELAY" && continue
            log "FAIL: $name timeout/no-response at $url"
            echo "$CODE"
            return 1
        fi

        if [ "$CODE" -ge 500 ]; then
            [ "$i" -lt "$MAX_RETRIES" ] && sleep "$RETRY_DELAY" && continue
            log "FAIL: $name HTTP $CODE at $url"
            echo "$CODE"
            return 1
        fi

        # 2xx/3xx/4xx are acceptable (4xx means app is up, just auth/route)
        echo "$CODE"
        return 0
    done
}

OVERALL=0

API_CODE=$(check_url "API"      "${DOMAIN}/api/info") || OVERALL=1
FE_CODE=$(check_url  "Frontend" "${DOMAIN}/")         || OVERALL=1

if [ "$OVERALL" -eq 0 ]; then
    # Only log periodic OK every ~hour to keep log small
    MIN=$(date +%M)
    if [ "$MIN" = "00" ]; then
        log "OK: api=${API_CODE} frontend=${FE_CODE}"
    fi
else
    echo "UnicornX Aleo health FAIL: api=${API_CODE} frontend=${FE_CODE}" >&2
fi

exit "$OVERALL"
