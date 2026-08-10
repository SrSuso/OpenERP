"""System settings (phase 21): admin-editable SMTP overrides on top of the
environment configuration — `settings.read`/`settings.manage`, ADMIN only.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.jobs import service as outbox

MAILPIT_API = "http://127.0.0.1:8025/api/v1"


def _unique_email() -> str:
    return f"settings-test-{uuid.uuid4().hex[:12]}@example.invalid"


@pytest.fixture(autouse=True)
async def _clear_mailpit() -> None:
    async with httpx.AsyncClient() as http:
        await http.delete(f"{MAILPIT_API}/messages")


async def _mailpit_messages_to(to_email: str) -> list[dict[str, Any]]:
    async with httpx.AsyncClient() as http:
        response = await http.get(f"{MAILPIT_API}/search", params={"query": f"to:{to_email}"})
        response.raise_for_status()
        result: list[dict[str, Any]] = response.json()["messages"]
        return result


async def test_admin_reads_environment_defaults_when_nothing_overridden(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.get("/api/v1/settings/smtp")

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "smtp_host": "127.0.0.1",
        "smtp_port": 1025,
        "smtp_use_tls": False,
        "smtp_username": None,
        "smtp_password_set": False,
        "smtp_from_email": "no-reply@openerp.local",
        "notification_recipient_email": None,
        "updated_at": None,
    }


async def test_admin_can_partially_update_smtp_settings(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.put(
        "/api/v1/settings/smtp",
        json={"smtp_host": "smtp.example.com", "smtp_port": 587, "smtp_use_tls": True},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["smtp_host"] == "smtp.example.com"
    assert body["smtp_port"] == 587
    assert body["smtp_use_tls"] is True
    # Untouched fields keep the environment's default — a partial update
    # never blanks out what wasn't sent.
    assert body["smtp_from_email"] == "no-reply@openerp.local"
    assert body["updated_at"] is not None

    # A second, unrelated partial update leaves the first one alone.
    second = await client.put(
        "/api/v1/settings/smtp", json={"smtp_from_email": "tienda@example.com"}
    )
    second_body = second.json()
    assert second_body["smtp_host"] == "smtp.example.com"
    assert second_body["smtp_from_email"] == "tienda@example.com"


async def test_password_is_stored_but_never_read_back(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.put("/api/v1/settings/smtp", json={"smtp_password": "s3cret"})

    assert response.status_code == 200
    body = response.json()
    assert "smtp_password" not in body
    assert body["smtp_password_set"] is True

    read_back = (await client.get("/api/v1/settings/smtp")).json()
    assert "smtp_password" not in read_back
    assert read_back["smtp_password_set"] is True


async def test_empty_string_clears_an_override_back_to_the_environment_default(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    await client.put("/api/v1/settings/smtp", json={"smtp_host": "smtp.example.com"})

    response = await client.put("/api/v1/settings/smtp", json={"smtp_host": ""})

    assert response.json()["smtp_host"] == "127.0.0.1"


async def test_saved_override_is_actually_used_by_the_outbox_worker(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    """Not just persisted — wired: pointing the override at an unreachable
    port must make the very next `/outbox/run` fail, proving
    `app.jobs.router` reads the DB override rather than the untouched
    environment settings (which point at a working Mailpit)."""
    await login(role_name="ADMIN")
    await client.put("/api/v1/settings/smtp", json={"smtp_port": 1})

    message = await outbox.enqueue_email(
        db_session, to_email=_unique_email(), subject="x", body_text="x"
    )

    run_response = await client.post("/api/v1/outbox/run")

    assert run_response.status_code == 200
    assert message.status == "PENDING"
    assert message.last_error is not None


async def test_smtp_test_endpoint_sends_a_real_email_through_mailpit(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    to_email = _unique_email()

    response = await client.post("/api/v1/settings/smtp/test", json={"to_email": to_email})

    assert response.status_code == 204
    delivered = await _mailpit_messages_to(to_email)
    assert len(delivered) == 1
    assert delivered[0]["Subject"] == "OpenERP: correo de prueba"


async def test_smtp_test_endpoint_reports_a_bad_host_as_a_validation_error(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.post(
        "/api/v1/settings/smtp/test",
        json={"to_email": _unique_email(), "smtp_port": 1},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


async def test_manager_cannot_read_or_write_settings(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="MANAGER")

    assert (await client.get("/api/v1/settings/smtp")).status_code == 403
    assert (await client.put("/api/v1/settings/smtp", json={"smtp_host": "x"})).status_code == 403


async def test_cashier_cannot_read_or_write_settings(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")

    assert (await client.get("/api/v1/settings/smtp")).status_code == 403
    assert (await client.put("/api/v1/settings/smtp", json={"smtp_host": "x"})).status_code == 403


async def test_unauthenticated_is_401(client: AsyncClient) -> None:
    response = await client.get("/api/v1/settings/smtp")

    assert response.status_code == 401
