"""Ticket template management and per-sale ticket generation.

Only one template is active store-wide at a time — the till prints one
receipt layout — but a shop can keep as many as it likes and switch
between them with ``activate_template``. PostgreSQL serializes every active
template transition through one transaction advisory lock. New ticket
generation takes the shared form of that same lock, so many independent sales
can render concurrently while a template switch has a clear before/after cut.

``update_template`` changes one saved template in place. Tickets already
generated remain immutable snapshots, so editing a layout affects only
future receipts.
"""

from __future__ import annotations

from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import service as audit
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.sales.models import Sale, SaleStatus
from app.settings.business_time import get_business_timezone
from app.tickets.models import Ticket, TicketTemplate
from app.tickets.render import render_ticket
from app.tickets.schemas import TicketTemplateCreate, TicketTemplateUpdate

_SALE_OPTIONS = (
    selectinload(Sale.lines),
    selectinload(Sale.payments),
)

# ASCII "TICK", inside PostgreSQL's signed int32 range. The second key is the
# sole store-wide template scope. It is unrelated to the warehouse accounting,
# sale-number and security lock namespaces elsewhere in the application.
_TEMPLATE_LOCK_NAMESPACE = 0x5449434B
_GLOBAL_TEMPLATE_SCOPE = 1
_LOCK_TEMPLATE_SCOPE = text("SELECT pg_advisory_xact_lock(:namespace, :scope)")
_LOCK_TEMPLATE_SCOPE_SHARED = text("SELECT pg_advisory_xact_lock_shared(:namespace, :scope)")


async def _lock_template_scope(session: AsyncSession, *, shared: bool = False) -> None:
    """Lock the store-wide active-template scope until transaction end.

    Exclusive locks protect create/update/activate. Ticket generation uses a
    shared lock after locking its completed Sale, allowing unrelated tickets
    to render together but never across the middle of an activation.
    """
    await session.execute(
        _LOCK_TEMPLATE_SCOPE_SHARED if shared else _LOCK_TEMPLATE_SCOPE,
        {"namespace": _TEMPLATE_LOCK_NAMESPACE, "scope": _GLOBAL_TEMPLATE_SCOPE},
    )


async def list_templates(session: AsyncSession) -> list[TicketTemplate]:
    stmt = select(TicketTemplate).order_by(TicketTemplate.name, TicketTemplate.id)
    return list((await session.execute(stmt)).scalars())


async def get_active_template(session: AsyncSession) -> TicketTemplate:
    stmt = select(TicketTemplate).where(TicketTemplate.is_active.is_(True))
    template = (await session.execute(stmt)).scalar_one_or_none()
    if template is None:
        raise ValidationError(
            "No active ticket template configured — create one with POST /ticket-templates first."
        )
    return template


async def _deactivate_all(session: AsyncSession) -> None:
    await session.execute(update(TicketTemplate).values(is_active=False))


async def _ensure_template_name_is_available(
    session: AsyncSession, *, name: str, excluding_id: int | None = None
) -> None:
    existing_id = await session.scalar(select(TicketTemplate.id).where(TicketTemplate.name == name))
    if existing_id is not None and existing_id != excluding_id:
        raise ConflictError(f"Ticket template {name!r} already exists.")


async def create_template(session: AsyncSession, payload: TicketTemplateCreate) -> TicketTemplate:
    await _lock_template_scope(session)
    await _ensure_template_name_is_available(session, name=payload.name)
    has_active_template = (
        await session.scalar(select(TicketTemplate.id).where(TicketTemplate.is_active.is_(True)))
    ) is not None
    # Creating an alternative must not unexpectedly change what the till
    # prints. The first saved template is the one exception: it becomes active.
    template = TicketTemplate(**payload.model_dump(), is_active=not has_active_template)
    session.add(template)
    await session.flush()
    await audit.record(
        session,
        action="created",
        entity_type="ticket_template",
        entity_id=template.id,
        after={
            "name": template.name,
            "printable_width_mm": template.printable_width_mm,
        },
    )
    return template


async def get_template(session: AsyncSession, template_id: int) -> TicketTemplate:
    template = await session.get(TicketTemplate, template_id)
    if template is None:
        raise NotFoundError(f"Ticket template {template_id} not found.")
    return template


async def update_template(
    session: AsyncSession, template_id: int, payload: TicketTemplateUpdate
) -> TicketTemplate:
    await _lock_template_scope(session)
    template = await get_template(session, template_id)
    await _ensure_template_name_is_available(session, name=payload.name, excluding_id=template_id)
    before = {"name": template.name, "printable_width_mm": template.printable_width_mm}
    for field, value in payload.model_dump().items():
        setattr(template, field, value)
    await session.flush()
    await audit.record(
        session,
        action="updated",
        entity_type="ticket_template",
        entity_id=template.id,
        before=before,
        after={"name": template.name, "printable_width_mm": template.printable_width_mm},
    )
    return template


async def activate_template(session: AsyncSession, template_id: int) -> TicketTemplate:
    """Pone en uso una plantilla concreta. Sigue habiendo exactamente una
    activa (ver el docstring del módulo): activar una retira la anterior,
    que se queda guardada para poder volver a ella."""
    await _lock_template_scope(session)
    # Re-read only after taking the scope lock: an activation that waited must
    # make its decision from the state committed by the transition before it.
    template = await get_template(session, template_id)
    if template.is_active:
        return template

    await _deactivate_all(session)
    template.is_active = True
    await session.flush()
    await audit.record(
        session,
        action="activated",
        entity_type="ticket_template",
        entity_id=template_id,
        after={"name": template.name},
    )
    return template


