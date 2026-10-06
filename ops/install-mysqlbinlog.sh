#!/usr/bin/env bash
# mysqlbinlog lives in mysql-server-core-8.0 (verified: mysql-client-core and
# mysql-client both exclude it). That package also installs /usr/sbin/mysqld on
# the host, but nothing here starts it - the systemd unit ships with
# mysql-server-8.0, which is NOT installed. The site runs MySQL in a container.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get install -y -qq mysql-server-core-8.0

echo
echo "=== verification ==="
for b in mysqlbinlog mysql mysqldump; do
  printf '  %-12s %s\n' "$b" "$(command -v "$b" || echo MISSING)"
done
mysqlbinlog --version
echo
echo "  mysqld present but inert: $(command -v mysqld || echo 'no')"
systemctl is-active mysql 2>/dev/null || echo "  no host mysql service running"
echo
echo "  server in the container: $(cd /opt/student-affairs/app && ROOTPW=$(grep -E '^MYSQL_ROOT_PASSWORD=' .env | head -n1 | cut -d= -f2-) && docker compose exec -T -e MYSQL_PWD="$ROOTPW" db mysql -uroot -N -B -e 'SELECT VERSION()' < /dev/null)"