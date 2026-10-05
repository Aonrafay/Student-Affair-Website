#!/usr/bin/env bash
# Prove the data survives a full container recreate.
#
# `docker compose down` destroys the containers but keeps the named volumes, so
# this is the real test that the database and uploaded media live in volumes and
# not inside the containers. `-v` is deliberately NOT used: that would delete
# the data.
set -euo pipefail
cd /opt/student-affairs/app

echo "=== before ==="
docker compose ps

echo
echo "=== docker compose down (volumes kept) ==="
docker compose down

echo
echo "=== docker compose up -d ==="
docker compose up -d

echo
echo "=== waiting for health ==="
for i in $(seq 1 40); do
  body="$(curl -fsS --max-time 5 http://127.0.0.1:5000/student-affairs/api/health 2>/dev/null || true)"
  case "$body" in
    *'"ok":true'*) echo "healthy after $((i * 5))s: $body"; break ;;
  esac
  [ "$i" -eq 40 ] && { echo "TIMED OUT"; docker compose logs --tail 40 app; exit 1; }
  sleep 5
done

echo
echo "=== data after recreate ==="
DBP="$(grep -E '^DB_PASSWORD=' .env | head -n1 | cut -d= -f2-)"
docker compose exec -T -e MYSQL_PWD="$DBP" db \
  mysql -usa -N -B -e "SELECT CONCAT('  posts        = ', COUNT(*)) FROM posts" student_affairs
docker compose exec -T -e MYSQL_PWD="$DBP" db \
  mysql -usa -N -B -e "SELECT CONCAT('  users        = ', COUNT(*)) FROM users" student_affairs
docker compose exec -T -e MYSQL_PWD="$DBP" db \
  mysql -usa -N -B -e "SELECT CONCAT('  events       = ', COUNT(*)) FROM events" student_affairs
echo "  uploads dir  = $(docker compose exec -T app sh -c 'ls -1 /app/uploads | grep -v gitkeep | wc -l') file(s)"

echo
echo "=== reboot-safety configuration ==="
printf '  docker.service enabled : %s\n' "$(systemctl is-enabled docker 2>/dev/null || echo unknown)"
printf '  restart policies       : '
docker inspect -f '{{.Name}}={{.HostConfig.RestartPolicy.Name}}' app-app-1 app-db-1 | tr '\n' ' '
echo
