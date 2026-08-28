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
	tests/test_return_quantities_refunds.py \
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
db-restore:  ## Restore into a new DB: make db-restore f=backups/... target=openerp_restore_...
	@test -n "$(f)" -a -n "$(target)" || (echo 'ERROR: f and target are required' >&2; exit 2)
	./scripts/restore-postgres.sh "$(f)" --target-database "$(target)"

# --- auth --------------------------------------------------------------

.PHONY: bootstrap-admin
bootstrap-admin:  ## Create the first admin user (interactive)
	cd $(BACKEND) && uv run python -m app.auth.bootstrap

.PHONY: seed-e2e
seed-e2e:  ## Seed the fixed admin/cashier accounts the Playwright suite logs in as
	cd $(BACKEND) && uv run python -m scripts.seed_e2e_users

.PHONY: seed-e2e-catalog
seed-e2e-catalog:  ## Seed the E2E terminal and minimal POS catalog/stock
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

.PHONY: check-test-mailpit
check-test-mailpit:  ## Fail explicitly when the real SMTP integration dependency is unavailable
	@curl --fail --silent --show-error --max-time 3 http://127.0.0.1:8025/api/v1/info >/dev/null || { \
		echo 'ERROR: Mailpit HTTP API is required on 127.0.0.1:8025 for backend tests.' >&2; \
		exit 1; \
	}
	@cd $(BACKEND) && uv run python -c "import socket; socket.create_connection(('127.0.0.1', 1025), 3).close()" || { \
		echo 'ERROR: Mailpit SMTP is required on 127.0.0.1:1025 for backend tests.' >&2; \
		exit 1; \
	}

.PHONY: test-backend
test-backend: check-test-mailpit  ## pytest against a real PostgreSQL and Mailpit
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
prod-build:  ## Build production images, refreshing their pinned base tags
	$(PROD_COMPOSE) build --pull

.PHONY: prod-build-clean
prod-build-clean:  ## Diagnostic/release build without cached layers
	$(PROD_COMPOSE) build --pull --no-cache

.PHONY: prod-preserve-current-images
prod-preserve-current-images:  ## Retag running images with the previous immutable version
	./scripts/preserve-production-images.sh "$(OPENERP_PREVIOUS_VERSION)"

.PHONY: prod-validate-web-config
prod-validate-web-config:  ## Validate target nginx config before maintenance downtime
	$(PROD_COMPOSE) exec -T web nginx -t

.PHONY: prod-validate-api-config
prod-validate-api-config:  ## Validate target production settings before maintenance downtime
	$(PROD_COMPOSE) run --rm --no-deps api uv run python -c \
	  'from app.core.config import get_settings; get_settings().validate_runtime()'

.PHONY: prod-preflight
prod-preflight:  ## Validate production config/tools and free space without touching PostgreSQL
	@command -v docker >/dev/null || (echo 'ERROR: docker not found' >&2; exit 2)
	@docker compose version >/dev/null || (echo 'ERROR: Docker Compose plugin unavailable' >&2; exit 2)
	@for tool in pg_dump pg_restore psql sha256sum; do command -v $$tool >/dev/null || { echo "ERROR: $$tool not found" >&2; exit 2; }; done
	@test -r .env.production || (echo 'ERROR: .env.production is missing' >&2; exit 2)
	@test -r deploy/certs/fullchain.pem -a -r deploy/certs/privkey.pem || (echo 'ERROR: production TLS certificates are missing' >&2; exit 2)
	@$(PROD_COMPOSE) config --quiet
	@minimum_kb="$${OPENERP_DEPLOY_MIN_FREE_KB:-1048576}"; docker_root="$$(docker info --format '{{.DockerRootDir}}')"; \
	  for target in . backups "$$docker_root"; do \
	    test -n "$$target" -a -e "$$target" || continue; \
	    available_kb="$$(df -Pk "$$target" | awk 'NR == 2 {print $$4}')"; \
	    test "$$available_kb" -ge "$$minimum_kb" || { echo "ERROR: insufficient free disk space at $$target ($$available_kb KiB)" >&2; exit 2; }; \
	  done

.PHONY: prod-up
prod-up: prod-writers-stopped  ## Initial/start-from-offline stack startup; not an update path
	$(PROD_COMPOSE) up -d --wait --remove-orphans

