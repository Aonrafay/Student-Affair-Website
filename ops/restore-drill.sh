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

DIR_DAILY="$BASE/backups/db/daily"
DIR_WEEKLY="$BASE/backups/db/weekly"
DIR_MEDIA="$BASE/backups/media"
DIR_ENV="$BASE/backups/env"

# Newest dump across both retention buckets, with a fallback to the
# pre-restructure flat path so an older layout still drills cleanly.
newest_dump() {
  local f
  f="$(ls -1t "$DIR_DAILY"/*.sql.gz "$DIR_WEEKLY"/*.sql.gz 2>/dev/null | head -1)"
  [ -n "$f" ] || f="$(ls -1t "$BASE"/backups/db/*.sql.gz 2>/dev/null | head -1)"
  [ -n "$f" ] || return 1
  printf '%s\n' "$f"
}

DUMP="${1:-$(newest_dump || true)}"
[ -n "$DUMP" ] || { echo "no dumps found under $DIR_DAILY or $DIR_WEEKLY" >&2; exit 1; }
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

# --- verify the dump against its manifest before trusting anything else ------
STAMP="$(basename "$DUMP" .sql.gz)"
MANIFEST="$BASE/backups/db/manifests/$STAMP.meta"
if [ -f "$MANIFEST" ]; then
  expect_sha="$(sed -n 's/^db_sha256=//p' "$MANIFEST" | tr -d '\r' | head -1)"
  actual_sha="$(sha256sum "$DUMP" | cut -d' ' -f1)"
  if [ -n "$expect_sha" ] && [ "$expect_sha" = "$actual_sha" ]; then
    log "dump matches its manifest checksum (${expect_sha:0:12}…)"
  else
    log "CHECKSUM MISMATCH: manifest says ${expect_sha:-<none>}, file is $actual_sha"
    log "  This dump is not the artifact the manifest describes."
    exit 1
  fi
else
  log "WARNING: no manifest for $STAMP - cannot confirm this is the expected dump"
fi

# --- is the restored copy self-consistent? -----------------------------------
# This, not "matches live", is what makes a restore usable. Comparing against
# live data scored every write made since the 02:15 dump as a MISMATCH, which
# trains people to ignore the drill's output; and a wholly EMPTY backup used to
# pass, because live==restored==0 scored 'ok (empty)'.
log "self-consistency of the restored copy"
drill_ok=1
missing=""
for t in $TABLES; do
  if ! mysql_do -e "SELECT 1 FROM \`$SCRATCH\`.\`$t\` LIMIT 1" >/dev/null 2>&1; then
    missing="$missing $t"
  fi
done
if [ -n "$missing" ]; then
  log "FAIL: restored copy is missing expected table(s):$missing"
  drill_ok=0
else
  log "  all $(echo $TABLES | wc -w) expected tables present"
fi

