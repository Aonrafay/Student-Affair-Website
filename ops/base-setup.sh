#!/usr/bin/env bash
# One-time VM base setup for the Student Affairs CMS.
# Idempotent: safe to re-run.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

step() { echo; echo "===== $* ====="; }

step "apt update"
apt-get update -qq

step "apt upgrade"
apt-get -y -qq upgrade || echo "WARNING: some packages failed to upgrade"

step "packages"
apt-get install -y -qq git curl ufw rsync ca-certificates

step "docker engine"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
else
  echo "docker already present: $(docker --version)"
fi

systemctl enable --now docker
systemctl is-active docker

step "compose plugin"
docker compose version

step "let f24-bscs run docker without sudo"
# docker group membership is root-equivalent; on a single-tenant test VM that is
# the intended trade-off. Drop it with: sudo gpasswd -d f24-bscs docker
usermod -aG docker f24-bscs
id f24-bscs

step "firewall"
# OpenSSH first, so enabling ufw can never lock out the session we are on.
# NB: `ufw allow` takes no --force in this version; only `ufw enable` does.
ufw allow OpenSSH
ufw allow 5000/tcp
ufw --force enable
ufw status verbose

step "done"
