#!/bin/sh
# KodSpot daily database backup with 7-day local retention
# Runs inside the backup container (postgres:15-alpine)
set -e

BACKUP_DIR="/backups"
RETENTION_DAYS=7

# Validate encryption key is set
if [ -z "$BACKUP_ENCRYPTION_KEY" ]; then
  echo "[$(date -Iseconds)] FATAL: BACKUP_ENCRYPTION_KEY not set. Refusing to create unencrypted backup."
  exit 1
fi

run_backup() {
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  BACKUP_FILE="${BACKUP_DIR}/kodspot_${TIMESTAMP}.sql.gz.gpg"

  echo "[$(date -Iseconds)] Starting encrypted database backup..."

  pg_dump -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges \
    | gzip \
    | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase "$BACKUP_ENCRYPTION_KEY" \
    > "$BACKUP_FILE"

  FILESIZE=$(wc -c < "$BACKUP_FILE" | tr -d ' ')
  echo "[$(date -Iseconds)] Backup created: $(basename "$BACKUP_FILE") (${FILESIZE} bytes, encrypted)"

  if [ "$FILESIZE" -lt 500 ]; then
    echo "[$(date -Iseconds)] ERROR: Backup suspiciously small (${FILESIZE} bytes). Keeping but flagging."
  fi

  # Rotate: delete backups older than RETENTION_DAYS
  DELETED=$(find "$BACKUP_DIR" -name "kodspot_*.sql.gz.gpg" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
  if [ "$DELETED" -gt 0 ]; then
    echo "[$(date -Iseconds)] Rotated ${DELETED} old backup(s)"
  fi

  TOTAL=$(find "$BACKUP_DIR" -name "kodspot_*.sql.gz.gpg" | wc -l)
  echo "[$(date -Iseconds)] Backup complete. ${TOTAL} encrypted backup(s) retained."
}

# Run once immediately on container start
run_backup

# Then run every 24 hours
while true; do
  sleep 86400
  run_backup
done
