"""Structured logging output."""

from __future__ import annotations

import json
import logging

import pytest

from app.core.context import request_context, set_user_id
from app.core.logging import ConsoleFormatter, JsonFormatter


def _record(message: str = "sale.completed", **extra: object) -> logging.LogRecord:
    record = logging.LogRecord(
        name="app.sales",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg=message,
        args=None,
        exc_info=None,
    )
    for key, value in extra.items():
        setattr(record, key, value)
    return record


def test_json_line_carries_the_core_fields() -> None:
    payload = json.loads(JsonFormatter().format(_record()))

    assert payload["level"] == "INFO"
    assert payload["logger"] == "app.sales"
    assert payload["message"] == "sale.completed"
    assert payload["timestamp"].endswith("+00:00")


def test_extra_fields_are_promoted_to_top_level_keys() -> None:
    payload = json.loads(JsonFormatter().format(_record(sale_id=42, total="19.90")))

    assert payload["sale_id"] == 42
    assert payload["total"] == "19.90"


def test_request_context_is_attached_automatically() -> None:
    with request_context(request_id="abc123", client_ip="10.0.0.7"):
        set_user_id(9)
        payload = json.loads(JsonFormatter().format(_record()))

    assert payload["request_id"] == "abc123"
    assert payload["client_ip"] == "10.0.0.7"
    assert payload["user_id"] == 9


def test_no_request_context_means_no_empty_keys() -> None:
    payload = json.loads(JsonFormatter().format(_record()))

    assert "request_id" not in payload
    assert "user_id" not in payload


def test_output_is_one_line_per_record() -> None:
    line = JsonFormatter().format(_record("multi\nline\nmessage"))

    assert "\n" not in line
    assert json.loads(line)["message"] == "multi\nline\nmessage"


def test_non_serialisable_values_do_not_break_the_line() -> None:
    payload = json.loads(JsonFormatter().format(_record(obj=object())))

    assert payload["obj"].startswith("<object object")


def test_console_formatter_is_readable() -> None:
    with request_context(request_id="deadbeefcafe"):
        line = ConsoleFormatter().format(_record(sale_id=42))

    assert "app.sales" in line
    assert "sale.completed" in line
    assert "sale_id=42" in line
    assert "[deadbeef]" in line


@pytest.mark.parametrize("formatter", [JsonFormatter(), ConsoleFormatter()])
def test_exceptions_are_rendered(formatter: logging.Formatter) -> None:
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        record = _record("oops")
        record.exc_info = sys.exc_info()
        output = formatter.format(record)

    assert "ValueError: boom" in output
