"""Pydantic schemas for the outbox."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class OutboxMessageRead(BaseModel):
    id: int
    to_email: str
    subject: str
    body_text: str
    status: str
    attempts: int
    last_error: str | None
    sent_at: datetime | None
    reference_type: str | None
    reference_id: int | None
    created_at: datetime


class ProcessOutboxResult(BaseModel):
    processed: int
