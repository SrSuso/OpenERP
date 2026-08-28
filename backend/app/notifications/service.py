"""Internal alert settings, evaluation, deduplication and presentation."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import service as audit
from app.catalog.models import Product, StockAlertMode
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
    ExpirationGeneralRead,
    ExpirationGeneralUpdate,
    NotificationSettingsRead,
    ProductExpirationRead,
    ProductExpirationUpdate,
    StockGeneralRead,
    StockGeneralUpdate,
)
from app.settings import store as settings_store
from app.settings.business_time import get_business_timezone

DEFAULT_EXPIRATION_DAYS = 7
DEFAULT_STOCK_MINIMUM = Decimal(0)
STOCK_RULE_NAME = "Avisos de stock"
EXPIRATION_RULE_NAME = "Caducidad general"


async def _list_rules(session: AsyncSession) -> list[NotificationRule]:
    return list(
        (await session.execute(select(NotificationRule).order_by(NotificationRule.id))).scalars()
    )


async def _create_rule(
    session: AsyncSession,
    *,
    name: str,
    rule_type: rule_engine.RuleType,
    params: dict[str, object],
    is_active: bool = True,
) -> NotificationRule:
    rule_engine.validate_params(rule_type, params)
    rule = NotificationRule(
        name=name,
        rule_type=rule_type,
        params=params,
        severity="MEDIUM_HIGH",
        is_active=is_active,
    )
    session.add(rule)
    await session.flush()
    await audit.record(
        session,
        action="created",
        entity_type="notification_setting",
        entity_id=rule.id,
        after={"kind": rule.rule_type},
    )
    return rule


async def _update_rule(
    session: AsyncSession,
    rule: NotificationRule,
    *,
    params: dict[str, object],
    is_active: bool,
) -> None:
    rule_engine.validate_params(rule_engine.RuleType(rule.rule_type), params)
    before = {"params": rule.params, "is_active": rule.is_active}
    rule.params = params
    rule.is_active = is_active
    await session.flush()
    await audit.record(
        session,
        action="updated",
        entity_type="notification_setting",
        entity_id=rule.id,
        before=before,
        after={"params": params, "is_active": is_active},
    )


def _is_managed_low_stock(rule: NotificationRule) -> bool:
    return rule.rule_type == rule_engine.RuleType.LOW_STOCK and rule.params.get("automatic") is True


def _is_managed_expiration(rule: NotificationRule) -> bool:
    return (
        rule.rule_type == rule_engine.RuleType.EXPIRING_LOT and rule.params.get("managed") is True
    )


def _expiration_product_id(rule: NotificationRule) -> int | None:
    value = rule.params.get("product_id")
    return value if isinstance(value, int) and value > 0 else None


def _select_low_stock_rule(rules: list[NotificationRule]) -> NotificationRule | None:
    return next((rule for rule in rules if _is_managed_low_stock(rule)), None)


def _select_expiration_rules(
    rules: list[NotificationRule],
) -> tuple[NotificationRule | None, dict[int, NotificationRule]]:
    managed = [rule for rule in rules if _is_managed_expiration(rule)]
    general = next((rule for rule in managed if _expiration_product_id(rule) is None), None)
    by_product: defaultdict[int, list[NotificationRule]] = defaultdict(list)
    for rule in managed:
        product_id = _expiration_product_id(rule)
        if product_id is not None:
            by_product[product_id].append(rule)
    return general, {product_id: candidates[0] for product_id, candidates in by_product.items()}


def _stock_params(rule: NotificationRule | None) -> rule_engine.LowStockParams:
    if rule is None:
        return rule_engine.LowStockParams(enabled=False, min_stock=DEFAULT_STOCK_MINIMUM)
    return rule_engine.LowStockParams.model_validate(rule.params)


async def get_notification_settings(session: AsyncSession) -> NotificationSettingsRead:
    rules = await _list_rules(session)
    stock = _stock_params(_select_low_stock_rule(rules))
    general, specific = _select_expiration_rules(rules)
    general_params = (
        rule_engine.ExpiringLotParams.model_validate(general.params) if general else None
    )

    active_specific = {product_id: rule for product_id, rule in specific.items() if rule.is_active}
    product_names: dict[int, str] = {}
    if active_specific:
        rows = await session.execute(
            select(Product.id, Product.name).where(
                Product.id.in_(active_specific),
                Product.is_active.is_(True),
                Product.track_expiration.is_(True),
            )
        )
        product_names = {row.id: row.name for row in rows.all()}

    return NotificationSettingsRead(
        stock_general=StockGeneralRead(enabled=stock.enabled, min_stock=stock.min_stock),
        general_expiration=ExpirationGeneralRead(
            enabled=general.is_active if general else False,
            days_before_expiration=(
                general_params.days_before_expiration if general_params else DEFAULT_EXPIRATION_DAYS
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
    )


async def update_general_stock(
    session: AsyncSession, payload: StockGeneralUpdate
) -> NotificationSettingsRead:
    rules = await _list_rules(session)
    existing = _select_low_stock_rule(rules)
    params: dict[str, object] = {
        "automatic": True,
        "warehouse_id": None,
        "enabled": payload.enabled,
        "min_stock": str(payload.min_stock),
    }
    if existing is None:
        await _create_rule(
            session,
            name=STOCK_RULE_NAME,
            rule_type=rule_engine.RuleType.LOW_STOCK,
            params=params,
        )
    else:
        await _update_rule(session, existing, params=params, is_active=True)
    return await get_notification_settings(session)


async def update_general_expiration(
    session: AsyncSession, payload: ExpirationGeneralUpdate
) -> NotificationSettingsRead:
    rules = await _list_rules(session)
    general, _ = _select_expiration_rules(rules)
    params: dict[str, object] = {
        "days_before_expiration": payload.days_before_expiration,
        "product_id": None,
        "managed": True,
    }
    if general is None:
        await _create_rule(
            session,
            name=EXPIRATION_RULE_NAME,
            rule_type=rule_engine.RuleType.EXPIRING_LOT,
            params=params,
            is_active=payload.enabled,
        )
    else:
        await _update_rule(session, general, params=params, is_active=payload.enabled)
    return await get_notification_settings(session)


async def update_product_expiration(
    session: AsyncSession, product_id: int, payload: ProductExpirationUpdate
) -> NotificationSettingsRead:
    product = await session.get(Product, product_id)
    if product is None or not product.is_active:
        raise NotFoundError(f"Product {product_id} not found.")
    if not product.track_expiration:
        raise ValidationError("El producto no tiene activado el control de caducidad.")

    rules = await _list_rules(session)
    _, specific = _select_expiration_rules(rules)
    existing = specific.get(product_id)
    params: dict[str, object] = {
        "days_before_expiration": payload.days_before_expiration,
        "product_id": product_id,
        "managed": True,
    }
    if existing is None:
        await _create_rule(
            session,
            name=f"Caducidad de {product.name}",
            rule_type=rule_engine.RuleType.EXPIRING_LOT,
            params=params,
        )
    else:
        await _update_rule(session, existing, params=params, is_active=True)
    return await get_notification_settings(session)


async def remove_product_expiration(
    session: AsyncSession, product_id: int
) -> NotificationSettingsRead:
    _, specific = _select_expiration_rules(await _list_rules(session))
    existing = specific.get(product_id)
    if existing is None:
        raise NotFoundError(f"Expiration setting for product {product_id} not found.")
    await _update_rule(session, existing, params=existing.params, is_active=False)
    return await get_notification_settings(session)


async def _list_open_incidents(session: AsyncSession) -> list[Incident]:
    return list(
        (
            await session.execute(
                select(Incident)
                .where(Incident.status == "OPEN")
                .options(selectinload(Incident.rule))
                .order_by(Incident.last_seen_at.desc(), Incident.id.desc())
                .limit(500)
            )
        ).scalars()
    )


async def list_active_alerts(session: AsyncSession) -> list[ActiveAlertRead]:
    incidents = await _list_open_incidents(session)
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

    rules = await _list_rules(session)
    stock_settings = _stock_params(_select_low_stock_rule(rules))
    product_data: dict[int, tuple[str, Decimal, Decimal]] = {}
    if product_ids:
        stock = func.coalesce(func.sum(StockBalance.quantity), 0)
        rows = await session.execute(
            select(
                Product.id,
                Product.name,
                Product.stock_alert_mode,
                Product.min_stock,
                stock.label("stock"),
            )
            .outerjoin(StockBalance, StockBalance.product_id == Product.id)
            .where(Product.id.in_(product_ids))
            .group_by(
                Product.id,
                Product.name,
                Product.stock_alert_mode,
                Product.min_stock,
            )
        )
        product_data = {
            row.id: (
                row.name,
                row.stock,
                row.min_stock
                if row.stock_alert_mode == StockAlertMode.CUSTOM
                else stock_settings.min_stock,
            )
            for row in rows.all()
        }

    lot_data: dict[int, tuple[int, str, str, date | None, Decimal]] = {}
    if lot_ids:
        quantity = func.coalesce(func.sum(StockBalance.quantity), 0)
        rows = await session.execute(
            select(
                Lot.id,
                Lot.product_id,
                Product.name.label("product_name"),
                Lot.lot_number,
                Lot.expiration_date,
                quantity.label("quantity"),
            )
            .join(Product, Product.id == Lot.product_id)
            .outerjoin(StockBalance, StockBalance.lot_id == Lot.id)
            .where(Lot.id.in_(lot_ids))
            .group_by(Lot.id, Lot.product_id, Product.name, Lot.lot_number, Lot.expiration_date)
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
        if (
            incident.rule.rule_type == rule_engine.RuleType.LOW_STOCK
            and incident.subject_id in product_data
        ):
            name, current, minimum = product_data[incident.subject_id]
            alerts.append(
                ActiveAlertRead(
                    id=incident.id,
                    kind="LOW_STOCK",
                    title=name,
                    product_id=incident.subject_id,
                    stock_current=current,
                    min_stock=minimum,
                    replenish=max(minimum - current, Decimal(0)),
                )
            )
        elif (
            incident.rule.rule_type == rule_engine.RuleType.EXPIRING_LOT
            and incident.subject_id in lot_data
        ):
            product_id, name, lot_number, expiration_date, quantity_remaining = lot_data[
                incident.subject_id
            ]
            alerts.append(
                ActiveAlertRead(
                    id=incident.id,
                    kind="EXPIRATION",
                    title=name,
                    product_id=product_id,
                    lot_id=incident.subject_id,
                    lot_number=lot_number,
                    expiration_date=expiration_date,
                    days_remaining=(expiration_date - today).days if expiration_date else None,
                    quantity_remaining=quantity_remaining,
                )
            )
    return alerts


async def _ensure_stock_rule(
    session: AsyncSession, rules: list[NotificationRule]
) -> NotificationRule:
    selected = _select_low_stock_rule(rules)
    if selected is None:
        selected = await _create_rule(
            session,
            name=STOCK_RULE_NAME,
            rule_type=rule_engine.RuleType.LOW_STOCK,
            params={
                "automatic": True,
                "warehouse_id": None,
                "enabled": False,
                "min_stock": str(DEFAULT_STOCK_MINIMUM),
            },
        )
        rules.append(selected)
    return selected


async def evaluate_rules(session: AsyncSession, settings: Settings) -> list[Incident]:
    """Evaluate V2-managed settings and auto-open/resolve their incidents."""
    now = datetime.now(UTC)
    touched: list[Incident] = []
    new_incidents: list[Incident] = []
    recipient = settings.notification_recipient_email
    subject_prefix = str(
        await settings_store.get_value(session, "notifications.email_subject_prefix")
    )
    today = business_today(await get_business_timezone(session), now=now)

    rules = await _list_rules(session)
    stock_rule = await _ensure_stock_rule(session, rules)
    general_expiration, specific_expirations = _select_expiration_rules(rules)
    active_specific_ids = frozenset(
        product_id for product_id, rule in specific_expirations.items() if rule.is_active
    )
    selected_ids = {stock_rule.id}
    selected_ids.update(rule.id for rule in specific_expirations.values() if rule.is_active)
    if general_expiration is not None and general_expiration.is_active:
        selected_ids.add(general_expiration.id)

    for rule in rules:
        if rule.id in selected_ids:
            rule_type = rule_engine.RuleType(rule.rule_type)
            detections = await rule_engine.detect(
                session,
                rule_type,
                rule.params,
                today=today,
                excluded_product_ids=(
                    active_specific_ids if rule is general_expiration else frozenset()
                ),
            )
        else:
            detections = []
        detected_keys = {(item.subject_type, item.subject_id) for item in detections}

        open_incidents = list(
            (
                await session.execute(
                    select(Incident).where(Incident.rule_id == rule.id, Incident.status == "OPEN")
                )
            ).scalars()
        )
        open_by_key = {(item.subject_type, item.subject_id): item for item in open_incidents}
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

    await session.flush()
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
            entity_type="notification_settings",
            entity_id=None,
            after={"incidents_touched": len(touched)},
        )
    return touched
