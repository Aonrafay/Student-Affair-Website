#!/usr/bin/env bash
# Restore the CMS to a specific moment using a full dump plus the binary logs.
#
#   bash restore-to-time.sh "2026-10-05 14:30:00"
#   bash restore-to-time.sh 2026-10-05T14:30:00
#   bash restore-to-time.sh --list                    # what can be recovered
#   bash restore-to-time.sh --dry-run "2026-10-05 14:30"
#
# How it works:
#   1. pick the newest full dump taken at or before the target time
#   2. restore it (the dump records the binlog file+position it came from)
#   3. replay archived binlogs from that position up to the target time
#
# Requires mysqlbinlog on the VM host, because the official mysql:8 image ships
# mysqldump but NOT mysqlbinlog:
#   sudo apt-get install -y mysql-client-core-8.0
#
# SAFETY: restores into a throwaway schema by default so you can verify before
# touching live data. Pass --apply to restore over student_affairs.
set -euo pipefail

# All timestamps here are UTC, and `date -d` parses a bare "YYYY-MM-DD HH:MM:SS"
# as LOCAL time otherwise - on this VM that silently shifts every target by the
# UTC offset (5 hours in Asia/Karachi), recovering to the wrong moment. Forcing
# TZ=UTC makes `date -u` formatting and `date -d` parsing agree.
export TZ=UTC

BASE=/opt/student-affairs
APP="$BASE/app"
BACKUPS="$BASE/backups"
DIR_DB="$BACKUPS/db"
DIR_DAILY="$DIR_DB/daily"
DIR_BINLOG="$DIR_DB/binlog"
DIR_META="$DIR_DB/manifests"
LIVE_DB=student_affairs

log()  { printf '%s pitr    %s\n' "$(date -u '+%H:%M:%S')" "$*"; }
die()  { printf '%s pitr    ERROR: %s\n' "$(date -u '+%H:%M:%S')" "$*" >&2; exit 1; }

APPLY=0
DRY=0
LIST=0
KEEP_SCHEMA=0
TARGET=""
FROM_DUMP=""

# `shift` inside `for arg in "$@"` does not work as expected - the word list is
# already expanded - so option arguments are consumed with an explicit flag.
NEED_FROM=0
for arg in "$@"; do
  if [ "$NEED_FROM" -eq 1 ]; then FROM_DUMP="$arg"; NEED_FROM=0; continue; fi
  case "$arg" in
    --apply)   APPLY=1 ;;
    --dry-run) DRY=1 ;;
    --list)    LIST=1 ;;
    # Leaves the scratch schema in place so the recovery can be inspected.
    # Used by ops/pitr-test.sh; drop it yourself when done.
    --keep)    KEEP_SCHEMA=1 ;;
    # Pin the base dump instead of letting the timestamp pick one. Needed to
    # actually exercise binlog replay: given only a target time, the newest
    # qualifying dump is chosen and may already contain the very changes you
    # are trying to replay.
    --from)    NEED_FROM=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *)         TARGET="$arg" ;;
  esac
done

cd "$APP"
ROOT_PASSWORD="$(grep -E '^MYSQL_ROOT_PASSWORD=' .env | head -n1 | cut -d= -f2-)"
[ -n "$ROOT_PASSWORD" ] || die "MYSQL_ROOT_PASSWORD missing from .env"
mysql_root() { docker compose exec -T -e MYSQL_PWD="$ROOT_PASSWORD" db mysql -uroot -N -B "$@" < /dev/null; }

