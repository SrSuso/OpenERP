"""Outbox CRUD and the claim/send/mark cycle shared by
``app.jobs.worker`` and the manual ``POST /outbox/run`` endpoint."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.jobs import mailer
from app.jobs.models import OutboxMessage

#: A message that keeps failing stops retrying after this many attempts and
#: is left `FAILED` for a human to look at — not silently dropped, not
#: retried forever.
MAX_ATTEMPTS = 5


async def enqueue_email(
    session: AsyncSession,
    *,
    to_email: str,
    subject: str,
    body_text: str,
    reference_type: str | None = None,
    reference_id: int | None = None,
) -> OutboxMessage:
    """Just an INSERT — the caller's own transaction is what makes this
    atomic with whatever business event produced it (rule 5's philosophy,
    applied to rule 10: SMTP itself is never on the critical path)."""
    message = OutboxMessage(
        to_email=to_email,
        subject=subject,
        body_text=body_text,
        reference_type=reference_type,
        reference_id=reference_id,
    )
    session.add(message)
    await session.flush()
    return message


async def list_messages(
    session: AsyncSession, *, status: str | None = None, limit: int = 100, offset: int = 0
) -> list[OutboxMessage]:
    stmt = (
        select(OutboxMessage)
        .order_by(OutboxMessage.created_at.desc(), OutboxMessage.id.desc())
        .limit(limit)
        .offset(offset)
    )
    if status is not None:
        stmt = stmt.where(OutboxMessage.status == status)
    return list((await session.execute(stmt)).scalars())


async def claim_batch(session: AsyncSession, *, limit: int = 20) -> list[OutboxMessage]:
    """Lock up to `limit` PENDING messages for this worker alone.
    ``SKIP LOCKED`` is what lets more than one worker process run at once
    without two of them ever sending the same message — each just skips
    whatever another worker already has locked, instead of blocking on it.
    """
    stmt = (
        select(OutboxMessage)
        .where(OutboxMessage.status == "PENDING")
        .order_by(OutboxMessage.created_at)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    return list((await session.execute(stmt)).scalars())


async def mark_sent(session: AsyncSession, message: OutboxMessage) -> None:
    message.status = "SENT"
    message.sent_at = datetime.now(UTC)
    message.attempts += 1
    await session.flush()


async def mark_failed(session: AsyncSession, message: OutboxMessage, error: str) -> None:
    message.attempts += 1
    message.last_error = error[:2000]
    message.status = "FAILED" if message.attempts >= MAX_ATTEMPTS else "PENDING"
    await session.flush()


async def process_batch(session: AsyncSession, settings: Settings, *, limit: int = 20) -> int:
    """Claim a batch and try to send each one — the one function both the
    worker's poll loop and the manual debug endpoint call, so there is
    exactly one place that decides what "processing the outbox" means."""
    messages = await claim_batch(session, limit=limit)
    for message in messages:
        try:
            await asyncio.to_thread(
                mailer.send_email,
                settings,
                to_email=message.to_email,
                subject=message.subject,
                body_text=message.body_text,
            )
        except Exception as exc:  # any SMTP failure (timeout, refused, ...) is a retry candidate
            await mark_failed(session, message, str(exc))
        else:
            await mark_sent(session, message)
    return len(messages)
