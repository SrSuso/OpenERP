"""Real PostgreSQL races around the store-wide ticket template scope."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

import pytest
from argon2 import PasswordHasher
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.audit.models import AuditLog
from app.core.config import Settings, get_settings
from app.db.session import get_session
from app.inventory.models import Location, Warehouse
from app.main import create_app
from app.rbac.models import Role
from app.sales.models import Sale, SaleStatus
from app.tickets import service as ticket_service
from app.tickets.models import Ticket, TicketTemplate
from app.tickets.schemas import TicketTemplateCreate
from app.users.models import User
from tests.conftest import DEFAULT_PASSWORD

_TEST_HASHER = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)


def _template_payload(name: str, header: str) -> TicketTemplateCreate:
    return TicketTemplateCreate(
        name=name,
        width_mm=58,
        header_text=header,
        footer_text="",
    )


async def _setup_admin(session: AsyncSession, tag: str) -> User:
    role = (await session.execute(select(Role).where(Role.name == "ADMIN"))).scalar_one()
    user = User(
        email=f"ticket-concurrency-{tag}@example.com",
        full_name="Ticket concurrency admin",
        password_hash=_TEST_HASHER.hash(DEFAULT_PASSWORD),
        role_id=role.id,
    )
    session.add(user)
    await session.flush()
    return user


async def _setup_completed_sale(session: AsyncSession) -> Sale:
    warehouse = (await session.execute(select(Warehouse).order_by(Warehouse.id))).scalars().first()
    assert warehouse is not None
    location = (
        (
            await session.execute(
                select(Location).where(Location.warehouse_id == warehouse.id).order_by(Location.id)
            )
        )
        .scalars()
        .first()
    )
    assert location is not None
    sale = Sale(
        warehouse_id=warehouse.id,
        location_id=location.id,
        status=SaleStatus.COMPLETED,
        notes="",
        completed_at=datetime.now(UTC),
        prices_include_tax=False,
    )
    session.add(sale)
    await session.flush()
    return sale


async def _request_clients(
    settings: Settings,
    maker: async_sessionmaker[AsyncSession],
    email: str,
) -> tuple[FastAPI, AsyncClient, AsyncClient]:
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings

    async def _committing_request_session() -> AsyncIterator[AsyncSession]:
        async with maker() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_session] = _committing_request_session
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    first = AsyncClient(transport=transport, base_url="http://testserver")
    second = AsyncClient(transport=transport, base_url="http://testserver")
    for client in (first, second):
        response = await client.post(
            "/api/v1/auth/login", json={"email": email, "password": DEFAULT_PASSWORD}
        )
        assert response.status_code == 200
    return app, first, second


async def _close_clients(app: FastAPI, *clients: AsyncClient) -> None:
    for client in clients:
        await client.aclose()
    app.dependency_overrides.clear()


async def test_concurrent_activations_finish_with_one_active_template(
    settings: Settings,
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """R1: the old broad UPDATE happens to serialize this exact path."""
    tag = uuid.uuid4().hex[:10]
    async with committing_sessionmaker() as setup:
        admin = await _setup_admin(setup, tag)
        first = await ticket_service.create_template(setup, _template_payload(f"A-{tag}", "A"))
        second = await ticket_service.create_template(setup, _template_payload(f"B-{tag}", "B"))
        await ticket_service.create_template(setup, _template_payload(f"active-{tag}", "active"))
        await setup.commit()
        ids = (first.id, second.id)
        email = admin.email

    app, client_a, client_b = await _request_clients(settings, committing_sessionmaker, email)
    try:
        responses = await asyncio.gather(
            client_a.post(f"/api/v1/ticket-templates/{ids[0]}/activate"),
            client_b.post(f"/api/v1/ticket-templates/{ids[1]}/activate"),
        )
    finally:
        await _close_clients(app, client_a, client_b)

    assert [response.status_code for response in responses] == [200, 200]
    async with committing_sessionmaker() as verification:
        active_ids = list(
            (
                await verification.execute(
                    select(TicketTemplate.id).where(TicketTemplate.is_active.is_(True))
                )
            ).scalars()
        )
    assert len(active_ids) == 1
    assert active_ids[0] in ids


async def test_concurrent_duplicate_template_creation_is_a_semantic_conflict(
    settings: Settings,
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """A concurrent duplicate version is a 409, never a flush-time 500."""
    tag = uuid.uuid4().hex[:10]
    async with committing_sessionmaker() as setup:
        admin = await _setup_admin(setup, tag)
        await setup.commit()
        email = admin.email

    app, client_a, client_b = await _request_clients(settings, committing_sessionmaker, email)
    payload = {
        "name": f"duplicate-{tag}",
        "width_mm": 58,
        "header_text": "Concurrent create",
        "footer_text": "",
    }
    try:
        responses = await asyncio.gather(
            client_a.post("/api/v1/ticket-templates", json=payload),
            client_b.post("/api/v1/ticket-templates", json=payload),
        )
    finally:
        await _close_clients(app, client_a, client_b)

    assert sorted(response.status_code for response in responses) == [201, 409]
    async with committing_sessionmaker() as verification:
        versions = list(
            (
                await verification.execute(
                    select(TicketTemplate.version).where(TicketTemplate.name == payload["name"])
                )
            ).scalars()
        )
    assert versions == [1]


async def test_concurrent_revision_of_the_same_version_is_a_semantic_conflict(
    settings: Settings,
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """Only one successor version is created; the stale request gets 409."""
    tag = uuid.uuid4().hex[:10]
    async with committing_sessionmaker() as setup:
        admin = await _setup_admin(setup, tag)
        original = await ticket_service.create_template(
            setup, _template_payload(f"revision-{tag}", "Original")
        )
        await setup.commit()
        email, original_id = admin.email, original.id

    app, client_a, client_b = await _request_clients(settings, committing_sessionmaker, email)
    payload = {"width_mm": 80, "header_text": "Concurrent revision", "footer_text": ""}
    try:
        responses = await asyncio.gather(
            client_a.post(f"/api/v1/ticket-templates/{original_id}/revise", json=payload),
            client_b.post(f"/api/v1/ticket-templates/{original_id}/revise", json=payload),
        )
    finally:
        await _close_clients(app, client_a, client_b)

    assert sorted(response.status_code for response in responses) == [200, 409]
    async with committing_sessionmaker() as verification:
        templates = list(
            (
                await verification.execute(
                    select(TicketTemplate)
                    .where(TicketTemplate.name == f"revision-{tag}")
                    .order_by(TicketTemplate.version)
                )
            ).scalars()
        )
    assert [template.version for template in templates] == [1, 2]
    assert [template.version for template in templates if template.is_active] == [2]


async def test_waiting_activation_reloads_state_and_wins_last(
    monkeypatch: pytest.MonkeyPatch,
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """A3: the activation waiting on the global scope is the final state."""
    tag = uuid.uuid4().hex[:10]
    async with committing_sessionmaker() as setup:
        first = await ticket_service.create_template(
            setup, _template_payload(f"ordered-A-{tag}", "A")
        )
        second = await ticket_service.create_template(
            setup, _template_payload(f"ordered-B-{tag}", "B")
        )
        await ticket_service.create_template(
            setup, _template_payload(f"ordered-current-{tag}", "current")
        )
        await setup.commit()
        first_id, second_id = first.id, second.id

    first_session = committing_sessionmaker()
    await ticket_service.activate_template(first_session, first_id)

    original_lock = ticket_service._lock_template_scope
    second_reached_lock = asyncio.Event()

    async def observed_lock(session: AsyncSession, *, shared: bool = False) -> None:
        second_reached_lock.set()
        await original_lock(session, shared=shared)

    monkeypatch.setattr(ticket_service, "_lock_template_scope", observed_lock)

    async def activate_second() -> int:
        async with committing_sessionmaker() as session:
            template = await ticket_service.activate_template(session, second_id)
            await session.commit()
            return template.id

    waiting = asyncio.create_task(activate_second())
    await asyncio.wait_for(second_reached_lock.wait(), timeout=5)
    assert not waiting.done()
    await first_session.commit()
    await first_session.close()

    assert await asyncio.wait_for(waiting, timeout=5) == second_id
    async with committing_sessionmaker() as verification:
        active_ids = list(
            (
                await verification.execute(
                    select(TicketTemplate.id).where(TicketTemplate.is_active.is_(True))
                )
            ).scalars()
        )
    assert active_ids == [second_id]


async def test_activating_the_active_template_is_an_unaudited_noop(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """A4: state idempotency does not claim a transition that did not occur."""
    tag = uuid.uuid4().hex[:10]
    async with committing_sessionmaker() as setup:
        active = await ticket_service.create_template(
            setup, _template_payload(f"noop-{tag}", "No-op")
        )
        await setup.commit()
        template_id = active.id

    async with committing_sessionmaker() as session:
        returned = await ticket_service.activate_template(session, template_id)
        await session.commit()
        audit_count = await session.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(
                AuditLog.entity_type == "ticket_template",
                AuditLog.entity_id == template_id,
                AuditLog.action == "activated",
            )
        )
    assert returned.id == template_id
    assert returned.is_active is True
    assert audit_count == 0


async def test_postgresql_rejects_two_active_templates_directly(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """A5: the invariant survives callers that bypass the service."""
    tag = uuid.uuid4().hex[:10]
    async with committing_sessionmaker() as setup:
        first = await ticket_service.create_template(
            setup, _template_payload(f"constraint-A-{tag}", "A")
        )
        second = await ticket_service.create_template(
            setup, _template_payload(f"constraint-B-{tag}", "B")
        )
        await setup.commit()
        ids = (first.id, second.id)

    async with committing_sessionmaker() as session:
        await session.execute(update(TicketTemplate).values(is_active=False))
        with pytest.raises(IntegrityError, match="uq_ticket_templates_single_active"):
            await session.execute(
                update(TicketTemplate).where(TicketTemplate.id.in_(ids)).values(is_active=True)
            )
        await session.rollback()


async def test_concurrent_generation_returns_the_same_persisted_ticket(
    settings: Settings,
    committing_sessionmaker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """R2: both requests must not escape the sale-id collision as a 500."""
    tag = uuid.uuid4().hex[:10]
    async with committing_sessionmaker() as setup:
        admin = await _setup_admin(setup, tag)
        await ticket_service.create_template(
            setup, _template_payload(f"generation-{tag}", "Winning render")
        )
        sale = await _setup_completed_sale(setup)
        await setup.commit()
        sale_id = sale.id
        email = admin.email

    real_render = ticket_service.render_ticket  # type: ignore[attr-defined]
    render_count = 0

    def counted_render(*args: Any, **kwargs: Any) -> str:
        nonlocal render_count
        render_count += 1
        return real_render(*args, **kwargs)

    monkeypatch.setattr(ticket_service, "render_ticket", counted_render)
    app, client_a, client_b = await _request_clients(settings, committing_sessionmaker, email)
    try:
        responses = await asyncio.gather(
            client_a.post(f"/api/v1/sales/{sale_id}/tickets"),
            client_b.post(f"/api/v1/sales/{sale_id}/tickets"),
        )
    finally:
        await _close_clients(app, client_a, client_b)

    assert [response.status_code for response in responses] == [201, 201]
    bodies = [response.json() for response in responses]
    assert bodies[0]["id"] == bodies[1]["id"]
    assert bodies[0]["rendered_text"] == bodies[1]["rendered_text"]
    assert render_count == 1
    async with committing_sessionmaker() as verification:
        count = await verification.scalar(
            select(func.count()).select_from(Ticket).where(Ticket.sale_id == sale_id)
        )
        audit_count = await verification.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(
                AuditLog.entity_type == "ticket",
                AuditLog.action == "generated",
                AuditLog.after_data["sale_id"].as_integer() == sale_id,
            )
        )
    assert count == 1
    assert audit_count == 1


async def test_generation_waits_for_activation_and_uses_one_complete_template_state(
    monkeypatch: pytest.MonkeyPatch,
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """G8: a generator waiting behind activation uses the newly active B."""
    tag = uuid.uuid4().hex[:10]
    async with committing_sessionmaker() as setup:
        first = await ticket_service.create_template(
            setup, _template_payload(f"cut-A-{tag}", "Template A complete")
        )
        second = await ticket_service.create_template(
            setup, _template_payload(f"cut-B-{tag}", "Template B complete")
        )
        await ticket_service.activate_template(setup, first.id)
        sale = await _setup_completed_sale(setup)
        await setup.commit()
        sale_id, second_id = sale.id, second.id

    activation = committing_sessionmaker()
    await ticket_service.activate_template(activation, second_id)

    original_lock = ticket_service._lock_template_scope
    generation_reached_lock = asyncio.Event()

    async def observed_lock(session: AsyncSession, *, shared: bool = False) -> None:
        if shared:
            generation_reached_lock.set()
        await original_lock(session, shared=shared)

    monkeypatch.setattr(ticket_service, "_lock_template_scope", observed_lock)

    async def generate() -> tuple[int, int, str]:
        async with committing_sessionmaker() as session:
            ticket = await ticket_service.generate_ticket(session, sale_id)
            await session.commit()
            return ticket.id, ticket.template_id, ticket.rendered_text

    waiting = asyncio.create_task(generate())
    await asyncio.wait_for(generation_reached_lock.wait(), timeout=5)
    assert not waiting.done()
    await activation.commit()
    await activation.close()

    _ticket_id, template_id, rendered = await asyncio.wait_for(waiting, timeout=5)
    assert template_id == second_id
    assert "Template B complete" in rendered
    assert "Template A complete" not in rendered


async def test_different_sales_can_generate_under_shared_template_lock(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """The global scope cuts activation, not throughput between sales."""
    tag = uuid.uuid4().hex[:10]
    async with committing_sessionmaker() as setup:
        await ticket_service.create_template(
            setup, _template_payload(f"parallel-{tag}", "Parallel template")
        )
        first_sale = await _setup_completed_sale(setup)
        second_sale = await _setup_completed_sale(setup)
        await setup.commit()
        sale_ids = (first_sale.id, second_sale.id)

    first_session = committing_sessionmaker()
    first_ticket = await ticket_service.generate_ticket(first_session, sale_ids[0])

    async def generate_second() -> int:
        async with committing_sessionmaker() as session:
            ticket = await ticket_service.generate_ticket(session, sale_ids[1])
            await session.commit()
            return ticket.id

    second_id = await asyncio.wait_for(generate_second(), timeout=5)
    await first_session.commit()
    await first_session.close()

    assert second_id != first_ticket.id


async def test_old_ticket_stays_frozen_and_new_sale_uses_new_template(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """G6/G7: generation and reprint never reinterpret old history."""
    tag = uuid.uuid4().hex[:10]
    async with committing_sessionmaker() as session:
        first_template = await ticket_service.create_template(
            session, _template_payload(f"history-A-{tag}", "Historical A")
        )
        first_sale = await _setup_completed_sale(session)
        first_ticket = await ticket_service.generate_ticket(session, first_sale.id)
        await session.commit()
        frozen = (first_ticket.id, first_ticket.template_id, first_ticket.rendered_text)

    async with committing_sessionmaker() as session:
        second_template = await ticket_service.create_template(
            session, _template_payload(f"history-B-{tag}", "Current B")
        )
        second_sale = await _setup_completed_sale(session)
        replay = await ticket_service.generate_ticket(session, first_sale.id)
        new_ticket = await ticket_service.generate_ticket(session, second_sale.id)
        await session.commit()

    assert (replay.id, replay.template_id, replay.rendered_text) == frozen
    assert replay.template_id == first_template.id
    assert "Historical A" in replay.rendered_text
    assert "Current B" not in replay.rendered_text
    assert new_ticket.template_id == second_template.id
    assert "Current B" in new_ticket.rendered_text


async def test_non_identity_integrity_error_is_not_treated_as_ticket_replay(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """G9: ON CONFLICT targets sale identity, not a blanket DB exception."""
    async with committing_sessionmaker() as session:
        sale = await _setup_completed_sale(session)
        await session.commit()
        sale_id = sale.id

    async with committing_sessionmaker() as session:
        with pytest.raises(IntegrityError, match="fk_tickets_template_id_ticket_templates"):
            await ticket_service._insert_ticket(
                session,
                sale_id=sale_id,
                template_id=9_999_999_999,
                width_mm=58,
                rendered_text="invalid foreign key",
            )
        await session.rollback()
