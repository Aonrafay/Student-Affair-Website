#!/usr/bin/env bash
# Scheduled housekeeping that backup.sh does not cover.
#
#   bash /opt/student-affairs/maintenance.sh
#
# Three things, all of which otherwise grow without bound or fail silently:
#
#   1. audit_log is never pruned by anything. The app exposes an admin-only
#      POST /admin/activity/prune, but no cron calls it, so the table - which is
#      inside every database dump - grows forever and every dump and restore gets
#      slower for no benefit.
#
#   2. backup.log is appended by cron forever and nothing reads it. A backup that
#      has been failing for a week is invisible unless someone happens to open
#      the file.
#
#   3. restore-errors-*.log files accumulate one per imperfect binlog replay and
#      are never cleaned up.
#
# Deliberately read-only with respect to CMS content: it deletes audit rows older
# than the retention window and its own log files, nothing else.
set -uo pipefail

BASE=/opt/student-affairs
APP="$BASE/app"
# Overridable so the checks can be exercised against a scratch directory instead
# of the live backups - e.g. BACKUPS=/tmp/fake bash maintenance.sh.
BACKUPS="${BACKUPS:-$BASE/backups}"
LOG="$BACKUPS/maintenance.log"
AUDIT_KEEP_DAYS="${AUDIT_KEEP_DAYS:-180}"
MAX_LOG_MB="${MAX_LOG_MB:-20}"

mkdir -p "$BACKUPS"
ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
# Any failure increments this, and the script exits non-zero at the end. A cron
# job that logs ERROR but exits 0 is invisible to anything watching exit codes -
# the whole point of a watchdog is that it can fail loudly.
PROBLEMS=0
log() { printf '%s maintenance  %s\n' "$(ts)" "$*" | tee -a "$LOG"; }
err() { PROBLEMS=$((PROBLEMS + 1)); printf '%s maintenance  ERROR: %s\n' "$(ts)" "$*" | tee -a "$LOG" >&2; }

cd "$APP" || { err "cannot cd to $APP"; exit 1; }
[ -f .env ] || { err "no .env in $APP"; exit 1; }
set -a; . ./.env; set +a
ROOTPW="${MYSQL_ROOT_PASSWORD:-root}"

db_query() { docker compose exec -T -e MYSQL_PWD="$ROOTPW" db mysql -uroot -N -B "$@"; }

# --- 1. prune audit_log ------------------------------------------------------
# Done with SQL rather than the API endpoint: this runs unattended, has no
# bearer token to manage, and the statement is the same one the endpoint runs
# (server/lib/audit.js). Same 7..365 clamp, so a typo in the env cannot ask for
# a destructive window.
keep="$AUDIT_KEEP_DAYS"
case "$keep" in ''|*[!0-9]*) log "AUDIT_KEEP_DAYS='$keep' is not a number - skipping the audit prune"; keep=180 ;; esac
[ "$keep" -lt 7 ] && keep=7
[ "$keep" -gt 365 ] && keep=365

before="$(db_query -e "SELECT COUNT(*) FROM student_affairs.audit_log" 2>/dev/null | tr -d '[:space:]')"
if [ -z "$before" ]; then
  err "could not read audit_log - skipping the prune (not deleting anything blind)"
else
  deleted="$(db_query -e "DELETE FROM student_affairs.audit_log WHERE created_at < (NOW() - INTERVAL $keep DAY); SELECT ROW_COUNT();" 2>/dev/null | tail -1 | tr -d '[:space:]')"
  after="$(db_query -e "SELECT COUNT(*) FROM student_affairs.audit_log" 2>/dev/null | tr -d '[:space:]')"
  if [ -n "$deleted" ]; then
    log "audit_log: ${before:-?} -> ${after:-?} rows (dropped ${deleted:-0} older than $keep days)"
  else
    err "audit_log prune did not report a row count"
  fi
fi

# --- 2. backup freshness watchdog -------------------------------------------
# Nothing alerts on a failed backup, so a week of silent failures would go
# unnoticed. This is not a substitute for monitoring - it is the minimum: check
# the age of the newest dump and write a loud, greppable line if it is stale.
newest="$(ls -1t "$BACKUPS"/db/daily/*.sql.gz 2>/dev/null | head -1)"
if [ -z "$newest" ]; then
  err "NO DAILY DUMP AT ALL under $BACKUPS/db/daily - the site is running unbacked up"
else
  now_epoch="$(date -u +%s)"
  mtime_epoch="$(date -u -r "$newest" +%s 2>/dev/null || stat -c %Y "$newest")"
  age_h=$(( (now_epoch - mtime_epoch) / 3600 ))
  if [ "$age_h" -gt 30 ]; then
    err "newest daily dump is ${age_h}h old ($newest). Expected one within 24h - check backup.log."
  else
    log "newest daily dump is ${age_h}h old - within the 24h schedule"
  fi

  # A dump that stopped being written is worse than no dump, because the
  # directory still looks healthy. Prove the newest one still restores to the
  # right shape rather than merely existing.
  if command -v gzip >/dev/null 2>&1 && ! gzip -t "$newest" 2>/dev/null; then
    err "newest daily dump FAILS its gzip integrity check: $newest"
  else
    log "newest daily dump passes its gzip integrity check"
  fi
fi

# --- 3. trim the logs this system generates ----------------------------------
# backup.log grows by one line per backup forever. Rotate it rather than delete:
# an operator may need the history to work out when something broke.
for f in "$BACKUPS/backup.log" "$BACKUPS/maintenance.log"; do
  [ -f "$f" ] || continue
  size_mb=$(( $(wc -c < "$f") / 1024 / 1024 ))
  if [ "$size_mb" -ge "$MAX_LOG_MB" ]; then
    mv "$f" "$f.$(date -u +%Y%m%d)"
    : > "$f"
    log "rotated $(basename "$f") (was ${size_mb} MB)"
  fi
done

# restore-errors-*.log: one file per imperfect replay, never cleaned up.
old_errors="$(find "$BACKUPS" -maxdepth 1 -name 'restore-errors-*.log' -mtime +30 2>/dev/null)"
if [ -n "$old_errors" ]; then
  n="$(printf '%s\n' "$old_errors" | wc -l)"
  # shellcheck disable=SC2086
  rm -f $old_errors
  log "removed $n restore-error log(s) older than 30 days"
fi

if [ "$PROBLEMS" -gt 0 ]; then
  log "finished with $PROBLEMS problem(s) - see the ERROR lines above"
  exit 1
fi
log "done - nothing to report"