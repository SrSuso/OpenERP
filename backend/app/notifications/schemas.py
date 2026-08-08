"""Pydantic schemas for notification rules and incidents."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, model_validator
from pydantic import ValidationError as PydanticValidationError

from app.notifications.rules import RuleType, validate_params


class NotificationRuleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    rule_type: RuleType
    params: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _params_must_fit_the_rule_type(self) -> NotificationRuleCreate:
        try:
            validate_params(self.rule_type, self.params)
        except PydanticValidationError as exc:
            raise ValueError(f"params does not fit rule_type {self.rule_type!r}: {exc}") from exc
        return self


class NotificationRuleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    params: dict[str, Any] | None = None
    is_active: bool | None = None


class NotificationRuleRead(BaseModel):
    id: int
    name: str
    rule_type: RuleType
    params: dict[str, Any]
    is_active: bool


class IncidentRead(BaseModel):
    id: int
    rule_id: int
    rule_name: str
    subject_type: str
    subject_id: int
    message: str
    status: str
    first_detected_at: datetime
    last_seen_at: datetime
    resolved_at: datetime | None
