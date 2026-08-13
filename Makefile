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
PYTEST   := cd $(BACKEND) && uv run pytest -q

SALES_TESTS := \
	tests/test_sales.py \
	tests/test_checkout.py \
	tests/test_checkout_cashier_attribution.py \
	tests/test_returns.py \
	tests/test_tickets.py \
	tests/test_sale_history.py
PRICING_TESTS := \
	tests/test_pricing_formula.py \
	tests/test_pricing_router.py \
	tests/test_pricing_taxes.py
INVENTORY_TESTS := \
	tests/test_inventory.py \
	tests/test_lots.py \
	tests/test_numeric_storage.py \
	tests/test_receiving.py
REPORTS_TESTS := \
	tests/test_reports.py \
	tests/test_z_reports.py \
	tests/test_ticket_render.py

.PHONY: help
help:  ## Show this help
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
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

.PHONY: db-backup
db-backup:  ## Back up the database to backups/ (needs pg_dump on PATH)
	./scripts/backup-postgres.sh

.PHONY: db-restore
db-restore:  ## Restore a backup:  make db-restore f=backups/openerp_....dump
	./scripts/restore-postgres.sh "$(f)"

# --- auth --------------------------------------------------------------

.PHONY: bootstrap-admin
bootstrap-admin:  ## Create the first admin user (interactive)
	cd $(BACKEND) && uv run python -m app.auth.bootstrap

.PHONY: seed-e2e
seed-e2e:  ## Seed the fixed admin/cashier accounts the Playwright suite logs in as
	cd $(BACKEND) && uv run python -m scripts.seed_e2e_users

.PHONY: seed-e2e-catalog
seed-e2e-catalog:  ## Seed a minimal POS category/products so /pos has something to sell
	cd $(BACKEND) && uv run python -m scripts.seed_e2e_catalog

# --- run -------------------------------------------------------------------

.PHONY: dev-api
dev-api:  ## Run the API with reload
	cd $(BACKEND) && uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

.PHONY: dev-web
dev-web:  ## Run the frontend dev server
	cd $(FRONTEND) && npm run dev

.PHONY: dev-worker
dev-worker:  ## Run the outbox worker (phase 18 — polls and sends queued emails)
	cd $(BACKEND) && uv run python -m app.jobs.worker

# --- quality ---------------------------------------------------------------

.PHONY: lint
lint: lint-backend lint-frontend  ## Lint everything

.PHONY: lint-backend
lint-backend:  ## Ruff + mypy
	cd $(BACKEND) && uv run ruff check . && uv run ruff format --check . && uv run mypy app scripts tests

.PHONY: lint-frontend
lint-frontend:  ## ESLint + Prettier + tsc
	cd $(FRONTEND) && npm run lint && npm run format:check && npm run typecheck

.PHONY: lint-frontend-fast
lint-frontend-fast:  ## ESLint + Prettier on explicit frontend paths: make lint-frontend-fast FILES="src/App.tsx"
	@if [ -z "$(strip $(FILES))" ]; then \
		echo 'ERROR: FILES is required; lint-frontend-fast never falls back to the full frontend.' >&2; \
		exit 2; \
	fi
	cd $(FRONTEND) && npm run lint:files -- $(FILES) && npm run format:check:files -- $(FILES)

.PHONY: format
format:  ## Autoformat everything
	cd $(BACKEND) && uv run ruff check --fix . && uv run ruff format .
	cd $(FRONTEND) && npm run format

# --- tests -----------------------------------------------------------------

.PHONY: test-fast
test-fast:  ## Run explicit backend tests with fail-fast: make test-fast TESTS="tests/test_sales.py::test_name"
	@if [ -z "$(strip $(TESTS))" ]; then \
		echo 'ERROR: TESTS is required; test-fast never falls back to the full suite.' >&2; \
		exit 2; \
	fi
	$(PYTEST) -x $(TESTS)

.PHONY: test-backend-unit
test-backend-unit:  ## Run backend tests whose fixture graph does not require PostgreSQL
	$(PYTEST) -m "not integration"

.PHONY: test-backend-sales
test-backend-sales:  ## Run the sales/payments/returns/tickets domain with fail-fast
	$(PYTEST) -x $(SALES_TESTS)

.PHONY: test-backend-pricing
test-backend-pricing:  ## Run the pricing domain with fail-fast
	$(PYTEST) -x $(PRICING_TESTS)

.PHONY: test-backend-inventory
test-backend-inventory:  ## Run inventory/lots/receiving tests with fail-fast
	$(PYTEST) -x $(INVENTORY_TESTS)

.PHONY: test-backend-reports
test-backend-reports:  ## Run reports/Z-closes/rendering tests with fail-fast
	$(PYTEST) -x $(REPORTS_TESTS)

