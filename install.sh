#!/bin/sh
# steprail one-command installer.
#   curl -fsSL https://raw.githubusercontent.com/justynroberts/steprail/main/install.sh | sh
# Needs only Docker. Fetches the project, starts it (pulling the prebuilt image
# when available, else building), seeds the demo DB, waits for health, opens it.
# MIT License - Copyright (c) fintonlabs.com
set -eu

IMAGE="ghcr.io/justynroberts/steprail:latest"
REPO="https://github.com/justynroberts/steprail"
DIR="${STEPRAIL_DIR:-steprail}"
URL="http://localhost:8452"
DB="newflow-postgres-1"

say() { printf '\033[36m▸\033[0m %s\n' "$1"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "Docker is required — install it first: https://docs.docker.com/get-docker/"
docker info >/dev/null 2>&1 || die "Docker is installed but not running — start Docker and re-run."

# Compose v2 (`docker compose`) preferred, legacy binary as fallback.
if docker compose version >/dev/null 2>&1; then COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then COMPOSE="docker-compose"
else die "Docker Compose not found — install Docker Desktop or the compose plugin."; fi

# Get the project (compose file + seed SQL). Reuse the current checkout if we're
# already inside it; otherwise clone (or download a tarball if git is absent).
if [ -f docker-compose.yml ] && grep -q steprail docker-compose.yml 2>/dev/null; then
  say "Using the steprail checkout in $(pwd)"
elif [ -f "$DIR/docker-compose.yml" ]; then
  say "Using existing $DIR"; cd "$DIR"
  # Upgrade path: refresh the source so a from-source rebuild picks up the new
  # version (the data volume is preserved either way).
  if [ -d .git ] && command -v git >/dev/null 2>&1; then
    git pull --ff-only --quiet 2>/dev/null && say "Updated source to the latest release" || say "Kept existing source (couldn't fast-forward)"
  fi
elif command -v git >/dev/null 2>&1; then
  say "Cloning steprail into ./$DIR"; git clone --depth 1 --quiet "$REPO" "$DIR"; cd "$DIR"
else
  say "Downloading steprail into ./$DIR"; mkdir -p "$DIR"
  curl -fsSL "$REPO/archive/refs/heads/main.tar.gz" | tar -xz -C "$DIR" --strip-components=1; cd "$DIR"
fi

# Prefer the prebuilt multi-arch image (fast); fall back to building from source.
if docker pull "$IMAGE" >/dev/null 2>&1; then
  say "Starting from the prebuilt image (no build needed)…"
  $COMPOSE up -d
else
  say "No prebuilt image reachable — building from source (first run only)…"
  $COMPOSE up -d --build
fi

# Seed the demo Postgres (safe to re-run; skipped if the DB isn't up).
if docker ps --format '{{.Names}}' | grep -q "^$DB$"; then
  say "Seeding demo data…"
  i=0; while [ $i -lt 30 ]; do docker exec "$DB" pg_isready -U newflow -d demo >/dev/null 2>&1 && break; i=$((i+1)); sleep 1; done
  docker exec -i "$DB" psql -q -U newflow -d demo < docker/initdb/01-demo.sql >/dev/null 2>&1 || true
fi

# Wait for health.
say "Waiting for steprail to be healthy…"
i=0; while [ $i -lt 40 ]; do
  if curl -fsS "$URL/api/health" >/dev/null 2>&1; then
    printf '\n\033[32m  ✔ steprail is running →  %s\033[0m\n' "$URL"
    printf '    Stop it with:  %s down   (from ./%s)\n\n' "$COMPOSE" "$(basename "$(pwd)")"
    (command -v open >/dev/null 2>&1 && open "$URL") \
      || (command -v xdg-open >/dev/null 2>&1 && xdg-open "$URL") || true
    exit 0
  fi
  i=$((i+1)); sleep 1
done
die "Started, but the API didn't report healthy in time — check: $COMPOSE logs newflow"
