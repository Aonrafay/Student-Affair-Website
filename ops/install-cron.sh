#!/usr/bin/env bash
# Install the backup schedule for f24-bscs (idempotent).
#
# Times are the VM's local timezone (Asia/Karachi). The VM needs
# mysqlbinlog for point-in-time recovery and the official mysql:8 image does
# not ship it, so it comes from the host package instead:
#   sudo apt-get install -y mysql-client-core-8.0
set -euo pipefail

LOG=/opt/student-affairs/backups/backup.log
BLOCK_START="# >>> student-affairs backups >>>"
BLOCK_END="# <<< student-affairs backups <<<"

if ! command -v mysqlbinlog >/dev/null 2>&1; then
  echo "WARNING: mysqlbinlog is missing, so restore-to-time.sh will refuse to run."
  echo "         Install it with: sudo apt-get install -y mysql-client-core-8.0"
fi

# Drop any previous block, then append a fresh one.
current="$(crontab -l 2>/dev/null || true)"
cleaned="$(printf '%s\n' "$current" | sed "/$BLOCK_START/,/$BLOCK_END/d")"

new_block=$(cat <<EOF
$BLOCK_START
# Cron gets a minimal PATH; without this docker/gzip/git are not found.
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# Nightly: full dump (with its binlog position), archive the closed binary
# logs, snapshot .env, prune. Retention is small on purpose - the binlogs are
# what let you recover to any minute, so fewer full copies are needed.
15 2 * * * /opt/student-affairs/backup.sh daily >> $LOG 2>&1
# Sundays: the same, plus one full media archive (MEDIA_BACKUP=weekly).
30 3 * * 0 /opt/student-affairs/backup.sh weekly >> $LOG 2>&1
$BLOCK_END
EOF
)

printf '%s\n%s\n' "$cleaned" "$new_block" | sed '/^$/d' | crontab -

echo "--- crontab for $(whoami) ---"
crontab -l
echo
echo "timezone: $(timedatectl show -p Timezone --value 2>/dev/null || date +%Z)"
echo "  daily  : tomorrow 02:15  (db + binlogs + .env)"
echo "  weekly : next Sunday 03:15  (the above + one full media archive)"