.PHONY: test-backend-migrations-fast
test-backend-migrations-fast:  ## Check migration head/model consistency without historical round trips
	$(PYTEST) -x tests/test_migrations.py \
		-k "database_is_at_head or exactly_one_head or models_and_migrations"

.PHONY: test-backend-migrations
test-backend-migrations:  ## Run every migration and historical-fixture test
	$(PYTEST) tests/test_migrations.py

.PHONY: test
test: test-backend test-frontend  ## Run backend and frontend unit/integration tests

.PHONY: test-backend
test-backend:  ## pytest against a real PostgreSQL
	$(PYTEST)

.PHONY: test-frontend
test-frontend:  ## Vitest + React Testing Library
	cd $(FRONTEND) && npm run test

.PHONY: test-frontend-fast
test-frontend-fast:  ## Run explicit Vitest files: make test-frontend-fast TESTS="src/features/pos/Cart.test.tsx"
	@if [ -z "$(strip $(TESTS))" ]; then \
		echo 'ERROR: TESTS is required; test-frontend-fast never falls back to the full suite.' >&2; \
		exit 2; \
	fi
	cd $(FRONTEND) && npm run test -- $(TESTS)

.PHONY: test-e2e
test-e2e:  ## Playwright end-to-end suite (boots API + frontend)
	npm run test:e2e

.PHONY: test-e2e-spec
test-e2e-spec:  ## Run one Playwright spec: make test-e2e-spec SPEC=tests/e2e/specs/pos.sale.spec.ts
	@if [ -z "$(strip $(SPEC))" ]; then \
		echo 'ERROR: SPEC is required; test-e2e-spec never falls back to the full suite.' >&2; \
		exit 2; \
	fi
	npm run test:e2e -- $(SPEC)

.PHONY: test-e2e-flow
test-e2e-flow:  ## Run Playwright tests matching a title: make test-e2e-flow FLOW="cash sale"
	@if [ -z "$(strip $(FLOW))" ]; then \
		echo 'ERROR: FLOW is required; test-e2e-flow never falls back to the full suite.' >&2; \
		exit 2; \
	fi
	npm run test:e2e -- --grep "$(FLOW)"

.PHONY: install-e2e
install-e2e:  ## Install Playwright and its browser
	npm install && npx playwright install --with-deps chromium

.PHONY: build
build:  ## Production build of the frontend
	cd $(FRONTEND) && npm run build

.PHONY: check
check: lint test build  ## Everything CI runs, except E2E

.PHONY: test-full
test-full: check test-e2e  ## Release gate: lint, all unit/integration tests, build and E2E

# --- production deployment (docs/ADMIN_GUIDE.md) ----------------------------

PROD_COMPOSE := docker compose -f docker/compose.prod.yml --env-file .env.production

.PHONY: prod-cert
prod-cert:  ## Generate the internal TLS cert: make prod-cert host=openerp.miempresa.local
	./scripts/gen-internal-cert.sh $(host)

.PHONY: prod-build
prod-build:  ## Build the production images (backend + frontend)
	$(PROD_COMPOSE) build

.PHONY: prod-up
prod-up:  ## Start (or update) the production stack
	$(PROD_COMPOSE) up -d --wait

.PHONY: prod-down
prod-down:  ## Stop the production stack (keeps the database volume)
	$(PROD_COMPOSE) down

.PHONY: prod-restart
prod-restart:  ## Restart just the API and worker (e.g. after editing .env.production)
	$(PROD_COMPOSE) up -d --force-recreate api worker

.PHONY: prod-logs
prod-logs:  ## Follow logs of every production service
	$(PROD_COMPOSE) logs -f

.PHONY: prod-ps
prod-ps:  ## Show the status of every production service
	$(PROD_COMPOSE) ps

.PHONY: prod-migrate
prod-migrate:  ## Apply pending migrations against the production database
	$(PROD_COMPOSE) run --rm migrate

.PHONY: prod-bootstrap-admin
prod-bootstrap-admin:  ## Create the first admin user in production (interactive)
	$(PROD_COMPOSE) run --rm api uv run python -m app.auth.bootstrap

.PHONY: prod-backup
prod-backup:  ## Back up the production database (needs pg_dump on the host PATH)
	OPENERP_DATABASE_URL="$$(grep -m1 '^OPENERP_DATABASE_URL=' .env.production | cut -d= -f2- | sed 's/@postgres:/@127.0.0.1:/')" \
	  ./scripts/backup-postgres.sh

.PHONY: prod-deploy
prod-deploy:  ## Pull the latest code and redeploy: make prod-deploy [force=1] [backup=1]
	./scripts/deploy-update.sh $(if $(force),--force) $(if $(backup),--backup)
