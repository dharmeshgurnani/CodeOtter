#!/usr/bin/env bash
# Installs CodeOtter on a Linux server: Docker, the release image, hourly Watchtower updates,
# and HTTPS through Caddy when a domain is given.
#
#   curl -fsSL https://raw.githubusercontent.com/dharmeshgurnani/CodeOtter/main/bin/install.sh | sudo bash
#   curl -fsSL https://raw.githubusercontent.com/dharmeshgurnani/CodeOtter/main/bin/install.sh | sudo CODEOTTER_DOMAIN=review.example.com bash
#
# Optional: CODEOTTER_DOMAIN (DNS A record must point here), CODEOTTER_DIR (default /opt/codeotter),
# CODEOTTER_REF (git ref for the Compose files, default main), and GH_TOKEN, LLM_API_KEY, LLM_MODEL,
# ANTHROPIC_API_KEY, OPENAI_API_KEY, copied into .env on first install.
# Re-running keeps .env (and its PocketBase password), refreshes the Compose files and restarts.
set -euo pipefail

REF="${CODEOTTER_REF:-main}"
DIR="${CODEOTTER_DIR:-/opt/codeotter}"
DOMAIN="${CODEOTTER_DOMAIN:-}"
RAW="https://raw.githubusercontent.com/dharmeshgurnani/CodeOtter/$REF"

if [ "$(id -u)" != 0 ]; then echo "Run as root (sudo)." >&2; exit 1; fi

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true
if ! docker compose version >/dev/null 2>&1; then echo "Docker Compose v2 plugin is required." >&2; exit 1; fi

mkdir -p "$DIR"
cd "$DIR"
curl -fsSL "$RAW/docker-compose.yml" -o docker-compose.yml
curl -fsSL "$RAW/deploy/caddy.yml" -o caddy.yml

if [ ! -f .env ]; then
  if [ -n "$DOMAIN" ]; then
    url="https://$DOMAIN"
  else
    ip="$(curl -fsS --max-time 5 https://checkip.amazonaws.com || hostname -I | awk '{print $1}')"
    url="http://$(echo "$ip" | tr -d '[:space:]'):4747"
  fi
  umask 077
  {
    echo "APP_URL=$url"
    echo "PB_ADMIN_EMAIL=admin@codeotter.local"
    echo "PB_ADMIN_PASSWORD=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
    if [ -n "$DOMAIN" ]; then
      echo "CODEOTTER_DOMAIN=$DOMAIN"
      echo "COMPOSE_FILE=docker-compose.yml:caddy.yml"
    fi
    for k in GH_TOKEN LLM_API_KEY LLM_MODEL ANTHROPIC_API_KEY OPENAI_API_KEY; do
      if [ -n "${!k:-}" ]; then echo "$k=${!k}"; fi
    done
  } > .env
fi

docker compose pull
docker compose up -d

url="$(grep '^APP_URL=' .env | cut -d= -f2-)"
echo
echo "CodeOtter is starting at $url"
echo "The first account to sign in becomes the owner. Sign in before sharing the address."
echo "Config: $DIR/.env   Logs: cd $DIR && docker compose logs -f codeotter"
