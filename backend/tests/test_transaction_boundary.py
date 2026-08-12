"""Request transaction boundary regressions (audit finding A1)."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Self
from urllib.parse import urlsplit, urlunsplit

import pytest
import pytest_asyncio
from argon2 import PasswordHasher
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from starlette.types import Message, Receive, Scope, Send

from app.auth.dependencies import SessionDep
from app.core.config import Settings, get_settings
from app.core.errors import ValidationError
from app.db import session as session_module
from app.inventory.models import Location, Warehouse
from app.main import create_app
from app.rbac.models import Role
from app.sales.models import Sale, SaleStatus
from app.users.models import User
from scripts.devdb import create_database, drop_database
from tests.conftest import DEFAULT_PASSWORD, run_alembic

_FIXTURE_HASHER = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)


class _RecordingSession:
    """Small stand-in used only to observe dependency/response ordering."""

    def __init__(self, events: list[str]) -> None:
        self.events = events
        self.new: set[object] = set()
        self.dirty: set[object] = set()
        self.deleted: set[object] = set()

    async def __aenter__(self) -> Self:
        self.events.append("session")
        return self

    async def __aexit__(self, exc_type: object, exc_value: object, traceback: object) -> None:
        self.events.append("close")

    async def commit(self) -> None:
        self.events.append("commit")

    async def rollback(self) -> None:
        self.events.append("rollback")


@pytest.mark.asyncio
async def test_request_commit_finishes_before_the_response_is_sent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    fake_session = _RecordingSession(events)
    monkeypatch.setattr(session_module, "get_sessionmaker", lambda: lambda: fake_session)

    app = FastAPI()

    @app.post("/mutate")
    async def mutate(_: SessionDep) -> dict[str, bool]:
        events.append("business")
        return {"ok": True}

    async def tracked_app(scope: Scope, receive: Receive, send: Send) -> None:
        async def tracked_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                events.append("response")
            await send(message)

        await app(scope, receive, tracked_send)

    async with AsyncClient(
        transport=ASGITransport(app=tracked_app), base_url="http://testserver"
    ) as client:
        response = await client.post("/mutate")

    assert response.status_code == 200
    assert events.index("commit") < events.index("response")


@pytest.mark.asyncio
async def test_read_only_request_does_not_commit(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[str] = []
    fake_session = _RecordingSession(events)
    monkeypatch.setattr(session_module, "get_sessionmaker", lambda: lambda: fake_session)

    app = FastAPI()

    @app.get("/read")
    async def read(_: SessionDep) -> dict[str, bool]:
        return {"ok": True}

    async def tracked_app(scope: Scope, receive: Receive, send: Send) -> None:
        async def tracked_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                events.append("response")
            await send(message)

        await app(scope, receive, tracked_send)

    async with AsyncClient(
        transport=ASGITransport(app=tracked_app), base_url="http://testserver"
    ) as client:
        response = await client.get("/read")

    assert response.status_code == 200
    assert "commit" not in events
    assert events.index("rollback") < events.index("response")


@dataclass
class _TransactionHarness:
    app: FastAPI
    engine: AsyncEngine
    sessionmaker: async_sessionmaker[AsyncSession]
    settings: Settings
    admin_email: str
    admin_role_id: int
    commit_probe_email: str
    check_probe_email: str
    rollback_probe_emails: tuple[str, str]


def _with_database(url: str, database: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, f"/{database}", "", ""))


@pytest_asyncio.fixture(scope="module", loop_scope="session")
async def transaction_harness(postgres_server_url: str) -> AsyncIterator[_TransactionHarness]:
    database_name = f"openerp_transaction_{uuid.uuid4().hex[:12]}"
    create_database(postgres_server_url, database_name)
    database_url = _with_database(postgres_server_url, database_name)
    engine: AsyncEngine | None = None
    try:
        run_alembic(database_url, "upgrade", "head")
        settings = Settings(
            database_url=database_url,
            environment="test",
            log_format="console",
            log_level="WARNING",
            db_pool_size=5,
            db_max_overflow=10,
        )
        engine = session_module.create_engine(settings)
        maker = async_sessionmaker(
            bind=engine,
            expire_on_commit=False,
            autoflush=False,
        )
        suffix = uuid.uuid4().hex[:12]
        admin_email = f"transaction-admin-{suffix}@example.com"
        commit_probe_email = f"commit-probe-{suffix}@example.com"
        check_probe_email = f"check-probe-{suffix}@example.com"
        rollback_probe_emails = (
            f"rollback-one-{suffix}@example.com",
            f"rollback-two-{suffix}@example.com",
        )

        async with maker() as setup_session:
            admin_role = (
                await setup_session.execute(select(Role).where(Role.name == "ADMIN"))
            ).scalar_one()
            warehouse = (
                await setup_session.execute(
                    select(Warehouse).where(Warehouse.name == "Tienda principal")
                )
            ).scalar_one()
            location = (
                await setup_session.execute(
                    select(Location).where(
                        Location.warehouse_id == warehouse.id,
                        Location.name == "Almacén",
                    )
                )
            ).scalar_one()
            setup_session.add(
                User(
                    email=admin_email,
                    full_name="Transaction Admin",
                    password_hash=_FIXTURE_HASHER.hash(DEFAULT_PASSWORD),
                    role_id=admin_role.id,
                )
            )
            await setup_session.commit()

        app = create_app(settings)
        app.dependency_overrides[get_settings] = lambda: settings

        @app.post("/api/v1/_test/commit-conflict")
        async def commit_conflict(session: SessionDep) -> dict[str, bool]:
            session.add_all(
                [
                    User(
                        email=commit_probe_email,
                        full_name="Must Roll Back",
                        password_hash="unused",
                        role_id=admin_role.id,
                    ),
                    User(
                        email=admin_email,
                        full_name="Duplicate",
                        password_hash="unused",
                        role_id=admin_role.id,
                    ),
                ]
            )
            return {"ok": True}

        @app.post("/api/v1/_test/commit-check-failure")
        async def commit_check_failure(session: SessionDep) -> dict[str, bool]:
            session.add(
                User(
                    email=check_probe_email,
                    full_name="Must Roll Back",
                    password_hash="unused",
                    role_id=admin_role.id,
                )
            )
            session.add(
                Sale(
                    warehouse_id=warehouse.id,
                    location_id=location.id,
                    status=SaleStatus.COMPLETED,
                )
            )
            return {"ok": True}

        @app.post("/api/v1/_test/rollback")
        async def rollback_probe(session: SessionDep) -> None:
            session.add_all(
                [
                    User(
                        email=email,
                        full_name="Must Roll Back",
                        password_hash="unused",
                        role_id=admin_role.id,
                    )
                    for email in rollback_probe_emails
                ]
            )
            await session.flush()
            raise ValidationError("Deliberate rollback probe.")

        yield _TransactionHarness(
            app=app,
            engine=engine,
            sessionmaker=maker,
            settings=settings,
            admin_email=admin_email,
            admin_role_id=admin_role.id,
            commit_probe_email=commit_probe_email,
            check_probe_email=check_probe_email,
            rollback_probe_emails=rollback_probe_emails,
        )
    finally:
        if engine is not None:
            await engine.dispose()
        drop_database(postgres_server_url, database_name)


@pytest_asyncio.fixture(loop_scope="session")
async def committed_client(
    transaction_harness: _TransactionHarness,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[AsyncClient]:
    monkeypatch.setattr(session_module, "_sessionmaker", transaction_harness.sessionmaker)
    async with AsyncClient(
        transport=ASGITransport(app=transaction_harness.app, raise_app_exceptions=False),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/api/v1/auth/login",
            json={
                "email": transaction_harness.admin_email,
                "password": DEFAULT_PASSWORD,
            },
        )
        assert response.status_code == 200
        yield client


async def _default_location(client: AsyncClient) -> tuple[int, int]:
    warehouses = (await client.get("/api/v1/warehouses")).json()
    warehouse = next(item for item in warehouses if item["name"] == "Tienda principal")
    locations = (await client.get(f"/api/v1/warehouses/{warehouse['id']}/locations")).json()
    location = next(item for item in locations if item["name"] == "Almacén")
    return warehouse["id"], location["id"]


async def test_checkout_is_committed_before_success_is_visible(
    committed_client: AsyncClient,
    transaction_harness: _TransactionHarness,
) -> None:
    suffix = uuid.uuid4().hex[:10]
    product_response = await committed_client.post(
        "/api/v1/products",
        json={
            "sku": f"TX-{suffix}",
            "name": "Transaction product",
            "base_unit_name": "UNIDAD",
            "cost": "1.00",
            "list_price": "10.00",
            "tax_rate": "0",
        },
    )
    assert product_response.status_code == 201
    product = product_response.json()
    warehouse_id, location_id = await _default_location(committed_client)
    stock_response = await committed_client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product["id"],
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": "2",
            "unit_cost": "1.00",
        },
    )
    assert stock_response.status_code == 201
    sale_response = await committed_client.post(
        "/api/v1/sales",
        json={"warehouse_id": warehouse_id, "location_id": location_id},
    )
    assert sale_response.status_code == 201
    sale = sale_response.json()
    package_id = next(package["id"] for package in product["packages"] if package["is_base"])
    line_response = await committed_client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={
            "product_id": product["id"],
            "package_id": package_id,
            "quantity_packages": "1",
        },
    )
    assert line_response.status_code == 201

    checkout_response = await committed_client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        json={"payments": [{"method": "CASH", "amount": "10.00"}]},
    )

    assert checkout_response.status_code == 200
    async with transaction_harness.sessionmaker() as independent:
        persisted = await independent.get(Sale, sale["id"])
        assert persisted is not None
        assert persisted.status == SaleStatus.COMPLETED
        assert persisted.completed_at is not None


async def test_created_resource_is_visible_from_an_independent_session(
    committed_client: AsyncClient,
    transaction_harness: _TransactionHarness,
) -> None:
    email = f"created-{uuid.uuid4().hex[:12]}@example.com"
    response = await committed_client.post(
        "/api/v1/users",
        json={
            "email": email,
            "full_name": "Immediately Visible",
            "password": "long-enough-password",
            "role_id": transaction_harness.admin_role_id,
        },
    )

    assert response.status_code == 201
    async with transaction_harness.sessionmaker() as independent:
        persisted = (
            await independent.execute(select(User).where(User.email == email))
        ).scalar_one_or_none()
        assert persisted is not None
        assert persisted.id == response.json()["id"]


async def test_commit_constraint_failure_returns_conflict_and_rolls_back(
    committed_client: AsyncClient,
    transaction_harness: _TransactionHarness,
) -> None:
    response = await committed_client.post("/api/v1/_test/commit-conflict")

    assert response.status_code == 409
    assert response.json()["error"] == {
        "code": "conflict",
        "message": "The operation conflicts with the current database state.",
        "details": {},
    }
    assert "users_email" not in response.text
    async with transaction_harness.sessionmaker() as independent:
        count = await independent.scalar(
            select(func.count())
            .select_from(User)
            .where(User.email == transaction_harness.commit_probe_email)
        )
        assert count == 0


async def test_failure_after_multiple_writes_rolls_everything_back(
    committed_client: AsyncClient,
    transaction_harness: _TransactionHarness,
) -> None:
    response = await committed_client.post("/api/v1/_test/rollback")

    assert response.status_code == 422
    async with transaction_harness.sessionmaker() as independent:
        count = await independent.scalar(
            select(func.count())
            .select_from(User)
            .where(User.email.in_(transaction_harness.rollback_probe_emails))
        )
        assert count == 0


async def test_unexpected_commit_integrity_failure_is_generic_and_rolls_back(
    committed_client: AsyncClient,
    transaction_harness: _TransactionHarness,
) -> None:
    response = await committed_client.post("/api/v1/_test/commit-check-failure")

    assert response.status_code == 500
    assert response.json()["error"] == {
        "code": "internal_error",
        "message": "An unexpected error occurred.",
        "details": {},
    }
    assert "completed_has_fiscal_snapshot" not in response.text
    async with transaction_harness.sessionmaker() as independent:
        count = await independent.scalar(
            select(func.count())
            .select_from(User)
            .where(User.email == transaction_harness.check_probe_email)
        )
        assert count == 0


async def test_normal_get_still_works(
    committed_client: AsyncClient,
    transaction_harness: _TransactionHarness,
) -> None:
    response = await committed_client.get("/api/v1/users")

    assert response.status_code == 200
    assert transaction_harness.admin_email in {user["email"] for user in response.json()}
