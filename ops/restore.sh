#!/usr/bin/env bash
# Restore the Student Affairs CMS from a backup.
#
#   bash /opt/student-affairs/restore.sh                     # newest backup
#   bash /opt/student-affairs/restore.sh <stamp>             # e.g. 20261005-103540
#   bash /opt/student-affairs/restore.sh --yes               # no confirmation
#   bash /opt/student-affairs/restore.sh --db-only <stamp>
#
# Restores the database, and by default the uploaded media as well. Drops and
# recreates the tables rather than the schema, so the `sa` grants on
# student_affairs survive. The app is stopped while the database is swapped and
# restarted (which re-runs migrations) afterwards, so expect ~30s of downtime.
set -euo pipefail

BASE=/opt/student-affairs
APP="$BASE/app"
LIVE_DB=student_affairs

ASSUME_YES=0
DB_ONLY=0
STAMP=""

for arg in "$@"; do
  case "$arg" in
    --yes|-y)    ASSUME_YES=1 ;;
    --db-only)   DB_ONLY=1 ;;
    -h|--help)   sed -n '2,14p' "$0"; exit 0 ;;
    *)           STAMP="$arg" ;;
  esac
done

log() { printf '%s restore  %s\n' "$(date -u '+%H:%M:%S')" "$*"; }
die() { printf '%s restore  ERROR: %s\n' "$(date -u '+%H:%M:%S')" "$*" >&2; exit 1; }

cd "$APP"
DBP="$(grep -E '^DB_PASSWORD=' .env | head -n1 | cut -d= -f2-)"
ROOTPW="$(grep -E '^MYSQL_ROOT_PASSWORD=' .env | head -n1 | cut -d= -f2-)"
[ -n "$ROOTPW" ] || die "MYSQL_ROOT_PASSWORD missing from .env"

BACKUPS="$BASE/backups"
DIR_DAILY="$BACKUPS/db/daily"
DIR_WEEKLY="$BACKUPS/db/weekly"
DIR_MEDIA="$BACKUPS/media"
DIR_ENV="$BACKUPS/env"

if [ -z "$STAMP" ]; then
  # Newest dump across both retention buckets.
  STAMP="$(ls -1t "$DIR_DAILY"/*.sql.gz "$DIR_WEEKLY"/*.sql.gz 2>/dev/null | head -1 | xargs basename 2>/dev/null | sed 's/\.sql\.gz$//')"
  [ -n "$STAMP" ] || die "no dumps found under $DIR_DAILY or $DIR_WEEKLY"
fi

# Fall back to the other bucket, and to the pre-restructure flat path, so an
# older backup layout on disk is still recoverable.
DUMP="$DIR_DAILY/$STAMP.sql.gz"
[ -f "$DUMP" ] || DUMP="$DIR_WEEKLY/$STAMP.sql.gz"
[ -f "$DUMP" ] || DUMP="$BACKUPS/db/$STAMP.sql.gz"
[ -f "$DUMP" ] || die "no such dump for '$STAMP' (looked in $DIR_DAILY, $DIR_WEEKLY and the legacy $BACKUPS/db)"

ARCHIVE="$DIR_MEDIA/$STAMP.tgz"
[ -f "$ARCHIVE" ] || ARCHIVE="$BACKUPS/uploads/$STAMP.tgz"
# .env is a single "current" snapshot now, not one per run.
ENVBAK="$DIR_ENV/current.env"
[ -f "$ENVBAK" ] || ENVBAK="$DIR_ENV/$STAMP.env"
[ -f "$ENVBAK" ] || ENVBAK="$BACKUPS/env/$STAMP.env"

[ "$DB_ONLY" -eq 1 ] || { [ -f "$ARCHIVE" ] || die "no media archive for $STAMP (use --db-only to skip media)"; }

mysql_root() { docker compose exec -T -e MYSQL_PWD="$ROOTPW" db mysql -uroot -N -B "$@"; }

log "backup stamp : $STAMP"
log "dump         : $DUMP ($(du -h "$DUMP" | cut -f1))"
[ "$DB_ONLY" -eq 0 ] && log "uploads      : $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
gzip -t "$DUMP" || die "dump is corrupt (gzip integrity check failed)"

