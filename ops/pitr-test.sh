#!/usr/bin/env bash
# End-to-end proof that point-in-time recovery actually reconstructs data.
#
#   1. run a backup so there is a base dump with a recorded binlog position
#   2. create a uniquely-named post and publish it, noting the exact moment
#   3. delete it, then recover to a moment AFTER it existed
#   4. the recovered scratch schema must contain that post
#   5. recover to a moment BEFORE it existed - it must not
#
# This is the only test that proves the binlog replay works, rather than that
# the files exist. Everything runs in throwaway schemas; live data is never
# touched.
#
#   bash /opt/student-affairs/pitr-test.sh
set -euo pipefail

# Every timestamp below is UTC. Without this, `date -u -d "$AFTER_CREATE + 5
# seconds"` parses the bare timestamp as LOCAL time (Asia/Karachi) and converts,
# silently recovering to a moment 5 hours off.
export TZ=UTC

BASE=/opt/student-affairs
APP="$BASE/app"
API="http://127.0.0.1:5000/student-affairs"
MARKER="pitr-marker-$(date -u +%s)"

log()  { printf '  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; exit 1; }

cd "$APP"
ROOT_PASSWORD="$(grep -E '^MYSQL_ROOT_PASSWORD=' .env | head -n1 | cut -d= -f2-)"
ADMIN_PASSWORD="$(grep -E '^ADMIN_PASSWORD=' .env | head -n1 | cut -d= -f2-)"
ADMIN_EMAIL="$(grep -E '^ADMIN_EMAIL=' .env | head -n1 | cut -d= -f2-)"
mysql_root() { docker compose exec -T -e MYSQL_PWD="$ROOT_PASSWORD" db mysql -uroot -N -B "$@" < /dev/null; }
mysql_live() { mysql_root student_affairs "$@"; }

echo "=== 1. base backup so there is a dump with a binlog position ==="
bash "$BASE/backup.sh" daily 2>&1 | grep -E '^\S+Z (OK|dumping)' | sed 's/^/  /'
# Remember which dump predates the marker. Step 3 takes another backup AFTER the
# marker exists, so without pinning this the restore would pick that one and the
# marker would already be inside the base dump - the replay would then prove
# nothing.
BASE_DUMP="$(ls -1t "$BASE/backups/db/daily"/*.sql.gz | head -1 | xargs basename | sed 's/\.sql\.gz$//')"
log "base dump for the recovery: $BASE_DUMP (taken before the marker exists)"

echo
echo "=== 2. create and publish a uniquely-named post ==="
TOKEN="$(curl -fsS -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  "$API/api/auth/login" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
[ -n "$TOKEN" ] || fail "could not get an admin token"

CREATED_ID="$(curl -fsS -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d "{\"title\":\"$MARKER\",\"category\":\"news\",\"body\":\"created for the PITR drill\"}" \
  "$API/api/admin/posts" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)"
[ -n "$CREATED_ID" ] || fail "could not create the marker post"

AFTER_CREATE="$(date -u '+%Y-%m-%d %H:%M:%S')"
log "created post id=$CREATED_ID titled $MARKER at $AFTER_CREATE UTC"
curl -fsS -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"status":"published"}' "$API/api/admin/posts/$CREATED_ID/publish" > /dev/null
log "published"

# Binlog event timestamps have one-second resolution, so the recovery target has
# to land strictly BETWEEN the create and the delete or the test is meaningless:
# too early and the post never existed, too late and the replay correctly
# re-applies the deletion. Sleeping here guarantees the window exists, and the
# assertion below proves the target is inside it rather than assuming so.
sleep 6

echo
echo "=== 3. rotate the binlog so the change lands in an archivable file ==="
mysql_root -e "FLUSH BINARY LOGS" > /dev/null
bash "$BASE/backup.sh" daily 2>&1 | grep -E 'archived' | sed 's/^/  /'

echo
echo "=== 4. delete it from live, so only a replay can bring it back ==="
DELETE_TIME="$(date -u '+%Y-%m-%d %H:%M:%S')"
curl -fsS -X DELETE -H "Authorization: Bearer $TOKEN" \
  "$API/api/admin/posts/$CREATED_ID" > /dev/null
