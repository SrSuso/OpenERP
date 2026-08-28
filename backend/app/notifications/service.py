"""Rule CRUD and evaluation — see ``app.notifications.models`` for the
deduplication contract this enforces."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import service as audit
from app.catalog.models import Product
from app.core.business_time import business_today
from app.core.config import Settings
from app.core.errors import NotFoundError, ValidationError
from app.inventory.models import StockBalance
from app.jobs import service as outbox
from app.lots.models import Lot
from app.notifications import rules as rule_engine
from app.notifications.models import Incident, NotificationRule
from app.notifications.schemas import (
    ActiveAlertRead,
    CustomRuleSummaryRead,
    ExpirationGeneralRead,
    ExpirationGeneralUpdate,
    NotificationRuleCreate,
    NotificationRuleUpdate,
    NotificationSettingsRead,
    ProductExpirationRead,
    ProductExpirationUpdate,
)
from app.settings import store as settings_store
from app.settings.business_time import get_business_timezone

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
    params = dict(payload.params)
    # `notifications.default_expiration_days` (app.settings.registry): la
    # antelación que la tienda quiere por defecto. Sólo se aplica si quien
    # crea la regla no ha dicho la suya — cada regla puede llevar otra.
    if payload.rule_type == rule_engine.RuleType.EXPIRING_LOT and (
        "days_before_expiration" not in params
    ):
        params["days_before_expiration"] = await settings_store.get_value(
            session, "notifications.default_expiration_days"
        )
        rule_engine.validate_params(rule_engine.RuleType(payload.rule_type), params)

    rule = NotificationRule(
        name=payload.name,
        rule_type=payload.rule_type,
        params=params,
        severity=payload.severity,
    )
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
    if payload.severity is not None:
        rule.severity = payload.severity
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


# --- configuración V2 ---------------------------------------------------------


def _is_managed_low_stock(rule: NotificationRule) -> bool:
    return rule.rule_type == rule_engine.RuleType.LOW_STOCK and rule.params.get("automatic") is True


def _is_managed_expiration(rule: NotificationRule) -> bool:
    return (
        rule.rule_type == rule_engine.RuleType.EXPIRING_LOT and rule.params.get("managed") is True
    )


def _expiration_product_id(rule: NotificationRule) -> int | None:
    value = rule.params.get("product_id")
    return value if isinstance(value, int) and value > 0 else None


def _choose_rule(candidates: list[NotificationRule]) -> NotificationRule | None:
    """A managed V2 setting always wins, including when disabled.

    Otherwise the oldest active legacy rule is adopted as the effective
    configuration. This preserves useful pre-V2 data while ensuring that two
    old general rules cannot produce the same lot alert twice.
    """
    managed = sorted(
        (rule for rule in candidates if _is_managed_expiration(rule)), key=lambda r: r.id
    )
    if managed:
        return managed[0]
    active = sorted((rule for rule in candidates if rule.is_active), key=lambda r: r.id)
    return active[0] if active else None


def _select_low_stock_rule(rules: list[NotificationRule]) -> NotificationRule | None:
    managed = sorted((rule for rule in rules if _is_managed_low_stock(rule)), key=lambda r: r.id)
    if managed:
        return managed[0]
    active_legacy = sorted(
        (
            rule
            for rule in rules
            if rule.rule_type == rule_engine.RuleType.LOW_STOCK and rule.is_active
        ),
        key=lambda r: r.id,
    )
    return active_legacy[0] if active_legacy else None


def _select_expiration_rules(
    rules: list[NotificationRule],
) -> tuple[NotificationRule | None, dict[int, NotificationRule]]:
    expiration_rules = [
        rule for rule in rules if rule.rule_type == rule_engine.RuleType.EXPIRING_LOT
    ]
    general = _choose_rule(
        [rule for rule in expiration_rules if _expiration_product_id(rule) is None]
    )
    by_product: defaultdict[int, list[NotificationRule]] = defaultdict(list)
    for rule in expiration_rules:
        product_id = _expiration_product_id(rule)
        if product_id is not None:
            by_product[product_id].append(rule)
    specific = {
        product_id: selected
        for product_id, candidates in by_product.items()
        if (selected := _choose_rule(candidates)) is not None
    }
    return general, specific


async def get_notification_settings(session: AsyncSession) -> NotificationSettingsRead:
    rules = await list_rules(session)
    low_stock = _select_low_stock_rule(rules)
    general, specific = _select_expiration_rules(rules)
    default_days = int(
        await settings_store.get_value(session, "notifications.default_expiration_days")
    )
    general_params = (
        rule_engine.ExpiringLotParams.model_validate(general.params) if general else None
    )

    active_specific = {product_id: rule for product_id, rule in specific.items() if rule.is_active}
    product_names: dict[int, str] = {}
    if active_specific:
        rows = await session.execute(
            select(Product.id, Product.name).where(Product.id.in_(active_specific))
        )
        product_names = {row.id: row.name for row in rows.all()}

    selected_ids = {
        *(rule.id for rule in active_specific.values()),
        *((general.id,) if general else ()),
        *((low_stock.id,) if low_stock else ()),
    }
    custom_rules = [
        CustomRuleSummaryRead(name=rule.name, is_active=rule.is_active)
        for rule in rules
        if rule.id not in selected_ids
        and not _is_managed_low_stock(rule)
        and not _is_managed_expiration(rule)
    ]

    return NotificationSettingsRead(
        general_expiration=ExpirationGeneralRead(
            enabled=general.is_active if general else False,
            days_before_expiration=(
                general_params.days_before_expiration if general_params else default_days
            ),
        ),
        product_expirations=sorted(
            (
                ProductExpirationRead(
                    product_id=product_id,
                    product_name=product_names[product_id],
                    days_before_expiration=rule_engine.ExpiringLotParams.model_validate(
                        rule.params
                    ).days_before_expiration,
                )
                for product_id, rule in active_specific.items()
                if product_id in product_names
            ),
            key=lambda item: item.product_name.casefold(),
        ),
        custom_rules=sorted(custom_rules, key=lambda item: item.name.casefold()),
    )


async def update_general_expiration(
    session: AsyncSession, payload: ExpirationGeneralUpdate
) -> NotificationSettingsRead:
    rules = await list_rules(session)
    general, _ = _select_expiration_rules(rules)
    params = {
        "days_before_expiration": payload.days_before_expiration,
        "product_id": None,
        "managed": True,
    }
    if general is None:
        general = await create_rule(
            session,
            NotificationRuleCreate(
                name="Caducidad general",
                rule_type=rule_engine.RuleType.EXPIRING_LOT,
                params=params,
                severity=rule_engine.Severity.MEDIUM_HIGH,
            ),
        )
        if not payload.enabled:
            await update_rule(session, general.id, NotificationRuleUpdate(is_active=False))
    else:
        await update_rule(
            session,
            general.id,
            NotificationRuleUpdate(params=params, is_active=payload.enabled),
        )
    return await get_notification_settings(session)


async def update_product_expiration(
    session: AsyncSession, product_id: int, payload: ProductExpirationUpdate
) -> NotificationSettingsRead:
    product = await session.get(Product, product_id)
    if product is None or not product.is_active:
        raise NotFoundError(f"Product {product_id} not found.")
    if not product.track_expiration:
        raise ValidationError("El producto no tiene activado el control de caducidad.")

    rules = await list_rules(session)
    _, specific = _select_expiration_rules(rules)
    existing = specific.get(product_id)
    params = {
        "days_before_expiration": payload.days_before_expiration,
        "product_id": product_id,
        "managed": True,
    }
    if existing is None:
        await create_rule(
            session,
            NotificationRuleCreate(
                name=f"Caducidad de {product.name}",
                rule_type=rule_engine.RuleType.EXPIRING_LOT,
                params=params,
                severity=rule_engine.Severity.MEDIUM_HIGH,
            ),
        )
    else:
        await update_rule(
            session,
            existing.id,
            NotificationRuleUpdate(params=params, is_active=True),
        )
    return await get_notification_settings(session)


async def remove_product_expiration(
    session: AsyncSession, product_id: int
) -> NotificationSettingsRead:
    _, specific = _select_expiration_rules(await list_rules(session))
    existing = specific.get(product_id)
    if existing is None:
        raise NotFoundError(f"Expiration setting for product {product_id} not found.")
    await update_rule(session, existing.id, NotificationRuleUpdate(is_active=False))
    return await get_notification_settings(session)


# --- incidents -------------------------------------------------------------------

_INCIDENT_OPTIONS = (selectinload(Incident.rule),)


async def list_incidents(
    session: AsyncSession,
    *,
    status: str | None = None,
    rule_id: int | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[Incident]:
    stmt = (
        select(Incident)
        .options(*_INCIDENT_OPTIONS)
        .order_by(Incident.last_seen_at.desc(), Incident.id.desc())
        .limit(limit)
        .offset(offset)
    )
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


async def list_active_alerts(session: AsyncSession) -> list[ActiveAlertRead]:
    """Present open incidents with the current business data operators need.

    Incident messages remain stored for history and email compatibility. The
    V2 UI does not parse those strings: stock, minimums, lot dates and
    remaining quantities come from typed fields calculated here.
    """
    incidents = await list_incidents(session, status="OPEN", limit=500)
    product_ids = {
        incident.subject_id
        for incident in incidents
        if incident.rule.rule_type == rule_engine.RuleType.LOW_STOCK
        and incident.subject_type == "product"
    }
    lot_ids = {
        incident.subject_id
        for incident in incidents
        if incident.rule.rule_type == rule_engine.RuleType.EXPIRING_LOT
        and incident.subject_type == "lot"
    }

    product_data: dict[int, tuple[str, Decimal, Decimal]] = {}
    if product_ids:
        stock = func.coalesce(func.sum(StockBalance.quantity), 0)
        rows = await session.execute(
            select(Product.id, Product.name, Product.min_stock, stock.label("stock"))
            .outerjoin(StockBalance, StockBalance.product_id == Product.id)
            .where(Product.id.in_(product_ids))
            .group_by(Product.id, Product.name, Product.min_stock)
        )
        product_data = {row.id: (row.name, row.stock, row.min_stock) for row in rows.all()}

    lot_data: dict[int, tuple[int, str, str, date | None, Decimal]] = {}
    if lot_ids:
        lot_quantity_expr = func.coalesce(func.sum(StockBalance.quantity), 0)
        rows = await session.execute(
            select(
                Lot.id,
                Lot.product_id,
                Product.name.label("product_name"),
                Lot.lot_number,
                Lot.expiration_date,
                lot_quantity_expr.label("quantity"),
            )
            .join(Product, Product.id == Lot.product_id)
            .outerjoin(StockBalance, StockBalance.lot_id == Lot.id)
            .where(Lot.id.in_(lot_ids))
            .group_by(
                Lot.id,
                Lot.product_id,
                Product.name,
                Lot.lot_number,
                Lot.expiration_date,
            )
        )
        lot_data = {
            row.id: (
                row.product_id,
                row.product_name,
                row.lot_number,
                row.expiration_date,
                row.quantity,
            )
            for row in rows.all()
        }

    today = business_today(await get_business_timezone(session))
    alerts: list[ActiveAlertRead] = []
    for incident in incidents:
        severity = rule_engine.Severity(incident.rule.severity)
        rule_type = rule_engine.RuleType(incident.rule.rule_type)
        if rule_type == rule_engine.RuleType.LOW_STOCK and incident.subject_id in product_data:
            name, current, minimum = product_data[incident.subject_id]
            alerts.append(
                ActiveAlertRead(
                    id=incident.id,
                    kind="LOW_STOCK",
                    title=name,
                    severity=severity,
                    product_id=incident.subject_id,
                    stock_current=current,
                    min_stock=minimum,
                    replenish=max(minimum - current, Decimal(0)),
                )
            )
        elif rule_type == rule_engine.RuleType.EXPIRING_LOT and incident.subject_id in lot_data:
            product_id, name, lot_number, expiration_date, quantity_remaining = lot_data[
                incident.subject_id
            ]
            alerts.append(
                ActiveAlertRead(
                    id=incident.id,
                    kind="EXPIRATION",
                    title=name,
                    severity=severity,
                    product_id=product_id,
                    lot_id=incident.subject_id,
                    lot_number=lot_number,
                    expiration_date=expiration_date,
                    days_remaining=(expiration_date - today).days if expiration_date else None,
                    quantity_remaining=quantity_remaining,
                )
            )
        else:
            alerts.append(
                ActiveAlertRead(
                    id=incident.id,
                    kind="OTHER",
                    title=incident.rule.name,
                    message=incident.message,
                    severity=severity,
                )
            )
    return alerts


# --- evaluation --------------------------------------------------------------------


async def _ensure_automatic_low_stock_rule(
    session: AsyncSession, rules: list[NotificationRule]
) -> NotificationRule:
    selected = _select_low_stock_rule(rules)
    if selected is None:
        selected = await create_rule(
            session,
            NotificationRuleCreate(
                name="Stock mínimo automático",
                rule_type=rule_engine.RuleType.LOW_STOCK,
                params={"automatic": True, "warehouse_id": None},
                severity=rule_engine.Severity.MEDIUM_HIGH,
            ),
        )
        rules.append(selected)
    elif _is_managed_low_stock(selected) and not selected.is_active:
        await update_rule(session, selected.id, NotificationRuleUpdate(is_active=True))
    return selected


async def evaluate_rules(session: AsyncSession, settings: Settings) -> list[Incident]:
    """Run every active rule's detector, open/refresh an incident per
    subject it still finds, and auto-resolve any open incident whose
    subject no longer matches. Idempotent to call repeatedly (this is
    exactly what phase 18's scheduled worker will do) — a subject already
    open just gets its `last_seen_at` touched, never a duplicate row.

    A brand-new incident also queues an email (phase 18) to
    ``settings.notification_recipient_email``, if one is configured — never
    for an incident that was already open, so a recipient gets exactly one
    email per incident, not one per evaluation cycle."""
    now = datetime.now(UTC)
    touched: list[Incident] = []
    new_incidents: list[Incident] = []
    recipient = settings.notification_recipient_email
    # `notifications.email_subject_prefix` (app.settings.registry) — la
    # etiqueta con la que llegan los avisos al correo del dueño.
    subject_prefix = str(
        await settings_store.get_value(session, "notifications.email_subject_prefix")
    )
    today = business_today(await get_business_timezone(session), now=now)

    rules = await list_rules(session)
    low_stock_rule = await _ensure_automatic_low_stock_rule(session, rules)
    general_expiration, specific_expirations = _select_expiration_rules(rules)
    active_specific_ids = frozenset(
        product_id for product_id, rule in specific_expirations.items() if rule.is_active
    )
    selected_expiration_ids = {rule.id for rule in specific_expirations.values() if rule.is_active}
    if general_expiration is not None and general_expiration.is_active:
        selected_expiration_ids.add(general_expiration.id)

    for rule in rules:
        rule_type = rule_engine.RuleType(rule.rule_type)
        should_evaluate = (
            rule.id == low_stock_rule.id
            or (rule_type == rule_engine.RuleType.CONDITION and rule.is_active)
            or (
                rule_type == rule_engine.RuleType.EXPIRING_LOT
                and rule.id in selected_expiration_ids
            )
        )
        if should_evaluate:
            raw_params = (
                {"automatic": True, "warehouse_id": None}
                if rule.id == low_stock_rule.id
                else rule.params
            )
            detections = await rule_engine.detect(
                session,
                rule_type,
                raw_params,
                today=today,
                excluded_product_ids=(
                    active_specific_ids if rule is general_expiration else frozenset()
                ),
            )
        else:
            # Inactive and superseded legacy rules retain their stored
            # configuration for compatibility but cannot leave stale or
            # duplicated open alerts behind.
            detections = []
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
                new_incidents.append(incident)

    await session.flush()  # assigns real ids to new_incidents before we reference them below

    if recipient:
        for incident in new_incidents:
            await outbox.enqueue_email(
                session,
                to_email=recipient,
                subject=f"{subject_prefix} {incident.rule.name}".strip(),
                body_text=incident.message,
                reference_type="incident",
                reference_id=incident.id,
            )

    if touched:
        await audit.record(
            session,
            action="evaluated",
            entity_type="notification_rules",
            entity_id=None,
            after={"incidents_touched": len(touched)},
        )
    return touched
