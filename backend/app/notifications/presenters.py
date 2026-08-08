"""ORM -> response-schema conversion for ``app.notifications.router``."""

from __future__ import annotations

from app.notifications.models import Incident, NotificationRule
from app.notifications.rules import RuleType
from app.notifications.schemas import IncidentRead, NotificationRuleRead


def rule_to_read(rule: NotificationRule) -> NotificationRuleRead:
    return NotificationRuleRead(
        id=rule.id,
        name=rule.name,
        rule_type=RuleType(rule.rule_type),
        params=rule.params,
        is_active=rule.is_active,
    )


def incident_to_read(incident: Incident) -> IncidentRead:
    return IncidentRead(
        id=incident.id,
        rule_id=incident.rule_id,
        rule_name=incident.rule.name,
        subject_type=incident.subject_type,
        subject_id=incident.subject_id,
        message=incident.message,
        status=incident.status,
        first_detected_at=incident.first_detected_at,
        last_seen_at=incident.last_seen_at,
        resolved_at=incident.resolved_at,
    )
