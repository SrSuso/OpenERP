"""Rule CRUD and evaluation — see ``app.notifications.models`` for the
deduplication contract this enforces."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import service as audit
from app.core.errors import NotFoundError
from app.notifications import rules as rule_engine
from app.notifications.models import Incident, NotificationRule
from app.notifications.schemas import NotificationRuleCreate, NotificationRuleUpdate

# --- rules ---------------------------------------------------------------------


async def list_rules(session: AsyncSession, *, active_only: bool = False) -> list[NotificationRule]:
    stmt = select(NotificationRule).order_by(NotificationRule.name)
    if active_only:
        stmt = stmt.where(NotificationRule.is_active.is_(True))
    return list((await session.execute(stmt)).scalars())


async def get_rule(session: AsyncSession, rule_id: int) -> NotificationRule:
    rule = await session.get(NotificationRule, rule_id)
    if rule is None:
        raise NotFoundError(f"Notification rule {rule_id} not found.")
    return rule


async def create_rule(session: AsyncSession, payload: NotificationRuleCreate) -> NotificationRule:
    rule = NotificationRule(name=payload.name, rule_type=payload.rule_type, params=payload.params)
    session.add(rule)
    await session.flush()
    await audit.record(
        session,
        action="created",
        entity_type="notification_rule",
        entity_id=rule.id,
        after={"name": rule.name, "rule_type": rule.rule_type},
    )
    return rule


async def update_rule(
    session: AsyncSession, rule_id: int, payload: NotificationRuleUpdate
) -> NotificationRule:
    rule = await get_rule(session, rule_id)
    before = {"name": rule.name, "params": rule.params, "is_active": rule.is_active}

    if payload.name is not None:
        rule.name = payload.name
    if payload.params is not None:
        # Re-validate against this rule's own type — an update can't sneak
        # params that fit a different rule_type past the whitelist either.
        rule_engine.validate_params(rule_engine.RuleType(rule.rule_type), payload.params)
        rule.params = payload.params
    if payload.is_active is not None:
        rule.is_active = payload.is_active

    await session.flush()
    await audit.record(
        session,
        action="updated",
        entity_type="notification_rule",
        entity_id=rule.id,
        before=before,
        after={"name": rule.name, "params": rule.params, "is_active": rule.is_active},
    )
    return rule


# --- incidents -------------------------------------------------------------------

_INCIDENT_OPTIONS = (selectinload(Incident.rule),)


async def list_incidents(
    session: AsyncSession, *, status: str | None = None, rule_id: int | None = None
) -> list[Incident]:
    stmt = select(Incident).options(*_INCIDENT_OPTIONS).order_by(Incident.last_seen_at.desc())
    if status is not None:
        stmt = stmt.where(Incident.status == status)
    if rule_id is not None:
        stmt = stmt.where(Incident.rule_id == rule_id)
    return list((await session.execute(stmt)).scalars())


async def get_incident(session: AsyncSession, incident_id: int) -> Incident:
    stmt = select(Incident).where(Incident.id == incident_id).options(*_INCIDENT_OPTIONS)
    incident = (await session.execute(stmt)).scalar_one_or_none()
    if incident is None:
        raise NotFoundError(f"Incident {incident_id} not found.")
    return incident


async def resolve_incident(session: AsyncSession, incident_id: int) -> Incident:
    incident = await get_incident(session, incident_id)
    if incident.status == "OPEN":
        incident.status = "RESOLVED"
        incident.resolved_at = datetime.now(UTC)
        await session.flush()
        await audit.record(
            session,
            action="resolved",
            entity_type="incident",
            entity_id=incident.id,
            after={"status": incident.status},
        )
    return incident


# --- evaluation --------------------------------------------------------------------


async def evaluate_rules(session: AsyncSession) -> list[Incident]:
    """Run every active rule's detector, open/refresh an incident per
    subject it still finds, and auto-resolve any open incident whose
    subject no longer matches. Idempotent to call repeatedly (this is
    exactly what phase 18's scheduled worker will do) — a subject already
    open just gets its `last_seen_at` touched, never a duplicate row."""
    now = datetime.now(UTC)
    touched: list[Incident] = []

    for rule in await list_rules(session, active_only=True):
        detections = await rule_engine.detect(
            session, rule_engine.RuleType(rule.rule_type), rule.params
        )
        detected_keys = {(d.subject_type, d.subject_id) for d in detections}

        open_stmt = select(Incident).where(Incident.rule_id == rule.id, Incident.status == "OPEN")
        open_incidents = list((await session.execute(open_stmt)).scalars())
        open_by_key = {(i.subject_type, i.subject_id): i for i in open_incidents}

        # `open_incidents` came from a plain select(), so `.rule` isn't
        # eager-loaded on any of them — assign it from what we already
        # hold rather than let the presenter's `incident.rule.name` trigger
        # a lazy load outside this request's async context (MissingGreenlet).
        for incident in open_incidents:
            incident.rule = rule
            if (incident.subject_type, incident.subject_id) not in detected_keys:
                incident.status = "RESOLVED"
                incident.resolved_at = now
                touched.append(incident)

        for detection in detections:
            existing = open_by_key.get((detection.subject_type, detection.subject_id))
            if existing is not None:
                existing.last_seen_at = now
                existing.message = detection.message
                touched.append(existing)
            else:
                incident = Incident(
                    rule_id=rule.id,
                    subject_type=detection.subject_type,
                    subject_id=detection.subject_id,
                    message=detection.message,
                    status="OPEN",
                    first_detected_at=now,
                    last_seen_at=now,
                )
                incident.rule = rule
                session.add(incident)
                touched.append(incident)

    await session.flush()
    if touched:
        await audit.record(
            session,
            action="evaluated",
            entity_type="notification_rules",
            entity_id=None,
            after={"incidents_touched": len(touched)},
        )
    return touched
