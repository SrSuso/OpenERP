"""ORM -> response-schema conversion for ``app.jobs.router``."""

from __future__ import annotations

from app.jobs.models import OutboxMessage
from app.jobs.schemas import OutboxMessageRead


def message_to_read(message: OutboxMessage) -> OutboxMessageRead:
    return OutboxMessageRead(
        id=message.id,
        to_email=message.to_email,
        subject=message.subject,
        body_text=message.body_text,
        status=message.status,
        attempts=message.attempts,
        last_error=message.last_error,
        sent_at=message.sent_at,
        reference_type=message.reference_type,
        reference_id=message.reference_id,
        created_at=message.created_at,
    )