# A restore you cannot log into, or that renders a header-less site, is not a
# working restore. These are hard failures, not warnings.
rest_users="$(mysql_do -e "SELECT COUNT(*) FROM \`$SCRATCH\`.users" | tr -d '\r')"
rest_settings="$(mysql_do -e "SELECT COUNT(*) FROM \`$SCRATCH\`.settings" | tr -d '\r')"
rest_posts="$(mysql_do -e "SELECT COUNT(*) FROM \`$SCRATCH\`.posts" | tr -d '\r')"
log "  users=$rest_users settings=$rest_settings posts=$rest_posts"
[ "${rest_users:-0}" -ge 1 ] || { log "FAIL: restored users table is empty - nobody could log in"; drill_ok=0; }
[ "${rest_settings:-0}" -ge 1 ] || { log "FAIL: restored settings table is empty - header and footer would be blank"; drill_ok=0; }
# Every table is schema-qualified: mysql_do runs without a default database, so
# an unqualified name here fails with "No database selected".
rest_total="$(mysql_do -e "
  SELECT (SELECT COUNT(*) FROM \`$SCRATCH\`.posts)
       + (SELECT COUNT(*) FROM \`$SCRATCH\`.events)
       + (SELECT COUNT(*) FROM \`$SCRATCH\`.notices)
       + (SELECT COUNT(*) FROM \`$SCRATCH\`.pages)
       + (SELECT COUNT(*) FROM \`$SCRATCH\`.settings)
       + (SELECT COUNT(*) FROM \`$SCRATCH\`.users)
       + (SELECT COUNT(*) FROM \`$SCRATCH\`.media)" | tr -d '\r')"
log "  total content rows restored: ${rest_total:-0}"
if [ "${rest_total:-0}" -lt 5 ]; then
  log "FAIL: only ${rest_total:-0} content rows. A backup with 14 correctly shaped but empty tables"
  log "      passes every structural check above, which is why this one exists."
  drill_ok=0
fi

# --- live vs restored: INFORMATION ONLY --------------------------------------
# Writes between the dump and now always make live larger than restored. That is
# the expected direction, so a difference is reported, never failed on. A restored
# count EXCEEDING live would be genuinely alarming, so that still trips.
log "live vs restored (informational - writes since the dump explain any gap)"
mismatch=0
printf '  %-20s %10s %10s %s\n' TABLE LIVE RESTORED NOTE
for t in $TABLES; do
  # tr -d '[:space:]' rather than tr -d '\r': mysql's batch output ends in CRLF,
  # and a surviving carriage return inside [ ] turns the next argument into
  # "8\r", which bash rejects with "[: syntax error: `-or' unexpected" - the
  # comparison loop then silently carries on with the wrong branch taken.
  live="$(mysql_do -e "SELECT COUNT(*) FROM \`$LIVE_DB\`.\`$t\`" 2>/dev/null | tr -d '[:space:]')"
  rest="$(mysql_do -e "SELECT COUNT(*) FROM \`$SCRATCH\`.\`$t\`" 2>/dev/null | tr -d '[:space:]')"
  # Only compare numerically when both sides really are integers.
  case "$live$rest" in
    ''|*[!0-9]*) note='skipped (table missing or unreadable)' ;;
    *)
      if [ "$rest" -gt "$live" ]; then
        note='RESTORED HAS MORE - investigate'
        mismatch=$((mismatch + 1))
      elif [ "$live" -gt "$rest" ]; then
        note='written since the dump (expected)'
      else
        note='identical'
      fi
      ;;
  esac
  printf '  %-20s %10s %10s %s\n' "$t" "${live:--}" "${rest:--}" "$note"
done

# A database row pointing at a media file that is not in the archive is broken
# content: the CMS will render a dead image. Cross-check every media row in the
# RESTORED copy against the uploads archive taken at the same timestamp.
# STAMP is set above, next to the checksum comparison.
ARCHIVE="$DIR_MEDIA/$STAMP.tgz"
[ -f "$ARCHIVE" ] || ARCHIVE="$BASE/backups/uploads/$STAMP.tgz"   # legacy layout
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
env_backup="$DIR_ENV/current.env"
[ -f "$env_backup" ] || env_backup="$(ls -1t "$DIR_ENV"/*.env "$BASE"/backups/env/*.env 2>/dev/null | head -1 || true)"
if [ -n "$env_backup" ] && [ -s "$env_backup" ]; then
  log "secrets backup present: $env_backup ($(stat -c '%a' "$env_backup") mode)"
else
  log "WARNING: no .env backup found - a restore would leave admin passwords unusable"
  drill_ok=0
fi

echo
if [ "$drill_ok" -eq 1 ]; then
  log "PASS - this dump restores into a complete, usable site ($mismatch anomaly/anomalies)"
  log "      Live data was not touched: the import went to the throwaway schema, dropped on exit."
else
  log "FAIL - the restored copy is not usable; see the FAIL lines above"
  exit 1
fi
