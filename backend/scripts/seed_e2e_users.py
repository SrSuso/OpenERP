"""Seed the fixed admin/cashier accounts the Playwright E2E suite logs in as.

Idempotent — safe to run on every CI job / local E2E run; does nothing to a
user that already exists. Requires the phase 1 migration to have run first
(it looks up the ``ADMIN``/``CASHIER`` roles by name).

Usage::

    uv run python -m scripts.seed_e2e_users

Credentials come from ``E2E_ADMIN_EMAIL``/``E2E_ADMIN_PASSWORD`` and
``E2E_CASHIER_EMAIL``/``E2E_CASHIER_PASSWORD`` if set (the same names the
specs under ``tests/e2e/specs/`` read), otherwise fall back to the values
those specs default to.
"""

from __future__ import annotations

import asyncio
import os
import sys
from dataclasses import dataclass

from sqlalchemy import select

from app.auth.security import hash_password
from app.db.session import session_scope
from app.rbac.models import Role
from app.users.models import User
from app.users.schemas import normalise_email


@dataclass(frozen=True)
class _AccountSpec:
    email_var: str
    email_default: str
    password_var: str
    password_default: str
    role_name: str
    full_name: str


_ACCOUNTS = (
    _AccountSpec(
        "E2E_ADMIN_EMAIL",
        "e2e-admin@example.com",
        "E2E_ADMIN_PASSWORD",
        "e2e-admin-pass-123",
        "ADMIN",
        "E2E Admin",
    ),
    _AccountSpec(
        "E2E_CASHIER_EMAIL",
        "e2e-cashier@example.com",
        "E2E_CASHIER_PASSWORD",
        "e2e-cashier-pass-123",
        "CASHIER",
        "E2E Cashier",
    ),
)


async def _seed() -> int:
    async with session_scope() as session:
        for spec in _ACCOUNTS:
            email = normalise_email(os.environ.get(spec.email_var, spec.email_default))
            password = os.environ.get(spec.password_var, spec.password_default)

            existing = (
                await session.execute(select(User).where(User.email == email))
            ).scalar_one_or_none()
            if existing is not None:
                print(f"already present: {email}")
                continue

            role = (
                await session.execute(select(Role).where(Role.name == spec.role_name))
            ).scalar_one_or_none()
            if role is None:
                print(
                    f"role {spec.role_name!r} not found — run `alembic upgrade head` first.",
                    file=sys.stderr,
                )
                return 1

            session.add(
                User(
                    email=email,
                    full_name=spec.full_name,
                    password_hash=hash_password(password),
                    role_id=role.id,
                )
            )
            print(f"seeded: {email} ({spec.role_name})")
    return 0


def main() -> int:
    return asyncio.run(_seed())


if __name__ == "__main__":
    sys.exit(main())
