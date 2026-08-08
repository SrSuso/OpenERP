"""The outbox (phase 18): queue in the same transaction as the business
event (rule 10), send for real through Mailpit, verified via Mailpit's own
REST API — same "don't mock the real infrastructure" reasoning as every
other integration test in this suite, just for SMTP instead of Postgres.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.jobs import service as outbox

MAILPIT_API = "http://127.0.0.1:8025/api/v1"


def _unique_email() -> str:
    return f"test-{uuid.uuid4().hex[:12]}@example.invalid"


async def _mailpit_messages_to(to_email: str) -> list[dict[str, Any]]:
    async with httpx.AsyncClient() as http:
        response = await http.get(f"{MAILPIT_API}/search", params={"query": f"to:{to_email}"})
        response.raise_for_status()
        result: list[dict[str, Any]] = response.json()["messages"]
        return result


@pytest.fixture(autouse=True)
async def _clear_mailpit() -> None:
    async with httpx.AsyncClient() as http:
        await http.delete(f"{MAILPIT_API}/messages")


async def test_enqueue_email_inserts_a_pending_message(db_session: AsyncSession) -> None:
    to_email = _unique_email()

    message = await outbox.enqueue_email(
        db_session, to_email=to_email, subject="Hola", body_text="Cuerpo"
    )

    assert message.id is not None
    assert message.status == "PENDING"
    assert message.attempts == 0
    assert message.to_email == to_email


async def test_claim_batch_only_returns_pending_messages(db_session: AsyncSession) -> None:
    pending = await outbox.enqueue_email(
        db_session, to_email=_unique_email(), subject="x", body_text="x"
    )
    sent = await outbox.enqueue_email(
        db_session, to_email=_unique_email(), subject="x", body_text="x"
    )
    await outbox.mark_sent(db_session, sent)

    claimed = await outbox.claim_batch(db_session, limit=50)

    claimed_ids = {m.id for m in claimed}
    assert pending.id in claimed_ids
    assert sent.id not in claimed_ids


async def test_claim_batch_respects_the_limit(db_session: AsyncSession) -> None:
    for _ in range(3):
        await outbox.enqueue_email(db_session, to_email=_unique_email(), subject="x", body_text="x")

    claimed = await outbox.claim_batch(db_session, limit=2)

    assert len(claimed) == 2


async def test_mark_sent_records_when_and_increments_attempts(db_session: AsyncSession) -> None:
    message = await outbox.enqueue_email(
        db_session, to_email=_unique_email(), subject="x", body_text="x"
    )

    await outbox.mark_sent(db_session, message)

    assert message.status == "SENT"
    assert message.sent_at is not None
    assert message.attempts == 1


async def test_mark_failed_retries_until_the_attempt_cap_then_gives_up(
    db_session: AsyncSession,
) -> None:
    message = await outbox.enqueue_email(
        db_session, to_email=_unique_email(), subject="x", body_text="x"
    )

    for _ in range(outbox.MAX_ATTEMPTS - 1):
        await outbox.mark_failed(db_session, message, "boom")
        assert message.status == "PENDING"

    await outbox.mark_failed(db_session, message, "boom")

    assert message.status == "FAILED"
    assert message.attempts == outbox.MAX_ATTEMPTS
    assert message.last_error == "boom"


async def test_process_batch_actually_sends_through_mailpit(
    db_session: AsyncSession, settings: Settings
) -> None:
    to_email = _unique_email()
    message = await outbox.enqueue_email(
        db_session, to_email=to_email, subject="Asunto de prueba", body_text="Cuerpo de prueba"
    )

    processed = await outbox.process_batch(db_session, settings)

    assert processed == 1
    assert message.status == "SENT"

    delivered = await _mailpit_messages_to(to_email)
    assert len(delivered) == 1
    assert delivered[0]["Subject"] == "Asunto de prueba"


async def test_process_batch_marks_failed_on_a_real_smtp_error(
    db_session: AsyncSession, settings: Settings
) -> None:
    unreachable = settings.model_copy(update={"smtp_port": 1})
    message = await outbox.enqueue_email(
        db_session, to_email=_unique_email(), subject="x", body_text="x"
    )

    await outbox.process_batch(db_session, unreachable)

    assert message.status == "PENDING"
    assert message.attempts == 1
    assert message.last_error is not None


async def test_admin_can_list_and_run_the_outbox(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    await login(role_name="ADMIN")
    to_email = _unique_email()

    # No HTTP endpoint creates a message directly (phase 17's notifications
    # is the only producer today) — enqueue through the same `db_session`
    # the `client` fixture's requests run against, then drive it via the API.
    await outbox.enqueue_email(db_session, to_email=to_email, subject="Vía API", body_text="x")

    listed = (await client.get("/api/v1/outbox", params={"status": "PENDING"})).json()
    assert any(m["to_email"] == to_email for m in listed)

    run_response = await client.post("/api/v1/outbox/run")
    assert run_response.status_code == 200
    assert run_response.json()["processed"] >= 1

    delivered = await _mailpit_messages_to(to_email)
    assert len(delivered) == 1


async def test_cashier_cannot_read_or_run_the_outbox(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")

    assert (await client.get("/api/v1/outbox")).status_code == 403
    assert (await client.post("/api/v1/outbox/run")).status_code == 403


async def test_unauthenticated_is_401(client: AsyncClient) -> None:
    response = await client.get("/api/v1/outbox")

    assert response.status_code == 401