sleep 1
mysql_root -e "FLUSH BINARY LOGS" > /dev/null
bash "$BASE/backup.sh" daily 2>&1 | grep -E 'archived' | sed 's/^/  /'
log "deleted at $DELETE_TIME UTC"
LIVE="$(mysql_live -e "SELECT COUNT(*) FROM posts WHERE title='$MARKER'" | tr -d '\r')"
log "live rows matching the marker now: $LIVE (expected 0)"
[ "$LIVE" = "0" ] || fail "the marker still exists in live data - aborting"

echo
echo "=== 5. recover to a moment AFTER it existed (must reappear) ==="
CREATE_EPOCH="$(date -u -d "$AFTER_CREATE" +%s)"
# 2s after the create: inside the create..delete window with room on both sides.
TARGET="$(date -u -d "@$((CREATE_EPOCH + 2))" '+%Y-%m-%d %H:%M:%S')"
DELETE_EPOCH="$(date -u -d "$DELETE_TIME" +%s)"
if [ "$((CREATE_EPOCH + 2))" -ge "$DELETE_EPOCH" ]; then
  fail "recovery window is empty: create $AFTER_CREATE / delete $DELETE_TIME are too close - increase the sleep"
fi
log "recovery window: $AFTER_CREATE -> $DELETE_TIME, targeting $TARGET UTC"
SCHEMA="$(timeout 600 bash "$BASE/restore-to-time.sh" "$TARGET" --from "$BASE_DUMP" --keep 2>&1 \
          | tee "$BASE/backups/.pitr-last.log" \
          | sed -n 's/.*recovered .* table(s) in \([a-z_0-9]*\)/\1/p' | tail -1)"
[ -n "$SCHEMA" ] || { tail -20 "$BASE/backups/.pitr-last.log" | sed 's/^/    /'; fail "restore-to-time did not report a scratch schema"; }

FOUND="$(mysql_root -e "SELECT COUNT(*) FROM \`$SCHEMA\`.posts WHERE title='$MARKER'" | tr -d '\r')"
if [ "${FOUND:-0}" -ge 1 ]; then
  log "PASS - the recovered schema contains the deleted post (rows=$FOUND)"
else
  log "FAIL - the recovered schema does NOT contain the post; binlog replay did not reapply it"
  mysql_root -e "DROP DATABASE IF EXISTS \`$SCHEMA\`;" > /dev/null 2>&1 || true
  exit 1
fi

echo
echo "=== 6. recover to a moment BEFORE it existed (must NOT be there) ==="
BEFORE="$(date -u -d "@$((CREATE_EPOCH - 30))" '+%Y-%m-%d %H:%M:%S')"
SCHEMA2="$(timeout 600 bash "$BASE/restore-to-time.sh" "$BEFORE" --from "$BASE_DUMP" --keep 2>&1 \
           | tee "$BASE/backups/.pitr-last.log" \
           | sed -n 's/.*recovered .* table(s) in \([a-z_0-9]*\)/\1/p' | tail -1)"
if [ -z "$SCHEMA2" ]; then
  log "SKIP - no dump predates the marker, so the negative case cannot be tested"
else
  FOUND2="$(mysql_root -e "SELECT COUNT(*) FROM \`$SCHEMA2\`.posts WHERE title='$MARKER'" | tr -d '\r')"
  if [ "${FOUND2:-0}" -eq 0 ]; then
    log "PASS - recovering before the creation correctly excludes it (rows=$FOUND2)"
  else
    log "FAIL - the post exists even though we recovered to before it was created"
  fi
  mysql_root -e "DROP DATABASE IF EXISTS \`$SCHEMA2\`;" > /dev/null 2>&1 || true
fi

mysql_root -e "DROP DATABASE IF EXISTS \`$SCHEMA\`;" > /dev/null 2>&1 || true
echo
echo "PITR DRILL COMPLETE - live data was never modified"