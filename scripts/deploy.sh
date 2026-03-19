#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/ai-review-app}"
BRANCH="${BRANCH:-main}"

log() {
  printf '[deploy] %s\n' "$1"
}

require_file() {
  local path="$1"
  if [ ! -f "$path" ]; then
    printf 'Missing required file: %s\n' "$path" >&2
    exit 1
  fi
}

log "Starting deploy in $APP_DIR (branch: $BRANCH)"
cd "$APP_DIR"

require_file ".env"
require_file "secrets/github_private_key.pem"

log "Fetching latest code"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

log "Building and starting containers"
docker compose up -d --build

log "Pruning dangling images"
docker image prune -f >/dev/null 2>&1 || true

log "Deploy finished"
