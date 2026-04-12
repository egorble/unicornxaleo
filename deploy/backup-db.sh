#!/bin/bash
# UnicornX Aleo — Daily data backup
# Runs via cron: 0 3 * * * /opt/unicornxaleo/deploy/backup-db.sh
#
# Aleo backend has no SQL database — game state lives on-chain and in JSON
# files under server/data/ (e.g. daily-scores.json). Also archives server/db/
# if present (future-proof: sqlite/leveldb caches).

set -euo pipefail

APP_DIR="/opt/unicornxaleo"
BACKUP_DIR="/opt/unicornxaleo-backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=14
LOG_FILE="${APP_DIR}/server/logs/backup.log"

mkdir -p "$BACKUP_DIR"
mkdir -p "$(dirname "$LOG_FILE")"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

ARCHIVE="${BACKUP_DIR}/unicornx_${TIMESTAMP}.tar.gz"

# Build list of paths that exist so tar doesn't fail on missing inputs
INPUTS=()
[ -d "${APP_DIR}/server/data" ] && INPUTS+=("server/data")
[ -d "${APP_DIR}/server/db" ]   && INPUTS+=("server/db")

if [ ${#INPUTS[@]} -eq 0 ]; then
    log "SKIP: no server/data or server/db to back up"
    exit 0
fi

tar -czf "$ARCHIVE" -C "$APP_DIR" "${INPUTS[@]}" 2>/dev/null

SIZE=$(stat -c%s "$ARCHIVE" 2>/dev/null || echo 0)
if [ "$SIZE" -lt 64 ]; then
    log "ERROR: backup archive too small (${SIZE}B), removing"
    rm -f "$ARCHIVE"
    exit 1
fi

log "OK: backup created ${ARCHIVE} (${SIZE}B, paths: ${INPUTS[*]})"

# Delete old backups (older than KEEP_DAYS)
DELETED=$(find "$BACKUP_DIR" -name "unicornx_*.tar.gz" -mtime +${KEEP_DAYS} -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
    log "Cleaned up $DELETED old backups (>${KEEP_DAYS} days)"
fi
