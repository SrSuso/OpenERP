"""The cold-drink price can be delegated without exposing all settings."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.rbac.models import Permission, Role
from app.rbac.permissions import POS_COLD_DRINK_SURCHARGE_MANAGE


async def test_cold_drink_surcharge_permission_reads_and_updates_only_its_setting(
    client: AsyncClient,
    db_session: AsyncSession,
    login: Callable[..., Awaitable[dict[str, Any]]],
) -> None:
    permission = (
        await db_session.execute(
            select(Permission).where(Permission.key == POS_COLD_DRINK_SURCHARGE_MANAGE)
        )
    ).scalar_one()
    role = Role(
        name="COLD-DRINK-SUPERVISOR",
        description="May maintain only the cold-drink surcharge.",
        permissions=[permission],
    )
    db_session.add(role)
    await db_session.flush()
    await login(role_name=role.name)

    read = await client.get("/api/v1/settings/pos/cold-drink-surcharge")
    assert read.status_code == 200
    assert read.json()["key"] == "pos.cold_drink_surcharge_amount"

    saved = await client.put("/api/v1/settings/pos/cold-drink-surcharge", json={"amount": "0.35"})
    assert saved.status_code == 200
    assert saved.json()["value"] == "0.35"

    # The narrow role cannot read the settings catalogue or alter a different
    # setting through its broad endpoint.
    assert (await client.get("/api/v1/settings/options")).status_code == 403
    assert (
        await client.put("/api/v1/settings/options", json={"values": {"app.display_name": "X"}})
    ).status_code == 403


async def test_cold_drink_surcharge_endpoint_rejects_roles_without_its_permission(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="MANAGER")

    assert (await client.get("/api/v1/settings/pos/cold-drink-surcharge")).status_code == 403
    assert (
        await client.put("/api/v1/settings/pos/cold-drink-surcharge", json={"amount": "0.35"})
    ).status_code == 403
