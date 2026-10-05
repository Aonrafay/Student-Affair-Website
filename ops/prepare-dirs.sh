#!/usr/bin/env bash
# Create the deployment tree. Runs as root; the app dir is handed to f24-bscs so
# day-to-day deploys and backups need no sudo.
set -euo pipefail

BASE=/opt/student-affairs
sudo_user=f24-bscs

mkdir -p "$BASE/backups/db" "$BASE/backups/uploads" "$BASE/backups/env" "$BASE/backups/weekly"
chown -R "$sudo_user:$sudo_user" "$BASE"
chmod 700 "$BASE/backups/env"

echo "created:"
ls -ld "$BASE" "$BASE/backups" "$BASE/backups/env"
