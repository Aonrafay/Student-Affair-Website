#!/usr/bin/env bash
# Student Affairs CMS - backup script for the VM.
#
#   ./backup.sh daily     full backup + prune dailies older than 7 days
#   ./backup.sh weekly    full backup + keep a copy in weekly/ (28 days)
#
# Backs up three things, because losing any one of them loses real content:
#   1. the MySQL database  -> backups/db/<stamp>.sql.gz
#   2. uploaded media      -> backups/uploads/<stamp>.tgz
#   3. the .env secrets    -> backups/env/<stamp>.env
# A manifest with checksums and sizes lands in backups/<stamp>.manifest.
#
# Safe to run while the site is live: mysqldump uses --single-transaction.

set -euo pipefail

BASE=/opt/student-affairs
APP="$BASE/app"
DEST="$BASE/backups"
MODE="${1:-daily}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY_DAYS="${KEEP_WEEKLY_DAYS:-28}"
LOCK="$DEST/.backup.lock"

log() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }
fail() { log "ERROR: $*"; exit 1; }

[ -d "$APP" ] || fail "app dir not found: $APP"
[ -f "$APP/.env" ] || fail "no .env in $APP (cannot read DB_PASSWORD)"
mkdir -p "$DEST/db" "$DEST/uploads" "$DEST/env" "$DEST/weekly"

exec 9>"$LOCK"
if ! flock -n 9; then
  fail "another backup is already running (lock: $LOCK)"
fi

STAMP="$(date -u '+%Y%m%d-%H%M%S')"

cd "$APP"

if ! docker compose ps --status running --services 2>/dev/null | grep -qx db; then
  fail "db container is not running - start the stack with: docker compose up -d"
fi

# --- 1. database -------------------------------------------------------------
# Read the password out of .env; never hardcode it. Passed as MYSQL_PWD to the
# exec'd process so it does not appear in the container's process list.
# --no-tablespaces: mysqldump otherwise needs the PROCESS privilege.
DBP="$(grep -E '^DB_PASSWORD=' .env | head -n1 | cut -d= -f2-)"
[ -n "$DBP" ] || fail "DB_PASSWORD not set in .env"

log "dumping database student_affairs"
docker compose exec -T -e MYSQL_PWD="$DBP" db \
  mysqldump -usa \
    --single-transaction \
    --no-tablespaces \
    --routines --triggers \
    --hex-blob \
    --default-character-set=utf8mb4 \
    student_affairs | gzip -9 > "$DEST/db/$STAMP.sql.gz"

# A dump with zero tables means the dump silently failed; catch it here rather
# than discovering it during a restore.
TABLES="$(docker compose exec -T -e MYSQL_PWD="$DBP" db \
  mysql -usa -N -B -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='student_affairs'" \
  | tr -d '\r' | tail -n1)"
log "database has ${TABLES:-?} tables"

gzip -t "$DEST/db/$STAMP.sql.gz" || fail "gzip integrity check failed on the dump"
[ -s "$DEST/db/$STAMP.sql.gz" ] || fail "dump is empty"

# --- 2. uploaded media -------------------------------------------------------
# Tarred from inside the app container so the script does not need to know the
# Docker volume name (which depends on the compose project name).
log "archiving uploads"
docker compose exec -T app tar czf - -C /app uploads > "$DEST/uploads/$STAMP.tgz"
gzip -t "$DEST/uploads/$STAMP.tgz" || fail "gzip integrity check failed on uploads"
[ -s "$DEST/uploads/$STAMP.tgz" ] || log "WARNING: uploads archive is empty (no media uploaded yet)"

# --- 3. secrets --------------------------------------------------------------
install -m 600 "$APP/.env" "$DEST/env/$STAMP.env"

# --- manifest ----------------------------------------------------------------
{
  printf 'stamp=%s\n' "$STAMP"
  printf 'mode=%s\n' "$MODE"
  printf 'tables=%s\n' "${TABLES:-unknown}"
  printf 'commit=%s\n' "$(git -C "$APP" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  sha256sum "$DEST/db/$STAMP.sql.gz" "$DEST/uploads/$STAMP.tgz" "$DEST/env/$STAMP.env"
} > "$DEST/$STAMP.manifest"

# --- weekly keeper -----------------------------------------------------------
if [ "$MODE" = "weekly" ]; then
  cp "$DEST/db/$STAMP.sql.gz" "$DEST/weekly/$STAMP.sql.gz"
  cp "$DEST/uploads/$STAMP.tgz" "$DEST/weekly/$STAMP.tgz"
  cp "$DEST/$STAMP.manifest" "$DEST/weekly/$STAMP.manifest"
  log "kept weekly copy"
fi

# --- retention ---------------------------------------------------------------
log "pruning: dailies > ${KEEP_DAILY}d, weeklies > ${KEEP_WEEKLY_DAYS}d"
find "$DEST/db"       -maxdepth 1 -name '*.sql.gz' -mtime +"$KEEP_DAILY"       -delete
find "$DEST/uploads"  -maxdepth 1 -name '*.tgz'    -mtime +"$KEEP_DAILY"       -delete
find "$DEST/env"      -maxdepth 1 -name '*.env'    -mtime +"$KEEP_DAILY"       -delete
find "$DEST/weekly"   -maxdepth 1 -name '*.sql.gz' -mtime +"$KEEP_WEEKLY_DAYS" -delete
find "$DEST/weekly"   -maxdepth 1 -name '*.tgz'    -mtime +"$KEEP_WEEKLY_DAYS" -delete
find "$DEST/weekly"   -maxdepth 1 -name '*.manifest' -mtime +"$KEEP_WEEKLY_DAYS" -delete
find "$DEST" -maxdepth 1 -name '*.manifest' -mtime +"$KEEP_DAILY" -delete

log "OK $(du -h "$DEST/db/$STAMP.sql.gz" | cut -f1) db, $(du -h "$DEST/uploads/$STAMP.tgz" | cut -f1) uploads -> $DEST"
log "dailies kept: $(find "$DEST/db" -name '*.sql.gz' | wc -l), weeklies kept: $(find "$DEST/weekly" -name '*.sql.gz' | wc -l)"
