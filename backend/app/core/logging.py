"""Structured logging.

Emits one JSON object per line so logs stay machine-parseable in any
environment.  ``log_format=console`` gives a human-readable form for local
development.

Extra fields are attached with the standard ``extra=`` kwarg::

    logger.info("sale.completed", extra={"sale_id": 42, "total": "19.90"})
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any

from app.core.context import get_client_ip, get_request_id, get_user_id

# Attributes present on every LogRecord; anything else was passed via `extra=`.
_RESERVED = frozenset(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {
    "message",
    "asctime",
    "taskName",
}


def _record_extras(record: logging.LogRecord) -> dict[str, Any]:
    return {k: v for k, v in record.__dict__.items() if k not in _RESERVED}


class JsonFormatter(logging.Formatter):
    """Render a log record as a single-line JSON document."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        if (request_id := get_request_id()) is not None:
            payload["request_id"] = request_id
        if (client_ip := get_client_ip()) is not None:
            payload["client_ip"] = client_ip
        if (user_id := get_user_id()) is not None:
            payload["user_id"] = user_id

        payload.update(_record_extras(record))

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        if record.stack_info:
            payload["stack"] = self.formatStack(record.stack_info)

        return json.dumps(payload, default=str, ensure_ascii=False)


class ConsoleFormatter(logging.Formatter):
    """Compact, readable output for a developer terminal."""

    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.fromtimestamp(record.created, tz=UTC).strftime("%H:%M:%S")
        rid = get_request_id()
        prefix = f"{ts} {record.levelname:<7} {record.name}"
        if rid:
            prefix += f" [{rid[:8]}]"
        line = f"{prefix} :: {record.getMessage()}"
        if extras := _record_extras(record):
            line += " " + " ".join(f"{k}={v}" for k, v in sorted(extras.items()))
        if record.exc_info:
            line += "\n" + self.formatException(record.exc_info)
        return line


def configure_logging(*, level: str = "INFO", fmt: str = "json") -> None:
    """Install the root handler.  Idempotent — safe to call more than once."""
    formatter: logging.Formatter = JsonFormatter() if fmt == "json" else ConsoleFormatter()

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root = logging.getLogger()
    for existing in list(root.handlers):
        root.removeHandler(existing)
    root.addHandler(handler)
    root.setLevel(level)

    # uvicorn installs its own colourised handlers; route them through ours so
    # every line in the process has the same shape.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True

    # SQLAlchemy engine logging is controlled by settings.db_echo, not level.
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
