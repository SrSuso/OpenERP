# Production image for the API and the outbox worker (same image, two
# different `command:` overrides in docker/compose.prod.yml) and for the
# one-shot `migrate` service that runs Alembic before either starts.
#
# Multi-stage: the `builder` stage has uv and resolves the locked
# dependency set into a venv; the final stage copies only that venv plus
# the application code, so the runtime image never carries uv's own
# download cache or the wheel build backends.

FROM python:3.13-slim AS builder

# Pinned uv binary, not `pip install uv` — keeps the resolver itself
# reproducible across builds.
COPY --from=ghcr.io/astral-sh/uv:0.6.5 /uv /uvx /usr/local/bin/

WORKDIR /app

# Dependencies first so this layer is cached across app-code-only changes.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./alembic.ini
RUN uv sync --frozen --no-dev

FROM python:3.13-slim AS runtime

RUN groupadd --system openerp && useradd --system --gid openerp --create-home openerp

WORKDIR /app
COPY --from=builder --chown=openerp:openerp /app /app
COPY --from=ghcr.io/astral-sh/uv:0.6.5 /uv /uvx /usr/local/bin/

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    UV_NO_SYNC=1

USER openerp
EXPOSE 8000

# Liveness probe hits the app itself — no `curl`/`wget` in python:slim, so
# this uses the stdlib instead of adding a package just for the healthcheck.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health/live', timeout=2)" || exit 1

# Overridden per service in docker/compose.prod.yml: the API runs uvicorn,
# the worker runs `python -m app.jobs.worker`, `migrate` runs `alembic
# upgrade head`. This default is just "run the API" for `docker run`.
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-proxy-headers"]
