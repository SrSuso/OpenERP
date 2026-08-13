"""The background worker: polls the outbox, sends what's due, forever.

    uv run python -m app.jobs.worker

A separate OS process from the API — this is what actually turns queued
``OutboxMessage`` rows into SMTP deliveries. Safe to run more than one
instance of at once (``claim_batch``'s ``SKIP LOCKED``); safe to stop and
restart at any point (every commit is a real one, nothing in-flight is
held in memory across polls).
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.session import session_scope
from app.jobs import service

logger = logging.getLogger("app.jobs.worker")

#: How often to poll when the last batch was empty. A busy outbox is
#: drained immediately (the loop only sleeps after an empty batch), so
#: this is a ceiling on latency, not a fixed cadence.
DEFAULT_POLL_INTERVAL_SECONDS = 5.0

SessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]


async def run_once(
    settings: Settings, *, limit: int = 20, session_factory: SessionFactory | None = None
) -> int:
    """``session_factory`` defaults to the app's own real database
    (``session_scope``, the same one every request/script uses) — tests
    override it with a sessionmaker bound to their own throwaway database,
    exactly like ``committing_sessionmaker`` already does for the other
    real-concurrency tests in this suite."""
    scope: SessionFactory = session_factory or session_scope
    async with scope() as session:
        processed = await service.process_batch(session, settings, limit=limit)
        # Explicit, rather than relying on the context manager's own exit
        # behaviour: `session_scope` (production) already commits on a
        # clean exit, but a plain sessionmaker session (as tests pass via
        # `session_factory`) does not — this makes the commit unconditional
        # either way, instead of depending on which one is in play.
        await session.commit()
        return processed


async def run_forever(
    *,
    poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS,
    iterations: int | None = None,
    session_factory: SessionFactory | None = None,
) -> None:
    """``iterations``/``session_factory`` are only for tests — production
    always passes neither, and this simply never returns."""
    settings = get_settings()
    count = 0
    while iterations is None or count < iterations:
        try:
            processed = await run_once(settings, session_factory=session_factory)
            if processed:
                logger.info("outbox: sent %d message(s)", processed)
        except Exception:
            logger.exception("outbox: batch failed, will retry next poll")
            processed = 0
        count += 1
        if (iterations is None or count < iterations) and processed == 0:
            await asyncio.sleep(poll_interval_seconds)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    logger.info("outbox worker starting (poll every %ss)", DEFAULT_POLL_INTERVAL_SECONDS)
    asyncio.run(run_forever())


if __name__ == "__main__":
    main()
