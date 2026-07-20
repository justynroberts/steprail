# steprail — one-command operation.
# `make` (or `make up`) is all you need: build, start, seed, health-check, open.
# MIT License - Copyright (c) fintonlabs.com

# Use Docker Compose v2 (`docker compose`) when present, else legacy binary.
COMPOSE := $(shell docker compose version >/dev/null 2>&1 && echo "docker compose" || echo "docker-compose")
URL     := http://localhost:8452
DB      := newflow-postgres-1

.DEFAULT_GOAL := up
.PHONY: up dev down restart logs health seed test test-e2e build clean open help

## up: build image, start everything, seed demo DB, wait for health (the one command)
up:
	@echo "▸ Building and starting steprail ($(COMPOSE))…"
	@$(COMPOSE) up --build -d
	@$(MAKE) --no-print-directory seed
	@$(MAKE) --no-print-directory health
	@echo ""
	@echo "  ✔ steprail is up →  $(URL)"
	@echo "    Reports/health →  $(URL)/api/health"
	@echo "    Stop it with   →  make down"

## dev: run with hot reload (Vite :8451 + API :8452), no Docker. Ctrl-C to stop.
dev:
	@command -v node >/dev/null || { echo "Node.js is required for dev mode — use 'make up' for Docker instead."; exit 1; }
	@test -d node_modules || npm install
	@echo "▸ Dev servers → client http://localhost:8451 (API :8452). Ctrl-C to stop."
	@npm run dev

## seed: load the demo Postgres dataset (safe to re-run; ignored if DB absent)
seed:
	@if docker ps --format '{{.Names}}' | grep -q '^$(DB)$$'; then \
	  echo "▸ Seeding demo database…"; \
	  until docker exec $(DB) pg_isready -U newflow -d demo >/dev/null 2>&1; do sleep 1; done; \
	  docker exec -i $(DB) psql -q -U newflow -d demo < docker/initdb/01-demo.sql >/dev/null 2>&1 || true; \
	  echo "  ✔ demo data loaded (postgres://newflow:newflow@postgres:5432/demo)"; \
	else echo "  (postgres container not running — skipping seed)"; fi

## health: wait until the API reports healthy (up to ~30s)
health:
	@echo "▸ Waiting for health…"
	@for i in $$(seq 1 30); do \
	  if curl -fsS $(URL)/api/health >/dev/null 2>&1; then echo "  ✔ healthy"; exit 0; fi; \
	  sleep 1; done; \
	echo "  ✗ not healthy after 30s — check 'make logs'"; exit 1

## logs: follow the app container logs
logs:
	@$(COMPOSE) logs -f newflow

## down: stop and remove the containers (data volumes are kept)
down:
	@$(COMPOSE) down
	@echo "  ✔ stopped (data preserved — 'make clean' to wipe volumes)"

## restart: rebuild and restart just the app after code changes
restart:
	@$(COMPOSE) up --build -d newflow
	@$(MAKE) --no-print-directory health

## test: run the committed engine + API test suite
test:
	@test -d node_modules || npm install
	@npm test

## test-e2e: build the client and drive the real app in a browser (Playwright)
test-e2e:
	@test -d node_modules || npm install
	@npx playwright install chromium >/dev/null 2>&1 || true
	@npm run test:e2e

## build: type-check (strict) and produce the production client bundle
build:
	@test -d node_modules || npm install
	@npm run build

## clean: stop and remove containers AND data volumes (destructive)
clean:
	@$(COMPOSE) down -v
	@echo "  ✔ containers and volumes removed"

## open: open the app in your default browser
open:
	@(command -v open >/dev/null && open $(URL)) || (command -v xdg-open >/dev/null && xdg-open $(URL)) || echo "Open $(URL)"

## help: list targets
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## /  make /'
