# OpenERP developer commands.
#
# Requires the toolchain on PATH:  source scripts/env.sh
#
# Infrastructure comes from Docker Compose when available, otherwise from the
# rootless scripts in scripts/ (see README).

SHELL := /bin/bash
.DEFAULT_GOAL := help

BACKEND  := backend
FRONTEND := frontend
COMPOSE  := docker compose -f docker/compose.yml

.PHONY: help
help:  ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# --- setup -----------------------------------------------------------------

.PHONY: install
install: install-backend install-frontend install-e2e  ## Install all dependencies

.PHONY: install-backend
install-backend:  ## Install backend dependencies
	cd $(BACKEND) && uv sync

.PHONY: install-frontend
install-frontend:  ## Install frontend dependencies
	cd $(FRONTEND) && npm ci || (cd $(FRONTEND) && npm install)

# --- infrastructure --------------------------------------------------------

.PHONY: up
up:  ## Start PostgreSQL and Mailpit (Docker)
	$(COMPOSE) up -d --wait

.PHONY: down
down:  ## Stop the Docker services
	$(COMPOSE) down

.PHONY: up-rootless
up-rootless:  ## Start PostgreSQL and Mailpit without Docker
	./scripts/dev-postgres.sh start
	./scripts/dev-mailpit.sh start

.PHONY: down-rootless
down-rootless:  ## Stop the rootless services
	./scripts/dev-mailpit.sh stop || true
	./scripts/dev-postgres.sh stop || true

# --- database --------------------------------------------------------------

.PHONY: db-create
db-create:  ## Create the application database if missing
	cd $(BACKEND) && uv run python -m scripts.devdb create

.PHONY: db-upgrade
db-upgrade:  ## Apply all migrations
	cd $(BACKEND) && uv run alembic upgrade head

.PHONY: db-downgrade
db-downgrade:  ## Roll back one migration
	cd $(BACKEND) && uv run alembic downgrade -1

.PHONY: db-revision
db-revision:  ## Autogenerate a migration:  make db-revision m="add products"
	cd $(BACKEND) && uv run alembic revision --autogenerate -m "$(m)"

.PHONY: db-reset
db-reset:  ## Drop, recreate and migrate the database
	cd $(BACKEND) && uv run python -m scripts.devdb reset && uv run alembic upgrade head

# --- auth --------------------------------------------------------------

.PHONY: bootstrap-admin
bootstrap-admin:  ## Create the first admin user (interactive)
	cd $(BACKEND) && uv run python -m app.auth.bootstrap

.PHONY: seed-e2e
seed-e2e:  ## Seed the fixed admin/cashier accounts the Playwright suite logs in as
	cd $(BACKEND) && uv run python -m scripts.seed_e2e_users

# --- run -------------------------------------------------------------------

.PHONY: dev-api
dev-api:  ## Run the API with reload
	cd $(BACKEND) && uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

.PHONY: dev-web
dev-web:  ## Run the frontend dev server
	cd $(FRONTEND) && npm run dev

# --- quality ---------------------------------------------------------------

.PHONY: lint
lint: lint-backend lint-frontend  ## Lint everything

.PHONY: lint-backend
lint-backend:  ## Ruff + mypy
	cd $(BACKEND) && uv run ruff check . && uv run ruff format --check . && uv run mypy app scripts tests

.PHONY: lint-frontend
lint-frontend:  ## ESLint + Prettier + tsc
	cd $(FRONTEND) && npm run lint && npm run format:check && npm run typecheck

.PHONY: format
format:  ## Autoformat everything
	cd $(BACKEND) && uv run ruff check --fix . && uv run ruff format .
	cd $(FRONTEND) && npm run format

# --- tests -----------------------------------------------------------------

.PHONY: test
test: test-backend test-frontend  ## Run backend and frontend unit/integration tests

.PHONY: test-backend
test-backend:  ## pytest against a real PostgreSQL
	cd $(BACKEND) && uv run pytest

.PHONY: test-frontend
test-frontend:  ## Vitest + React Testing Library
	cd $(FRONTEND) && npm run test

.PHONY: test-e2e
test-e2e:  ## Playwright end-to-end suite (boots API + frontend)
	npm run test:e2e

.PHONY: install-e2e
install-e2e:  ## Install Playwright and its browser
	npm install && npx playwright install --with-deps chromium

.PHONY: build
build:  ## Production build of the frontend
	cd $(FRONTEND) && npm run build

.PHONY: check
check: lint test build  ## Everything CI runs, except E2E
