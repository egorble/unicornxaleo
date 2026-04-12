#!/bin/bash
# UnicornX Aleo — Daily backup of server data
# Runs via cron: 0 3 * * * $HOME/unicornxaleo/deploy/backup-db.sh
#
# Aleo build has no SQL DB; we back up:
#   - server/data/daily-scores.json (if exists)
#   - server/db/*                    (any files, reserved for future)

set -uo pipefail

APP_DIR="${HOME}/unicornxaleo"
BACKUP_DIR="${HOME}/unicornxaleo-backups"
LOG_FILE="${APP_DIR}/server/logs/backup.log"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=14

mkdir -p "$BACKUP_DIR"
mkdir -p "$(dirname "$LOG_FILE")"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

ARCHIVE="${BACKUP_DIR}/unicornx_${TIMESTAMP}.tar.gz"

# Build a list of existing items to back up
ITEMS=()
[ -f "${APP_DIR}/server/data/daily-scores.json" ] && ITEMS+=("server/data/daily-scores.json")
if [ -d "${APP_DIR}/server/db" ] && [ -n "$(ls -A "${APP_DIR}/server/db" 2>/dev/null)" ]; then
    ITEMS+=("server/db")
fi

if [ "${#ITEMS[@]}" -eq 0 ]; then
    log "SKIP: nothing to back up (no daily-scores.json, empty server/db)"
    exit 0
fi

cd "$APP_DIR"
if tar -czf "$ARCHIVE" "${ITEMS[@]}" 2>/dev/null; then
    SIZE=$(stat -c%s "$ARCHIVE" 2>/dev/null || echo 0)
    log "OK: backup ${ARCHIVE} (${SIZE}B) items=${ITEMS[*]}"
else
    log "ERROR: tar failed for ${ARCHIVE}"
    rm -f "$ARCHIVE"
    exit 1
fi

# Rotate: keep last N days
DELETED=$(find "$BACKUP_DIR" -name "unicornx_*.tar.gz" -mtime +${KEEP_DAYS} -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
    log "Cleaned up $DELETED old backups (>${KEEP_DAYS} days)"
fi
