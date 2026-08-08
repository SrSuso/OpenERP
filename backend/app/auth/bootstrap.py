"""Create the first administrator account.

There is no self-registration (users are created by an admin, never sign
themselves up), so something has to create the very first one. Run once per
environment, after migrations::

    uv run python -m app.auth.bootstrap

or non-interactively via environment variables (see ``.env.example``)::

    OPENERP_BOOTSTRAP_ADMIN_EMAIL=admin@example.com \\
    OPENERP_BOOTSTRAP_ADMIN_PASSWORD=... \\
        uv run python -m app.auth.bootstrap

Idempotent: prints and exits 0 if a user with that email already exists, so
it is safe to run on every deploy rather than only the first.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import sys

from sqlalchemy import select

from app.auth.security import hash_password
from app.core.config import get_settings
from app.db.session import session_scope
from app.rbac.models import Role
from app.users.models import User
from app.users.schemas import normalise_email


async def _bootstrap(email: str, password: str, full_name: str) -> int:
    email = normalise_email(email)
    async with session_scope() as session:
        existing = (
            await session.execute(select(User).where(User.email == email))
        ).scalar_one_or_none()
        if existing is not None:
            print(f"admin already exists: {email}")
            return 0

        role = (
            await session.execute(select(Role).where(Role.name == "ADMIN"))
        ).scalar_one_or_none()
        if role is None:
            print("role 'ADMIN' not found — run `alembic upgrade head` first.", file=sys.stderr)
            return 1

        session.add(
            User(
                email=email,
                full_name=full_name,
                password_hash=hash_password(password),
                role_id=role.id,
            )
        )
    print(f"created admin: {email}")
    return 0


def main(argv: list[str] | None = None) -> int:
    settings = get_settings()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", default=settings.bootstrap_admin_email)
    parser.add_argument("--full-name", default="Administrator")
    args = parser.parse_args(argv)

    email = args.email or input("admin email: ").strip()

    password = settings.bootstrap_admin_password
    if not password:
        password = getpass.getpass("admin password: ")
        if password != getpass.getpass("confirm password: "):
            print("passwords do not match.", file=sys.stderr)
            return 1
    if len(password) < 8:
        print("password must be at least 8 characters.", file=sys.stderr)
        return 1

    return asyncio.run(_bootstrap(email, password, args.full_name))


if __name__ == "__main__":
    sys.exit(main())