# --- what is recoverable -----------------------------------------------------
if [ "$LIST" -eq 1 ] || [ -z "$TARGET" ]; then
  log "full dumps on disk:"
  for m in "$DIR_META"/*.meta; do
    [ -e "$m" ] || continue
    taken="$(grep -oE 'taken_at=.*' "$m" 2>/dev/null | cut -d= -f2- || true)"
    printf '  %s  taken=%s  tables=%s  commit=%s  binlog=%s:%s\n' \
      "$(basename "$m" .meta)" \
      "${taken:-<legacy - dump only, no replay>}" \
      "$(grep -oE 'tables=.*' "$m" | cut -d= -f2- || true)" \
      "$(grep -oE 'commit=.*' "$m" | cut -d= -f2- || true)" \
      "$(grep -oE 'binlog_file=.*' "$m" | cut -d= -f2- || echo '?')" \
      "$(grep -oE 'binlog_pos=.*' "$m" | cut -d= -f2- || echo '?')"
  done
  log "binlog archives (recovery is possible up to the newest one):"
  for a in "$DIR_BINLOG"/*.tgz; do
    [ -e "$a" ] || continue
    printf '  %s  %s\n' "$(basename "$a")" "$(du -h "$a" | cut -f1)"
  done
  log "usage: bash restore-to-time.sh \"YYYY-MM-DD HH:MM:SS\" [--apply]"
  exit 0
fi

command -v mysqlbinlog >/dev/null 2>&1 || die "mysqlbinlog is not installed on this host. Install it with: sudo apt-get install -y mysql-client-core-8.0"

# Normalise the timestamp for comparisons.
TARGET_EPOCH="$(date -u -d "$TARGET" +%s 2>/dev/null)" || die "cannot parse '$TARGET' - use 'YYYY-MM-DD HH:MM:SS'"
TARGET_SQL="$(date -u -d "@$TARGET_EPOCH" '+%Y-%m-%d %H:%M:%S')"
log "target: $TARGET_SQL UTC"

# --- choose the dump ---------------------------------------------------------
CHOSEN=""
CHOSEN_TS=0
if [ -n "$FROM_DUMP" ]; then
  # Explicitly pinned by the operator (or the PITR drill).
  [ -f "$DIR_META/$FROM_DUMP.meta" ] || die "no manifest for dump '$FROM_DUMP' (check --list)"
  CHOSEN="$FROM_DUMP"
  CHOSEN_TS="$(date -u -d "$(grep -oE 'taken_at=.*' "$DIR_META/$CHOSEN.meta" | cut -d= -f2-)" +%s 2>/dev/null || echo 0)"
else
for m in "$DIR_META"/*.meta; do
  [ -e "$m" ] || continue
  # Manifests written by an older backup.sh carry no taken_at / binlog position.
  # `grep` exits 1 when it matches nothing, and under `set -o pipefail` that
  # silently killed the whole script at the first legacy file - hence the
  # explicit skip and the `|| true` on every extraction below.
  ts="$(grep -oE 'taken_at=.*' "$m" 2>/dev/null | cut -d= -f2- || true)"
  [ -n "$ts" ] || { echo "  (skipping $(basename "$m"): no taken_at - written before manifests recorded one)" >&2; continue; }
  epoch="$(date -u -d "$ts" +%s 2>/dev/null || echo 0)"
  if [ "$epoch" -le "$TARGET_EPOCH" ] && [ "$epoch" -gt "$CHOSEN_TS" ]; then
    CHOSEN="$(basename "$m" .meta)"; CHOSEN_TS="$epoch"
  fi
done
fi
[ -n "$CHOSEN" ] || die "no usable dump taken at or before $TARGET_SQL (check --list for what exists)"
DUMP="$DIR_DAILY/$CHOSEN.sql.gz"
[ -f "$DUMP" ] || DUMP="$DIR_WEEKLY/$CHOSEN.sql.gz"
[ -f "$DUMP" ] || die "dump for $CHOSEN not found in $DIR_DAILY or $DIR_WEEKLY"
SRC_FILE="$(grep -oE 'binlog_file=.*' "$DIR_META/$CHOSEN.meta" | cut -d= -f2- || true)"
SRC_POS="$(grep -oE 'binlog_pos=.*' "$DIR_META/$CHOSEN.meta" | cut -d= -f2- || true)"
log "base dump: $CHOSEN (taken $(date -u -d "@$CHOSEN_TS" '+%F %T') UTC)"
log "binlog start: ${SRC_FILE:-unknown}:${SRC_POS:-4}"

# --- gather the binlogs to replay -------------------------------------------
# Extract the archived closed logs into a scratch dir the host can read.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FOUND_ANY=0
for a in "$DIR_BINLOG"/*.tgz; do
  [ -e "$a" ] || continue
  tar xzf "$a" -C "$WORK" 2>/dev/null && FOUND_ANY=1
done
[ "$FOUND_ANY" -eq 1 ] || die "no binlog archives found under $DIR_BINLOG"

# Order the logs, and start at the dump's binlog position.
mapfile -t LOGFILES < <(find "$WORK" -name 'binlog.[0-9]*' -printf '%f\n' | sort)
if [ "${#LOGFILES[@]}" -eq 0 ]; then die "binlog archives contained no binlog files"; fi

START_IDX=0
APPLY_POS=1
if [ -n "$SRC_FILE" ]; then
  FOUND=0
  for i in "${!LOGFILES[@]}"; do
    if [ "${LOGFILES[$i]}" = "$SRC_FILE" ]; then START_IDX=$i; FOUND=1; break; fi
  done
  if [ "$FOUND" -eq 0 ]; then
    # The log the dump came from was still active at dump time, so it was not
    # archived. Start from the earliest archive we DO have - and crucially drop
    # the start-position, because that offset means nothing in a different file.
    # Applying it anyway makes mysqlbinlog abort on the first read
    # ("Could not read entry at offset N"), and the replay silently applies
    # nothing at all.
    log "  $SRC_FILE was never archived; replaying from ${LOGFILES[0]} with no start-position"
    START_IDX=0
    APPLY_POS=0
  fi
fi
REPLAY=("${LOGFILES[@]:$START_IDX}")
log "replaying ${#REPLAY[@]} binlog file(s): ${REPLAY[0]} .. ${REPLAY[${#REPLAY[@]}-1]}"

if [ "$DRY" -eq 1 ]; then
  log "--dry-run: would restore $CHOSEN then replay through $TARGET_SQL into ${LIVE_DB}"
  exit 0
fi

if [ "$APPLY" -eq 0 ]; then
  log "DRY SAFETY: writing into a scratch schema. Re-run with --apply to restore live data."
  TARGET_DB="pitr_drill_$$"
  mysql_root -e "DROP DATABASE IF EXISTS \`$TARGET_DB\`; CREATE DATABASE \`$TARGET_DB\` CHARACTER SET utf8mb4;"
  KEEP=1
else
  TARGET_DB="$LIVE_DB"
  KEEP=0
  log "stopping the app for the restore"
  docker compose stop app >/dev/null
fi

cleanup() {
  if [ "$KEEP" -eq 1 ] && [ "$KEEP_SCHEMA" -eq 0 ]; then
    mysql_root -e "DROP DATABASE IF EXISTS \`${TARGET_DB}\`;" >/dev/null 2>&1 || true
  elif [ "$KEEP" -eq 1 ]; then
    log "scratch schema $TARGET_DB LEFT IN PLACE for inspection"
    log "  drop it with: docker compose exec -T db mysql -uroot -e 'DROP DATABASE $TARGET_DB'"
  else
    docker compose start app >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# --- 1. the base dump --------------------------------------------------------
log "importing $CHOSEN into $TARGET_DB"
# NO `< /dev/null` here. The dump arrives on stdin through the pipe, and a
# redirection would override it: mysql would see EOF immediately and exit, then
# zcat/sed take SIGPIPE (141), which pipefail reports as failure and `set -e`
# turns into a silent abort partway through the restore.
{
  # Swap in the schema name so a drill never touches live tables.
  if [ "$KEEP" -eq 1 ]; then
    zcat "$DUMP" | sed "s/\`$LIVE_DB\`/\`$TARGET_DB\`/g"
  else
    zcat "$DUMP"
  fi
} | docker compose exec -T -e MYSQL_PWD="$ROOT_PASSWORD" db mysql -uroot "$TARGET_DB"

# --- 2. replay the binary logs ----------------------------------------------
# --start-position applies to the first file only; --stop-datetime cuts every
# file off at the target moment, which is what makes this "restore to a time".
if [ "${#REPLAY[@]}" -gt 0 ] && { [ "$APPLY_POS" -eq 0 ] || { [ -n "$SRC_POS" ] && [ "$SRC_POS" -gt 0 ]; }; }; then
  log "replaying to $TARGET_SQL"
  PATHS=()
  for f in "${REPLAY[@]}"; do PATHS+=("$WORK/$f"); done

  # --force lets the replay continue past errors instead of aborting halfway.
  # This is needed because mysqldump records its binlog position marginally
  # BEFORE the snapshot it actually takes, so a few INSERTs can be replayed on
  # top of rows the dump already contains - a duplicate primary key on
  # audit_log, for instance. Aborting there would lose every later change, which
  # is far worse than skipping one conflicting row.
  #
  # Errors are NOT swallowed: they are written to a file next to the backups and
  # summarised here, so an operator can see exactly what did not apply.
  #
  # --rewrite-db is ESSENTIAL for a drill. Binlog row events are fully
  # qualified (`student_affairs`.`posts`), so replaying them unmodified applies
  # them to the LIVE database no matter which schema you imported the dump
  # into. During testing that silently rewrote live content - it deleted 5 of 7
  # events and re-inserted deleted rows. When the target is a scratch schema,
  # every event is repointed at it. Restoring live needs no rewrite.
  REWRITE=()
  if [ "$KEEP" -eq 1 ]; then
    REWRITE=(--rewrite-db="$LIVE_DB->$TARGET_DB")
  fi

  POS_ARGS=()
  if [ "$APPLY_POS" -eq 1 ]; then POS_ARGS=(--start-position="$SRC_POS"); fi

  ERRLOG="$BACKUPS/restore-errors-$(date -u '+%Y%m%d-%H%M%S').log"
  MYSQLBINLOG_RC=0
  mysqlbinlog "${POS_ARGS[@]}" --stop-datetime="$TARGET_SQL" "${REWRITE[@]}" "${PATHS[@]}" \
    | docker compose exec -T -e MYSQL_PWD="$ROOT_PASSWORD" db \
        mysql -uroot "$TARGET_DB" --force 2>"$ERRLOG" || MYSQLBINLOG_RC=$?

  # grep -c prints 0 and exits 1 when nothing matches, so normalise both.
  ERRS="$(grep -c 'ERROR' "$ERRLOG" 2>/dev/null || true)"
  ERRS="${ERRS//[^0-9]/}"
  [ -n "$ERRS" ] || ERRS=0

  # mysqlbinlog itself failing is NOT the same as "replayed cleanly". Reporting
  # a clean replay after mysqlbinlog aborted would be the most dangerous kind of
  # wrong: the operator believes the recovery worked.
  if [ "$MYSQLBINLOG_RC" -ne 0 ]; then
    log "WARNING: the replay did NOT complete cleanly (mysqlbinlog exit $MYSQLBINLOG_RC)."
    log "  This recovery is INCOMPLETE. Treat it as suspect and read $ERRLOG:"
    grep -E 'ERROR|truncated|Could not read' "$ERRLOG" 2>/dev/null | head -5 | sed 's/^/    /'
  elif [ "$ERRS" -gt 0 ]; then
    log "WARNING: replay reported $ERRS error(s); the rest applied. Summary:"
    grep '^ERROR' "$ERRLOG" | sed -E 's/[0-9]+ for key/KEY/' | sort | uniq -c | sort -rn \
      | head -8 | sed 's/^/    /'
    log "  full log: $ERRLOG"
    if grep -qE "for key '(posts|events|notices|societies|team_members|partners|documents|pages)'\." "$ERRLOG"; then
      log "  *** at least one CONTENT table had a conflict - inspect before trusting this recovery ***"
    fi
  else
    log "replayed cleanly, no errors"
    rm -f "$ERRLOG"
  fi
else
  log "no usable binlog position - stopping at the dump (no replay performed)"
fi

# --- 3. report ---------------------------------------------------------------
TABLES="$(mysql_root -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$TARGET_DB'" | tr -d '\r')"
log "recovered $TABLES table(s) in $TARGET_DB"
if [ "$KEEP" -eq 1 ]; then
  log "scratch schema dropped; live data untouched"
else
  log "starting the app (migrations re-run on boot)"
  docker compose up -d >/dev/null
  for i in $(seq 1 40); do
    body="$(curl -fsS --max-time 5 http://127.0.0.1:5000/student-affairs/api/health 2>/dev/null || true)"
    case "$body" in *'"ok":true'*) log "healthy: $body"; break ;; esac
    [ "$i" -eq 40 ] && die "app did not become healthy"
    sleep 5
  done
fi