log "THIS OVERWRITES ALL CURRENT CMS CONTENT with the backup."
if [ "$ASSUME_YES" -eq 0 ]; then
  read -r -p "Type 'restore' to continue: " answer
  [ "$answer" = "restore" ] || die "aborted by operator"
fi

# --- 1. stop the app so nothing writes mid-restore ---------------------------
log "stopping the app (database stays up)"
docker compose stop app

# --- 2. clear the existing tables (keeps the schema + its grants) ------------
log "dropping existing tables in $LIVE_DB"
{
  echo "SET FOREIGN_KEY_CHECKS=0;"
  mysql_root -e "SELECT CONCAT('DROP TABLE IF EXISTS \`', table_name, '\`;')
                 FROM information_schema.tables
                WHERE table_schema='$LIVE_DB'" | tr -d '\r'
  echo "SET FOREIGN_KEY_CHECKS=1;"
} | docker compose exec -T -e MYSQL_PWD="$ROOTPW" db mysql -uroot "$LIVE_DB"

# --- 3. import ---------------------------------------------------------------
log "importing the dump"
zcat "$DUMP" | docker compose exec -T -e MYSQL_PWD="$ROOTPW" db mysql -uroot "$LIVE_DB"

restored="$(mysql_root -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$LIVE_DB'" | tr -d '\r')"
[ "${restored:-0}" -gt 0 ] || die "import produced no tables - something went wrong"
log "imported $restored tables"

# --- 4. uploaded media -------------------------------------------------------
if [ "$DB_ONLY" -eq 0 ]; then
  log "restoring uploaded media"
  docker compose start app >/dev/null
  for i in $(seq 1 40); do
    curl -fsS --max-time 5 http://127.0.0.1:5000/student-affairs/api/health >/dev/null 2>&1 && break
    [ "$i" -eq 40 ] && die "app did not come back; media restore skipped"
    sleep 5
  done
  # Ship the archive in, then swap the contents inside the container so the
  # volume ends up holding exactly what the backup had.
  docker cp "$ARCHIVE" "app-app-1:/tmp/restore-uploads.tgz"
  docker compose exec -T app sh -c '
    set -e
    mkdir -p /tmp/newuploads
    tar xzf /tmp/restore-uploads.tgz -C /tmp/newuploads
    find /app/uploads -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    cp -a /tmp/newuploads/uploads/. /app/uploads/ 2>/dev/null || true
    rm -rf /tmp/newuploads /tmp/restore-uploads.tgz
  '
  log "media restored: $(docker compose exec -T app sh -c 'ls -1 /app/uploads | grep -v gitkeep | wc -l') file(s)"
else
  log "skipping media (--db-only)"
fi

# --- 5. bring the app back and re-run migrations -----------------------------
log "starting the app (migrations re-run on boot)"
docker compose up -d
docker compose start app >/dev/null 2>&1 || true

for i in $(seq 1 40); do
  body="$(curl -fsS --max-time 5 http://127.0.0.1:5000/student-affairs/api/health 2>/dev/null || true)"
  case "$body" in
    *'"ok":true'*) log "healthy after $((i * 5))s: $body"; break ;;
  esac
  [ "$i" -eq 40 ] && { docker compose logs --tail 40 app; die "app did not become healthy"; }
  sleep 5
done

# --- 6. did the .env change? -------------------------------------------------
# If the backup's .env differs from the live one (e.g. someone rotated the admin
# password), say so - otherwise the operator may be locked out.
if [ -f "$ENVBAK" ]; then
  if diff -q <(grep -v '^#' "$ENVBAK" | grep -v '^[[:space:]]*$' | sort) \
             <(grep -v '^#' .env      | grep -v '^[[:space:]]*$' | sort) >/dev/null 2>&1; then
    log ".env unchanged since this backup - current admin password still valid"
  else
    log "WARNING: .env has changed since this backup. If the admin password was"
    log "         rotated after $STAMP, restore it with:"
    log "         install -m 600 $ENVBAK $APP/.env && docker compose up -d"
  fi
fi

log "restore complete from stamp $STAMP"
docker compose ps
