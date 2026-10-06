#!/usr/bin/env bash
# Student Affairs CMS - backup for the VM.
#
#   ./backup.sh daily     DB dump + binlog archive + .env (+ media on demand)
#   ./backup.sh weekly    the same, plus one full media archive
#   ./backup.sh media     just refresh the media archive
#
# Design notes (see ops/RUNBOOK.md §4 for the reasoning):
#
#  * Compression is NOT a space lever. The database dumps to a few KB and media
#    (jpg/png/pdf) is already compressed, so tar.gz on it saves ~0%. What
#    actually consumes the disk is KEEPING COPIES. Retention below is therefore
#    small and deliberate.
#  * MySQL binary logging is on (ROW format). Archiving every closed binlog is
#    what turns "restore to last night" into "restore to any minute in the last
#    fortnight", for a few MB instead of another full set of dumps.
#  * Every run refuses to start if the disk does not have room. A backup that
#    fills the volume takes MySQL down with it, and the site with that.
#
# Knobs (all optional, override by exporting before the call):
#   KEEP_DB_DAILY=3      full dumps to keep in db/daily/
#   KEEP_DB_WEEKLY=1     full dumps to keep in db/weekly/
#   MEDIA_BACKUP=weekly  daily | weekly | never
#   MEDIA_KEEP=1         full media archives to keep
#   BINLOG_KEEP_DAYS=14  closed binlogs to keep
#   MIN_FREE_GB=10       refuse to run with less than this free
#   BACKUP_BUDGET_GB=0   prune oldest until backups/ is under this (0 = off)

set -euo pipefail

BASE=/opt/student-affairs
APP="$BASE/app"
BACKUPS="$BASE/backups"
MODE="${1:-daily}"

# Explicit directories. Media and secrets are NOT stored under db/ - they are
# different kinds of artifact and confusing them is how you end up restoring the
# wrong thing at 2am.
DIR_DB="$BACKUPS/db"
DIR_DAILY="$DIR_DB/daily"
DIR_WEEKLY="$DIR_DB/weekly"
DIR_BINLOG="$DIR_DB/binlog"
DIR_META="$DIR_DB/manifests"
DIR_MEDIA="$BACKUPS/media"
DIR_ENV="$BACKUPS/env"

KEEP_DB_DAILY="${KEEP_DB_DAILY:-3}"
KEEP_DB_WEEKLY="${KEEP_DB_WEEKLY:-1}"
MEDIA_BACKUP="${MEDIA_BACKUP:-weekly}"
MEDIA_KEEP="${MEDIA_KEEP:-1}"
BINLOG_KEEP_DAYS="${BINLOG_KEEP_DAYS:-14}"
MIN_FREE_GB="${MIN_FREE_GB:-10}"
BACKUP_BUDGET_GB="${BACKUP_BUDGET_GB:-0}"

mkdir -p "$DIR_DAILY" "$DIR_WEEKLY" "$DIR_BINLOG" "$DIR_META" "$DIR_MEDIA" "$DIR_ENV"

LOG() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }
fail() { LOG "ERROR: $*"; exit 1; }