async def delete_template(session: AsyncSession, template_id: int) -> None:
    """Delete a template, including one that was used in past tickets.

    A receipt stores its rendered text and full print profile itself. The
    database therefore clears only its optional link when PostgreSQL deletes
    the template (``ON DELETE SET NULL``); it never changes historical ticket
    content. An active deletion simply leaves the shop without an active
    layout until another one is created or activated.
    """
    await _lock_template_scope(session)
    template = await get_template(session, template_id)

    before = {
        "name": template.name,
        "is_active": template.is_active,
    }
    await session.delete(template)
    await session.flush()
    await audit.record(
        session,
        action="deleted",
        entity_type="ticket_template",
        entity_id=template_id,
        before=before,
    )


async def get_ticket(session: AsyncSession, sale_id: int) -> Ticket:
    stmt = select(Ticket).where(Ticket.sale_id == sale_id)
    ticket = (await session.execute(stmt)).scalar_one_or_none()
    if ticket is None:
        raise NotFoundError(f"No ticket generated yet for sale {sale_id}.")
    return ticket


async def _insert_ticket(
    session: AsyncSession,
    *,
    sale_id: int,
    template_id: int,
    printable_width_mm: int,
    margin_left_mm: int,
    margin_right_mm: int,
    font_family: str,
    font_size_px: int,
    line_height_px: int,
    font_weight: str,
    margin_top_mm: int,
    margin_bottom_mm: int,
    rendered_text: str,
) -> int | None:
    """Insert against the natural identity without masking other failures."""
    return await session.scalar(
        insert(Ticket)
        .values(
            sale_id=sale_id,
            template_id=template_id,
            printable_width_mm=printable_width_mm,
            margin_left_mm=margin_left_mm,
            margin_right_mm=margin_right_mm,
            font_family=font_family,
            font_size_px=font_size_px,
            line_height_px=line_height_px,
            font_weight=font_weight,
            margin_top_mm=margin_top_mm,
            margin_bottom_mm=margin_bottom_mm,
            rendered_text=rendered_text,
        )
        .on_conflict_do_nothing(constraint="uq_tickets_sale_id")
        .returning(Ticket.id)
    )


async def generate_ticket(session: AsyncSession, sale_id: int) -> Ticket:
    """Idempotent: a sale gets exactly one ticket, ever. A second call
    returns the same row untouched — including its already-frozen
    ``rendered_text`` — rather than re-rendering against whatever template
    happens to be active now."""
    existing = (
        await session.execute(select(Ticket).where(Ticket.sale_id == sale_id))
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    # The Sale is the natural serialization row for its one Ticket. Once this
    # lock is acquired, re-check because another request may have created the
    # ticket while this one waited. This is what keeps rendering single-shot.
    sale_stmt = select(Sale).where(Sale.id == sale_id).options(*_SALE_OPTIONS).with_for_update()
    sale = (await session.execute(sale_stmt)).scalar_one_or_none()
    if sale is None:
        raise ValidationError(f"Sale {sale_id} does not exist.")
    if sale.status != SaleStatus.COMPLETED:
        raise ValidationError(
            f"Only a completed sale has a ticket to print (this one is {sale.status})."
        )

    existing = (
        await session.execute(select(Ticket).where(Ticket.sale_id == sale_id))
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    # Lock order for this module is Sale row -> shared global template scope.
    # Template mutations acquire only the latter, so they cannot form a cycle
    # with checkout's accounting/Sale/inventory order.
    await _lock_template_scope(session, shared=True)
    template = await get_active_template(session)
    assert sale.prices_include_tax is not None  # completed-sale DB invariant
    rendered_text = render_ticket(
        sale,
        template,
        prices_include_tax=sale.prices_include_tax,
        business_timezone=await get_business_timezone(session),
        cashier_name=sale.cashier_name,
    )

    # PostgreSQL remains the final arbiter. Target only the natural ticket
    # identity constraint: unrelated FK/CHECK/unique failures still raise.
    inserted_id = await _insert_ticket(
        session,
        sale_id=sale_id,
        template_id=template.id,
        printable_width_mm=template.printable_width_mm,
        margin_left_mm=template.margin_left_mm,
        margin_right_mm=template.margin_right_mm,
        font_family=template.font_family,
        font_size_px=template.font_size_px,
        line_height_px=template.line_height_px,
        font_weight=template.font_weight,
        margin_top_mm=template.margin_top_mm,
        margin_bottom_mm=template.margin_bottom_mm,
        rendered_text=rendered_text,
    )
    if inserted_id is None:
        # Defensive fallback for a caller that did not follow the Sale lock.
        # The winning persisted render is authoritative and is never replaced.
        return (await session.execute(select(Ticket).where(Ticket.sale_id == sale_id))).scalar_one()

    ticket = await session.get(Ticket, inserted_id)
    assert ticket is not None
    await audit.record(
        session,
        action="generated",
        entity_type="ticket",
        entity_id=ticket.id,
        after={"sale_id": sale_id, "template_id": template.id},
    )
    return ticket
