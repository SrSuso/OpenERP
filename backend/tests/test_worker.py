"""app.jobs.worker: the actual process loop, exercised with real commits
against the test's own throwaway database (``committing_sessionmaker``,
the same fixture the other real-concurrency tests use) — not the global
``session_scope``, which would otherwise point at whatever database this
process's own environment happens to be configured with."""

from __future__ import annotations

import uuid

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.jobs import service as outbox
from app.jobs import worker
from app.jobs.models import OutboxMessage

MAILPIT_API = "http://127.0.0.1:8025/api/v1"


def _unique_email() -> str:
    return f"worker-{uuid.uuid4().hex[:12]}@example.invalid"


@pytest.fixture(autouse=True)
async def _clear_mailpit() -> None:
    async with httpx.AsyncClient() as http:
        await http.delete(f"{MAILPIT_API}/messages")


async def test_run_once_sends_a_queued_message_for_real(
    settings: Settings, committing_sessionmaker: async_sessionmaker[AsyncSession]
) -> None:
    to_email = _unique_email()
    async with committing_sessionmaker() as session:
        message = await outbox.enqueue_email(
            session, to_email=to_email, subject="Worker test", body_text="x"
        )
        await session.commit()
        message_id = message.id

    processed = await worker.run_once(settings, session_factory=committing_sessionmaker)

    assert processed >= 1
    async with httpx.AsyncClient() as http:
        search = await http.get(f"{MAILPIT_API}/search", params={"query": f"to:{to_email}"})
    assert len(search.json()["messages"]) == 1

    async with committing_sessionmaker() as session:
        refreshed = await session.get(OutboxMessage, message_id)
        assert refreshed is not None
        assert refreshed.status == "SENT"


async def test_run_forever_stops_after_the_given_iterations(
    settings: Settings, committing_sessionmaker: async_sessionmaker[AsyncSession]
) -> None:
    # Nothing queued: each iteration processes zero messages, so this only
    # has to prove the loop actually terminates at `iterations` instead of
    # running forever — the real failure mode this guards against is an
    # off-by-one that never exits.
    await worker.run_forever(
        iterations=2, poll_interval_seconds=0, session_factory=committing_sessionmaker
    )


async def test_notification_evaluation_has_an_independent_cadence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    notification_calls = 0
    outbox_calls = 0

    async def fake_notifications(_settings: Settings, **_kwargs: object) -> int:
        nonlocal notification_calls
        notification_calls += 1
        return 0

    async def fake_outbox(_settings: Settings, **_kwargs: object) -> int:
        nonlocal outbox_calls
        outbox_calls += 1
        return 1

    monkeypatch.setattr(worker, "run_notification_evaluation_once", fake_notifications)
    monkeypatch.setattr(worker, "run_once", fake_outbox)
    times = iter([0.0, 30.0, 60.0, 90.0])

    await worker.run_forever(
        iterations=4,
        notification_interval_seconds=60,
        monotonic=lambda: next(times),
    )

    assert notification_calls == 2
    assert outbox_calls == 4


async def test_notification_failure_does_not_stop_outbox_or_the_next_evaluation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    notification_calls = 0
    outbox_calls = 0

    async def flaky_notifications(_settings: Settings, **_kwargs: object) -> int:
        nonlocal notification_calls
        notification_calls += 1
        if notification_calls == 1:
            raise RuntimeError("temporary evaluation failure")
        return 0

    async def fake_outbox(_settings: Settings, **_kwargs: object) -> int:
        nonlocal outbox_calls
        outbox_calls += 1
        return 1

    monkeypatch.setattr(worker, "run_notification_evaluation_once", flaky_notifications)
    monkeypatch.setattr(worker, "run_once", fake_outbox)
    times = iter([0.0, 60.0])

    await worker.run_forever(
        iterations=2,
        notification_interval_seconds=60,
        monotonic=lambda: next(times),
    )

    assert notification_calls == 2
    assert outbox_calls == 2
