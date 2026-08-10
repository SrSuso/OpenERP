"""Pydantic schemas for notification rules and incidents."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, model_validator
from pydantic import ValidationError as PydanticValidationError

from app.notifications.conditions import SUBJECTS, FieldType, Operator
from app.notifications.rules import RuleType, Severity, validate_params


class NotificationRuleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    rule_type: RuleType
    params: dict[str, Any] = Field(default_factory=dict)
    severity: Severity = Severity.MEDIUM_LOW

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
    severity: Severity | None = None
    is_active: bool | None = None


class NotificationRuleRead(BaseModel):
    id: int
    name: str
    rule_type: RuleType
    params: dict[str, Any]
    severity: Severity
    is_active: bool


class IncidentRead(BaseModel):
    id: int
    rule_id: int
    rule_name: str
    #: Copiada de la regla al leer — el panel la usa para el color y el
    #: parpadeo, sin tener que cruzar con la lista de reglas.
    severity: Severity
    subject_type: str
    subject_id: int
    message: str
    status: str
    first_detected_at: datetime
    last_seen_at: datetime
    resolved_at: datetime | None


# --- catálogo para el constructor de reglas -------------------------------


class ConditionFieldRead(BaseModel):
    key: str
    label: str
    type: FieldType
    help: str


class ConditionSubjectRead(BaseModel):
    key: str
    label: str
    fields: list[ConditionFieldRead]


class ConditionCatalogueRead(BaseModel):
    """Todo lo que el panel necesita para ofrecer el constructor sin saber
    nada de negocio: sobre qué se puede escribir una regla, qué campos
    tiene cada sujeto y qué comparadores se admiten."""

    subjects: list[ConditionSubjectRead]
    operators: list[str]
    severities: list[str]


def condition_catalogue() -> ConditionCatalogueRead:
    return ConditionCatalogueRead(
        subjects=[
            ConditionSubjectRead(
                key=key,
                label=subject.label,
                fields=[
                    ConditionFieldRead(
                        key=field_key, label=field.label, type=field.type, help=field.help
                    )
                    for field_key, field in subject.fields.items()
                ],
            )
            for key, subject in SUBJECTS.items()
        ],
        operators=[o.value for o in Operator],
        severities=[s.value for s in Severity],
    )
