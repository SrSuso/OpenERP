"""app.audit.service: the only way anything writes to the audit trail."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.audit.models import AuditLog
from app.core.context import request_context, set_user_id
from app.users.models import User


async def test_record_captures_ambient_context(
    db_session: AsyncSession, make_user: Callable[..., Awaitable[User]]
) -> None:
    actor = await make_user(email="auditor-1@example.com", role_name="ADMIN")

    with request_context(request_id="req-audit-1", client_ip="10.0.0.5"):
        set_user_id(actor.id)
        await audit.record(
            db_session,
            action="created",
            entity_type="widget",
            entity_id=7,
            before=None,
            after={"name": "thing"},
        )

    entries = await audit.list_entries(db_session, entity_type="widget")
    assert len(entries) == 1
    entry = entries[0]
    assert entry.user_id == actor.id
    assert entry.request_id == "req-audit-1"
    assert entry.ip == "10.0.0.5"
    assert entry.action == "created"
    assert entry.entity_id == 7
    assert entry.before_data is None
    assert entry.after_data == {"name": "thing"}


async def test_record_without_ambient_context_leaves_nulls(db_session: AsyncSession) -> None:
    """Outside a request (e.g. the bootstrap CLI), there is no request id,
    ip or acting user — the row must still be written, with those columns
    null rather than the insert failing."""
    await audit.record(db_session, action="bootstrap_created", entity_type="user", entity_id=1)

    entries = await audit.list_entries(db_session, entity_type="user", entity_id=1)
    assert entries
    entry = entries[0]
    assert entry.user_id is None
    assert entry.request_id is None
    assert entry.ip is None


async def test_list_entries_filters_by_entity_and_user(
    db_session: AsyncSession, make_user: Callable[..., Awaitable[User]]
) -> None:
    actor = await make_user(email="auditor-2@example.com", role_name="ADMIN")

    await audit.record(db_session, action="created", entity_type="alpha", entity_id=1)
    await audit.record(db_session, action="created", entity_type="beta", entity_id=2)
    set_user_id(actor.id)
    await audit.record(db_session, action="created", entity_type="alpha", entity_id=3)
    set_user_id(None)

    only_alpha = await audit.list_entries(db_session, entity_type="alpha")
    assert {e.entity_id for e in only_alpha} == {1, 3}

    only_actor = await audit.list_entries(db_session, user_id=actor.id)
    assert [e.entity_id for e in only_actor] == [3]


async def test_list_entries_orders_most_recent_first(db_session: AsyncSession) -> None:
    for i in range(3):
        await audit.record(db_session, action="created", entity_type="ordering", entity_id=i)

    entries = await audit.list_entries(db_session, entity_type="ordering")
    ids = [e.entity_id for e in entries]
    assert ids == [2, 1, 0]


async def test_audit_log_has_no_update_or_delete_surface() -> None:
    """Enforced in code, not just by convention: the module exposes no way
    to mutate a row once written."""
    exported = {name for name in dir(audit) if not name.startswith("_")}
    assert exported.isdisjoint({"update", "update_entry", "delete", "delete_entry", "remove"})


async def test_audit_log_model_has_no_updated_at() -> None:
    assert not hasattr(AuditLog, "updated_at")
