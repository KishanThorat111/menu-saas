#!/bin/sh
# KodSpot database restore from encrypted backup
# Usage: ./restore.sh <backup_file.sql.gz.gpg>
#
# Prerequisites:
#   - BACKUP_ENCRYPTION_KEY env var must be set (same key used for backup)
#   - PostgreSQL client tools (psql, pg_isready)
#   - gpg installed
#
# WARNING: This will REPLACE all data in the target database.
# Always verify the backup file before restoring to production.
#
# Example:
#   export BACKUP_ENCRYPTION_KEY="your-key"
#   export POSTGRES_USER="kodspot"
#   export POSTGRES_DB="kodspot"
#   ./restore.sh /backups/kodspot_20260402_030000.sql.gz.gpg
#
# To restore inside the Docker network:
#   docker compose exec backup sh -c 'BACKUP_ENCRYPTION_KEY=your-key ./restore.sh /backups/<file>'
#
# To verify a backup without restoring (dry run):
#   ./restore.sh --verify <backup_file.sql.gz.gpg>

set -e

BACKUP_FILE="$1"
VERIFY_ONLY=false

if [ "$1" = "--verify" ]; then
  VERIFY_ONLY=true
  BACKUP_FILE="$2"
fi

# Validate inputs
if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 [--verify] <backup_file.sql.gz.gpg>"
  echo ""
  echo "Options:"
  echo "  --verify    Decrypt and check backup integrity without restoring"
  echo ""
  echo "Available backups:"
  ls -lh /backups/kodspot_*.sql.gz.gpg 2>/dev/null || echo "  (none found in /backups/)"
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: Backup file not found: $BACKUP_FILE"
  exit 1
fi

if [ -z "$BACKUP_ENCRYPTION_KEY" ]; then
  echo "ERROR: BACKUP_ENCRYPTION_KEY environment variable not set."
  exit 1
fi

FILESIZE=$(wc -c < "$BACKUP_FILE" | tr -d ' ')
echo "Backup file: $(basename "$BACKUP_FILE") (${FILESIZE} bytes)"

# Verify mode: decrypt and check SQL validity without restoring
if [ "$VERIFY_ONLY" = true ]; then
  echo "Verifying backup integrity..."
  
  LINE_COUNT=$(gpg --batch --quiet --passphrase "$BACKUP_ENCRYPTION_KEY" --decrypt "$BACKUP_FILE" 2>/dev/null \
    | gunzip 2>/dev/null \
    | wc -l)
  
  if [ "$LINE_COUNT" -gt 0 ]; then
    echo "PASS: Backup decrypts successfully (${LINE_COUNT} SQL lines)"
  else
    echo "FAIL: Backup appears empty or corrupted"
    exit 1
  fi
  exit 0
fi

# Restore mode
DB_HOST="${DB_HOST:-db}"
DB_USER="${POSTGRES_USER:-kodspot}"
DB_NAME="${POSTGRES_DB:-kodspot}"

echo ""
echo "=== RESTORE WARNING ==="
echo "Target: ${DB_USER}@${DB_HOST}/${DB_NAME}"
echo "This will DROP and recreate all tables."
echo ""

# Check database connectivity
if ! pg_isready -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -q 2>/dev/null; then
  echo "ERROR: Cannot connect to database at ${DB_HOST}"
  exit 1
fi

echo "Decrypting and restoring..."

gpg --batch --quiet --passphrase "$BACKUP_ENCRYPTION_KEY" --decrypt "$BACKUP_FILE" \
  | gunzip \
  | psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" --single-transaction --set ON_ERROR_STOP=on 2>&1

RESULT=$?
if [ "$RESULT" -eq 0 ]; then
  echo ""
  echo "Restore completed successfully from: $(basename "$BACKUP_FILE")"
  echo "IMPORTANT: Run 'npx prisma migrate deploy' if there are newer migrations."
else
  echo ""
  echo "ERROR: Restore failed with exit code ${RESULT}"
  exit 1
fi
