"""Transactional claim/replay logic shared by idempotent operations.

The unique insert is the lock: concurrent requests for the same
``operation + key`` serialize in PostgreSQL. The record and the business
operation commit together, so no visible record can claim success before
the business transaction itself is durable.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError
from app.idempotency.models import IdempotencyRecord


@dataclass(frozen=True)
class IdempotencyClaim:
    record: IdempotencyRecord
    is_new: bool


async def claim(
    session: AsyncSession,
    *,
    operation: str,
    idempotency_key: str,
    request_fingerprint: str,
    resource_id: int,
    actor_user_id: int,
) -> IdempotencyClaim:
    """Own a new key or return its already-committed result metadata.

    ``ON CONFLICT DO NOTHING`` waits for a concurrent speculative insert.
    If that transaction commits, this request reads its completed record;
    if it rolls back, PostgreSQL lets this request insert and become owner.
    No expected race escapes as ``IntegrityError``.
    """
    statement = (
        pg_insert(IdempotencyRecord)
        .values(
            operation=operation,
            idempotency_key=idempotency_key,
            request_fingerprint=request_fingerprint,
            resource_id=resource_id,
            actor_user_id=actor_user_id,
        )
        .on_conflict_do_nothing(constraint="uq_idempotency_records_operation_key")
        .returning(IdempotencyRecord.id)
    )
    inserted_id = (await session.execute(statement)).scalar_one_or_none()
    if inserted_id is not None:
        record = await session.get(IdempotencyRecord, inserted_id)
        assert record is not None
        return IdempotencyClaim(record=record, is_new=True)

    record = (
        await session.execute(
            select(IdempotencyRecord).where(
                IdempotencyRecord.operation == operation,
                IdempotencyRecord.idempotency_key == idempotency_key,
            )
        )
    ).scalar_one()

    # Do not reveal which aggregate or user already owns a guessed key.
    if record.actor_user_id != actor_user_id or record.resource_id != resource_id:
        raise ConflictError("Idempotency key is already in use for another operation.")
    if record.request_fingerprint != request_fingerprint:
        raise ConflictError("Idempotency key was already used with a different request.")
    if record.completed_at is None:
        # Not normally observable: owner and checkout use one transaction.
        # Keep a safe response if a row was inserted manually or by old code.
        raise ConflictError("The idempotent operation has not completed.")
    return IdempotencyClaim(record=record, is_new=False)


async def complete(
    session: AsyncSession,
    record: IdempotencyRecord,
    *,
    result_resource_id: int | None = None,
) -> None:
    record.result_resource_id = result_resource_id
    record.completed_at = datetime.now(UTC)
    await session.flush()