# One-time layout migration. Earlier versions wrote backups/db/<stamp>.sql.gz
# flat, with media under backups/uploads/ and one .env per run. Retention only
# prunes the new directories, so without this the old files would sit there
# forever: never pruned, never counted, and easy to restore from by mistake.
migrate_flat_layout() {
  local moved=0 dropped=0

  # backups/db/*.sql.gz  ->  backups/db/daily/
  for f in "$DIR_DB"/*.sql.gz; do
    [ -e "$f" ] || continue
    mv "$f" "$DIR_DAILY/$(basename "$f")"; moved=$((moved + 1))
  done
  # backups/<stamp>.manifest -> backups/db/manifests/<stamp>.meta
  for f in "$BACKUPS"/*.manifest; do
    [ -e "$f" ] || continue
    mv "$f" "$DIR_META/$(basename "$f" .manifest).meta"; moved=$((moved + 1))
  done
  # backups/uploads/*.tgz -> backups/media/*.tgz
  for f in "$BACKUPS"/uploads/*.tgz; do
    [ -e "$f" ] || continue
    mv "$f" "$DIR_MEDIA/$(basename "$f")"; moved=$((moved + 1))
  done
  for f in "$DIR_DB"/uploads/*.tgz; do
    [ -e "$f" ] || continue
    mv "$f" "$DIR_MEDIA/$(basename "$f")"; moved=$((moved + 1))
  done
  # One .env per run is pointless: current.env is a snapshot of NOW. Keep the
  # newest legacy copy, drop the rest. db/env is included because an intermediate
  # version of this script wrote the snapshot there.
  local newest=""
  for f in "$BACKUPS"/env/*.env "$DIR_DB"/env/*.env; do
    [ -e "$f" ] || continue
    if [ -z "$newest" ] || [ "$f" -nt "$newest" ]; then
      [ -n "$newest" ] && rm -f "$newest"
      newest="$f"
    else
      rm -f "$f"; dropped=$((dropped + 1))
    fi
  done
  # Only move if it is actually somewhere else: on every later run current.env
  # is already the newest, and `mv x x` fails, which under `set -e` would abort
  # the whole backup run.
  if [ -n "$newest" ] && [ -f "$newest" ] && [ "$newest" != "$DIR_ENV/current.env" ]; then
    mv "$newest" "$DIR_ENV/current.env"
  fi
  # Stray scratch files and empty directories from earlier layouts.
  rm -f "$DIR_BINLOG"/.pending-* 2>/dev/null || true
  rmdir "$BACKUPS/uploads" "$DIR_DB/uploads" "$DIR_DB/env" "$BACKUPS/weekly" 2>/dev/null || true

  [ "$moved" -gt 0 ] && LOG "migrated $moved legacy artifact(s) into the current layout"
  [ "$dropped" -gt 0 ] && LOG "dropped $dropped superseded .env snapshot(s)"
  return 0
}

STAMP="$(date -u '+%Y%m%d-%H%M%S')"

migrate_flat_layout

cd "$APP"
[ -f .env ] || fail "no .env in $APP"

DB_PASSWORD="$(grep -E '^DB_PASSWORD=' .env | head -n1 | cut -d= -f2-)"
ROOT_PASSWORD="$(grep -E '^MYSQL_ROOT_PASSWORD=' .env | head -n1 | cut -d= -f2-)"
[ -n "$DB_PASSWORD" ] || fail "DB_PASSWORD not set in .env"
[ -n "$ROOT_PASSWORD" ] || fail "MYSQL_ROOT_PASSWORD not set in .env"

# Root is used deliberately: --source-data (needed so a dump knows which binlog
# position it came from) and --routines both want privileges the app user lacks.
mysql_root()  { docker compose exec -T -e MYSQL_PWD="$ROOT_PASSWORD" db mysql -uroot -N -B "$@"; }

free_bytes() { df -B1 --output=avail "$APP" | tail -1 | tr -d ' '; }

# Refuse to start rather than risk filling the volume.
AVAIL="$(free_bytes)"
NEED_BYTES=$(( MIN_FREE_GB * 1024 * 1024 * 1024 ))
if [ "$AVAIL" -lt "$NEED_BYTES" ]; then
  fail "only $((AVAIL / 1024 / 1024 / 1024)) GB free on /, below the ${MIN_FREE_GB} GB floor. Refusing to run - fix the disk before backing up."
fi

DB_TABLES="$(mysql_root -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='student_affairs'" | tr -d '\r')"
DB_TABLES="${DB_TABLES:-0}"
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

# ---------------------------------------------------------------------------
# 1. Database dump
# ---------------------------------------------------------------------------
LOG "dumping database (${DB_TABLES} tables)"
# --source-data=2 records the binlog file/position in a comment, which is what
# lets restore-to-time.sh replay only the changes made after this dump.
docker compose exec -T -e MYSQL_PWD="$ROOT_PASSWORD" db \
  mysqldump -uroot \
    --single-transaction \
    --source-data=2 \
    --no-tablespaces \
    --routines --triggers --events \
    --hex-blob \
    --default-character-set=utf8mb4 \
    student_affairs | gzip -9 > "$DIR_DAILY/$STAMP.sql.gz"

[ -s "$DIR_DAILY/$STAMP.sql.gz" ] || fail "dump is empty"
gzip -t "$DIR_DAILY/$STAMP.sql.gz" || fail "gzip integrity check failed on the dump"
if ! zcat "$DIR_DAILY/$STAMP.sql.gz" | grep -q 'CREATE TABLE'; then
  fail "dump contains no CREATE TABLE statements - something went wrong"
fi

if [ "$MODE" = "weekly" ]; then
  cp "$DIR_DAILY/$STAMP.sql.gz" "$DIR_WEEKLY/$STAMP.sql.gz"
fi

# The binlog coordinates the dump was taken at, plus a checksum so an offsite
# copy can prove it arrived intact. The binlog/media checksums are appended
# further down, once those artifacts exist.
# `|| true` matters: grep exits 1 when it matches nothing, and under pipefail
# that would abort the run silently.
SRC_FILE="$(zcat "$DIR_DAILY/$STAMP.sql.gz" | grep -oE "SOURCE_LOG_FILE='[^']+'" | head -1 | cut -d"'" -f2- || true)"
SRC_POS="$(zcat "$DIR_DAILY/$STAMP.sql.gz" | grep -oE 'SOURCE_LOG_POS=[0-9]+' | head -1 | cut -d= -f2- || true)"
[ -n "$SRC_POS" ] || SRC_POS="$(zcat "$DIR_DAILY/$STAMP.sql.gz" | grep -oE 'MASTER_LOG_POS=[0-9]+' | head -1 | cut -d= -f2- || true)"
DB_SHA="$(sha256sum "$DIR_DAILY/$STAMP.sql.gz" | cut -d' ' -f1)"
printf 'stamp=%s\nbinlog_file=%s\nbinlog_pos=%s\ntables=%s\ncommit=%s\ntaken_at=%s\ndb_sha256=%s\n' \
  "$STAMP" "$SRC_FILE" "$SRC_POS" "$DB_TABLES" "$COMMIT" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$DB_SHA" \
  > "$DIR_META/$STAMP.meta"
LOG "  dump sha256 $DB_SHA"

# ---------------------------------------------------------------------------
# 2. Binary logs - the point-in-time history
# ---------------------------------------------------------------------------
# FLUSH BINARY LOGS rotates, which closes the current file. Only CLOSED files are
# copied: the active one is still being written and would produce a truncated,
# unusable archive.
LOG "rotating and archiving binary logs"
mysql_root -e "FLUSH BINARY LOGS" >/dev/null 2>&1 || LOG "  (FLUSH BINARY LOGS failed - archiving what is already closed)"

ACTIVE="$(mysql_root -e "SHOW BINARY LOG STATUS" 2>/dev/null | awk 'NR==1{print $1}')"
[ -n "$ACTIVE" ] || ACTIVE="$(mysql_root -e "SHOW MASTER STATUS" 2>/dev/null | awk 'NR==1{print $1}')"
LAST_ARCHIVED="$(cat "$DIR_BINLOG/.last-archived" 2>/dev/null || true)"

# mysql_root passes -N, so there is NO header row - awk must start at NR==1, not
# NR>1, or binlog.000001 is silently skipped and never archived.
PENDING="$(mysql_root -e "SHOW BINARY LOGS" | awk 'NF{print $1}' | grep -v "^${ACTIVE}\$" || true)"
TO_ARCHIVE="$(printf '%s\n' "$PENDING" | awk -v last="$LAST_ARCHIVED" 'NF && (!last || $0 > last)' || true)"

if [ -n "$(printf '%s' "$TO_ARCHIVE" | tr -d '[:space:]')" ]; then
  COUNT="$(printf '%s\n' "$TO_ARCHIVE" | grep -c . || true)"
  # Space-separated for the tar argument. $TO_ARCHIVE is newline-separated, and
  # interpolating that into `sh -c` makes sh treat each log name as a separate
  # command ("binlog.000002: command not found").
  ARCHIVE_FILES="$(printf '%s\n' "$TO_ARCHIVE" | tr '\n' ' ')"
  # Tar from inside the container so the script does not need to know the
  # volume name (which depends on the compose project name).
  docker compose exec -T db sh -c "cd /var/lib/mysql && tar czf - $ARCHIVE_FILES" \
    > "$DIR_BINLOG/$STAMP.tgz" < /dev/null || fail "binlog archive failed"
  gzip -t "$DIR_BINLOG/$STAMP.tgz" || fail "binlog archive is corrupt"
  printf '%s\n' "$TO_ARCHIVE" | grep . | tail -1 > "$DIR_BINLOG/.last-archived"
  LOG "  archived $COUNT binlog file(s) [$ARCHIVE_FILES] -> $(du -h "$DIR_BINLOG/$STAMP.tgz" | cut -f1)"
  printf 'binlog_sha256=%s\n' "$(sha256sum "$DIR_BINLOG/$STAMP.tgz" | cut -d' ' -f1)" >> "$DIR_META/$STAMP.meta"
else
  LOG "  nothing new to archive"
fi

# ---------------------------------------------------------------------------
# 3. Uploaded media - only on the configured cadence
# ---------------------------------------------------------------------------
MEDIA_BYTES="$(docker compose exec -T app sh -c 'du -sb /app/uploads 2>/dev/null | cut -f1' < /dev/null | tr -d '\r')"
MEDIA_BYTES="${MEDIA_BYTES:-0}"
do_media() { [ "$MODE" = "weekly" ] || [ "$MODE" = "media" ]; }

if [ "$MEDIA_BACKUP" = "never" ]; then
  LOG "media archive skipped (MEDIA_BACKUP=never); uploads hold $((MEDIA_BYTES / 1024 / 1024)) MB on the VM"
elif [ "$MEDIA_BACKUP" = "daily" ] || do_media; then
  AVAIL="$(free_bytes)"
  if [ "$((AVAIL - MEDIA_BYTES))" -lt "$NEED_BYTES" ]; then
    LOG "ERROR: not enough room for a $((MEDIA_BYTES / 1024 / 1024)) MB media archive with only $((AVAIL / 1024 / 1024 / 1024)) GB free. Media NOT archived. Raise MIN_FREE_GB awareness by offloading media or adding disk."
    exit 1
  fi
  LOG "archiving uploads ($((MEDIA_BYTES / 1024 / 1024)) MB)"
  docker compose exec -T app tar czf - -C /app uploads > "$DIR_MEDIA/$STAMP.tgz" < /dev/null
  gzip -t "$DIR_MEDIA/$STAMP.tgz" || fail "uploads archive is corrupt"
  [ -s "$DIR_MEDIA/$STAMP.tgz" ] || LOG "  WARNING: uploads archive is empty (no media uploaded yet)"
  printf 'media_sha256=%s\n' "$(sha256sum "$DIR_MEDIA/$STAMP.tgz" | cut -d' ' -f1)" >> "$DIR_META/$STAMP.meta"
else
  LOG "media archive skipped (MEDIA_BACKUP=$MEDIA_BACKUP and this is a '$MODE' run)"
fi

# ---------------------------------------------------------------------------
# 4. Secrets - a snapshot of CURRENT config, so history is pointless: one copy.
# ---------------------------------------------------------------------------
install -m 600 "$APP/.env" "$DIR_ENV/current.env"
LOG "secrets snapshot written to env/current.env (mode 600)"

# ---------------------------------------------------------------------------
# 5. Retention
# ---------------------------------------------------------------------------
prune_oldest_first() {
  # $1 = directory, $2 = glob, $3 = how many to keep
  local dir="$1" glob="$2" keep="$3"
  [ -d "$dir" ] || return 0
  local files
  files="$(find "$dir" -maxdepth 1 -name "$glob" -type f | sort)"
  local total
  total="$(printf '%s\n' "$files" | grep -c . || true)"
  if [ "$total" -le "$keep" ]; then return 0; fi
  # Never delete the newest: a backup set with nothing in it is worse than a
  # full disk, because it looks like success.
  printf '%s\n' "$files" | head -n "$((total - keep))" | while read -r f; do
    LOG "  pruned $(basename "$f")"
    rm -f "$f"
  done
}

prune_oldest_first "$DIR_DAILY"   '*.sql.gz' "$KEEP_DB_DAILY"
prune_oldest_first "$DIR_WEEKLY"  '*.sql.gz' "$KEEP_DB_WEEKLY"
prune_oldest_first "$DIR_MEDIA" '*.tgz'    "$MEDIA_KEEP"

# Binlog archives are pruned by age, not count.
find "$DIR_BINLOG" -maxdepth 1 -name '*.tgz' -mtime "+$BINLOG_KEEP_DAYS" -print -delete | sed 's/^/  pruned /' || true

# Keep the manifest for every surviving dump so a restore knows its binlog start.
find "$DIR_META" -maxdepth 1 -name '*.meta' -mtime "+$((BINLOG_KEEP_DAYS + 2))" -delete 2>/dev/null || true

if [ "$BACKUP_BUDGET_GB" -gt 0 ]; then
  BUDGET=$(( BACKUP_BUDGET_GB * 1024 * 1024 * 1024 ))
  CURRENT="$(du -sb "$BACKUPS" | cut -f1)"
  LOG "pruning to budget: backups/ is $((CURRENT / 1024 / 1024 / 1024)) GB, budget ${BACKUP_BUDGET_GB} GB"
  while [ "$CURRENT" -gt "$BUDGET" ]; do
    victim="$(find "$BACKUPS" -type f \( -name '*.sql.gz' -o -name '*.tgz' \) -printf '%T@ %p\n' \
               | sort -n | awk 'NR==2{print $2}')"
    [ -n "$victim" ] || break
    LOG "  over budget, removing $(basename "$victim")"
    rm -f "$victim"
    CURRENT="$(du -sb "$BACKUPS" | cut -f1)"
  done
fi

# ---------------------------------------------------------------------------
# 6. Summary
# ---------------------------------------------------------------------------
LOG "OK  db=$(du -h "$DIR_DAILY/$STAMP.sql.gz" | cut -f1)  backups=$(( $(du -sb "$BACKUPS" | cut -f1) / 1024 / 1024 )) MB  free=$(( $(free_bytes) / 1024 / 1024 / 1024 )) GB"
LOG "    daily dumps=$(find "$DIR_DAILY" -name '*.sql.gz' | wc -l)  weekly=$(find "$DIR_WEEKLY" -name '*.sql.gz' | wc -l)  media=$(find "$DIR_MEDIA" -name '*.tgz' | wc -l)  binlog archives=$(find "$DIR_BINLOG" -name '*.tgz' | wc -l)"