.PHONY: prod-down
prod-down:  ## Stop the production stack (keeps the database volume)
	$(PROD_COMPOSE) down

.PHONY: prod-restart
prod-restart:  ## Restart just the API and worker (e.g. after editing .env.production)
	$(PROD_COMPOSE) up -d --force-recreate --remove-orphans api worker

.PHONY: prod-logs
prod-logs:  ## Follow logs of every production service
	$(PROD_COMPOSE) logs -f

.PHONY: prod-ps
prod-ps:  ## Show the status of every production service
	$(PROD_COMPOSE) ps

.PHONY: prod-migrate
prod-migrate: prod-writers-stopped  ## Apply migrations only while API/worker are verified stopped
	$(PROD_COMPOSE) run --rm migrate

.PHONY: prod-migration-check
prod-migration-check:  ## Assert the production DB revision equals the target image head
	@$(PROD_COMPOSE) run --rm --no-deps migrate uv run alembic current | grep -q '(head)' \
	  || (echo 'ERROR: production database is not at Alembic head' >&2; exit 2)

.PHONY: prod-stop-writers
prod-stop-writers:  ## Stop API and outbox worker while leaving PostgreSQL/web available
	$(PROD_COMPOSE) stop api worker

.PHONY: prod-start-maintenance-web
prod-start-maintenance-web:  ## Recreate nginx with the host maintenance flag already enabled
	$(PROD_COMPOSE) up -d --no-deps --wait --remove-orphans web

.PHONY: prod-writers-stopped
prod-writers-stopped:  ## Assert no production API/worker container remains running
	@for service in api worker; do \
	  container="$$( $(PROD_COMPOSE) ps -aq $$service )"; \
	  test -z "$$container" && continue; \
	  state="$$(docker inspect --format '{{.State.Running}} {{.State.Restarting}}' $$container)"; \
	  test "$$state" = 'false false' || { echo "ERROR: database writer $$service is still active ($$state)" >&2; exit 2; }; \
	done

.PHONY: prod-start-api-web
prod-start-api-web:  ## Recreate target API/web while public maintenance remains enabled
	$(PROD_COMPOSE) up -d --no-deps --remove-orphans api web

.PHONY: prod-wait-api
prod-wait-api:  ## Wait for target API and web healthchecks
	$(PROD_COMPOSE) up -d --no-deps --wait --remove-orphans api web

.PHONY: prod-smoke
prod-smoke:  ## Non-mutating API/database/web smoke checks
	./scripts/smoke-production.sh

.PHONY: prod-start-worker
prod-start-worker:  ## Start worker only after migration and API smoke checks
	$(PROD_COMPOSE) up -d --no-deps --remove-orphans worker

.PHONY: prod-worker-check
prod-worker-check:  ## Confirm the worker remains running after startup
	@for attempt in $$(seq 1 15); do \
	  if $(PROD_COMPOSE) ps --status running --services worker | grep -qx worker; then \
	    sleep 3; \
	    $(PROD_COMPOSE) ps --status running --services worker | grep -qx worker && exit 0; \
	  fi; \
	  sleep 2; \
	done; echo 'ERROR: worker did not remain running' >&2; $(PROD_COMPOSE) logs --tail=50 worker >&2; exit 2

.PHONY: prod-bootstrap-admin
prod-bootstrap-admin:  ## Create the first admin user in production (interactive)
	$(PROD_COMPOSE) run --rm api uv run python -m app.auth.bootstrap

.PHONY: prod-backup
prod-backup:  ## Back up the production database (needs pg_dump on the host PATH)
	./scripts/production-database.sh backup

.PHONY: prod-restore
prod-restore: prod-writers-stopped  ## Restore into a new DB only: make prod-restore f=... target=...
	@test -n "$(f)" -a -n "$(target)" || (echo 'ERROR: f and target are required' >&2; exit 2)
	./scripts/production-database.sh restore "$(f)" --target-database "$(target)"

.PHONY: prod-deploy
prod-deploy:  ## Safe deploy: make prod-deploy [branch=<remote-branch>] [force=1]
	./scripts/deploy-update.sh $(if $(branch),--branch "$(branch)") $(if $(force),--force)
