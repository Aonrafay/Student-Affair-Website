#!/usr/bin/env bash
# Install the backup schedule for f24-bscs (idempotent).
set -euo pipefail

LOG=/opt/student-affairs/backups/backup.log
BLOCK_START="# >>> student-affairs backups >>>"
BLOCK_END="# <<< student-affairs backups <<<"

# Drop any previous block, then append a fresh one.
current="$(crontab -l 2>/dev/null || true)"
cleaned="$(printf '%s\n' "$current" | sed "/$BLOCK_START/,/$BLOCK_END/d")"

new_block=$(cat <<EOF
$BLOCK_START
# Cron gets a minimal PATH; without this docker/gzip/git are not found.
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# Nightly: database dump + uploaded media + .env, verified, then prune to 7 days.
15 2 * * * /opt/student-affairs/backup.sh daily >> $LOG 2>&1
# Sundays: same, but also keep a copy in backups/weekly for 28 days.
30 3 * * 0 /opt/student-affairs/backup.sh weekly >> $LOG 2>&1
$BLOCK_END
EOF
)

printf '%s\n%s\n' "$cleaned" "$new_block" | sed '/^$/d' | crontab -

echo "--- crontab for $(whoami) ---"
crontab -l
echo
echo "next runs (cron runs in the VM's local timezone: $(timedatectl show -p Timezone --value 2>/dev/null || date +%Z)):"
echo "  daily  : tomorrow 02:15"
echo "  weekly : next Sunday 03:15"
