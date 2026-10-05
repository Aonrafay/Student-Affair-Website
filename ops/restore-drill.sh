#!/usr/bin/env bash
# Restore drill: prove the newest backup is actually restorable, without
# touching the live database.
#
# Imports the newest dump into a throwaway schema, compares it against the live
# data, then drops it. Safe to run any time - the live site is never modified.
#
#   bash /opt/student-affairs/restore-drill.sh [path-to-dump.sql.gz]
set -euo pipefail

BASE=/opt/student-affairs
APP="$BASE/app"
LIVE_DB=student_affairs
TABLES='posts events notices societies society_years society_members team_members partners documents pages media users settings'

log() { printf '%s drill  %s\n' "$(date -u '+%H:%M:%S')" "$*"; }

cd "$APP"
DBP="$(grep -E '^DB_PASSWORD=' .env | head -n1 | cut -d= -f2-)"
ROOTPW="$(grep -E '^MYSQL_ROOT_PASSWORD=' .env | head -n1 | cut -d= -f2-)"
[ -n "$DBP" ] || { echo "DB_PASSWORD missing from .env" >&2; exit 1; }
[ -n "$ROOTPW" ] || { echo "MYSQL_ROOT_PASSWORD missing from .env" >&2; exit 1; }

DUMP="${1:-$(ls -1t "$BASE"/backups/db/*.sql.gz | head -1)}"
[ -f "$DUMP" ] || { echo "no dump found: $DUMP" >&2; exit 1; }

# The app user `sa` is granted only on student_affairs, so the drill needs root
# to create and drop the throwaway schema.
mysql_do() { docker compose exec -T -e MYSQL_PWD="$ROOTPW" db mysql -uroot -N -B "$@"; }

log "dump under test : $DUMP"
log "sha256          : $(sha256sum "$DUMP" | cut -d' ' -f1)"

SCRATCH="restore_drill_$$"

cleanup() {
  log "dropping scratch schema $SCRATCH"
  mysql_do -e "DROP DATABASE IF EXISTS \`$SCRATCH\`;" >/dev/null 2>&1 || true
}
trap cleanup EXIT

log "creating scratch schema $SCRATCH"
mysql_do -e "CREATE DATABASE \`$SCRATCH\` CHARACTER SET utf8mb4;"

log "importing dump"
zcat "$DUMP" | docker compose exec -T -e MYSQL_PWD="$ROOTPW" db mysql -uroot "$SCRATCH"

log "comparing row counts (live vs restored)"
printf '  %-20s %10s %10s %s\n' TABLE LIVE RESTORED RESULT
drill_ok=1
mismatch=0
for t in $TABLES; do
  live="$(mysql_do -e "SELECT COUNT(*) FROM \`$LIVE_DB\`.\`$t\`" 2>/dev/null | tr -d '\r' || echo '-')"
  rest="$(mysql_do -e "SELECT COUNT(*) FROM \`$SCRATCH\`.\`$t\`" 2>/dev/null | tr -d '\r' || echo '-')"
  if [ "$live" = "$rest" ] && [ "$live" != '-' ] && [ "$live" != '0' ]; then
    res=ok
  elif [ "$live" = "$rest" ]; then
    res='ok (empty)'
  else
    res='MISMATCH'; drill_ok=0; mismatch=$((mismatch + 1))
  fi
  printf '  %-20s %10s %10s %s\n' "$t" "$live" "$rest" "$res"
done

# A database row pointing at a media file that is not in the archive is broken
# content: the CMS will render a dead image. Cross-check every media row in the
# RESTORED copy against the uploads archive taken at the same timestamp.
STAMP="$(basename "$DUMP" .sql.gz)"
ARCHIVE="$BASE/backups/uploads/$STAMP.tgz"
media_checked=0
media_missing=0
if [ -f "$ARCHIVE" ]; then
  log "uploads archive for this stamp: $ARCHIVE"
  listing="$(tar tzf "$ARCHIVE")"
  while IFS= read -r fname; do
    [ -n "$fname" ] || continue
    media_checked=$((media_checked + 1))
    if ! printf '%s\n' "$listing" | grep -q "uploads/$fname"; then
      log "MISSING from archive: $fname"
      media_missing=$((media_missing + 1))
    fi
  done <<EOF
$(mysql_do -e "SELECT filename FROM \`$SCRATCH\`.media" | tr -d '\r')
EOF
  if [ "$media_missing" -eq 0 ]; then
    log "media cross-check ok: $media_checked file(s) present in the archive"
  else
    log "media cross-check FAILED: $media_missing of $media_checked file(s) missing"
    drill_ok=0
  fi
else
  log "NOTE: no uploads archive for stamp $STAMP - skipping the media cross-check"
fi

# The dump alone is not enough: the .env carries the admin passwords and the
# signing key, so a restore without it locks everyone out of the admin.
env_backup="$(ls -1t "$BASE"/backups/env/*.env 2>/dev/null | head -1 || true)"
if [ -n "$env_backup" ] && [ -s "$env_backup" ]; then
  log "secrets backup present: $env_backup ($(stat -c '%a' "$env_backup") mode)"
else
  log "WARNING: no .env backup found - a restore would leave admin passwords unusable"
  drill_ok=0
fi

echo
if [ "$drill_ok" -eq 1 ]; then
  log "PASS - backup restores cleanly, $mismatch mismatches, live data untouched"
else
  log "FAIL - $mismatch table(s) did not match, or the secrets backup is missing"
  exit 1
fi
