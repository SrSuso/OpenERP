"""baseline

Anchor revision for the migration chain.  Intentionally empty: phase 0 ships no
domain tables, but having a head lets ``alembic upgrade head`` /
``alembic downgrade base`` run end-to-end from the first commit, and every
later phase gets a stable parent to branch from.

Revision ID: 76c947bf8e56
Revises:
Create Date: 2026-08-07 22:41:44.513240+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

revision: str = "76c947bf8e56"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
