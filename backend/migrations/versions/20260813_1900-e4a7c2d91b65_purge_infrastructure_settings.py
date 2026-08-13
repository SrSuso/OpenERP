"""purge infrastructure settings

Revision ID: e4a7c2d91b65
Revises: b7e2c4a91d63
Create Date: 2026-08-13 19:00:00+00:00

Infrastructure is now configured exclusively by each process environment.
Deleting these values is deliberately irreversible: a downgrade restores the
old table shape for code compatibility, but never recreates discarded secrets.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e4a7c2d91b65"
down_revision: str | None = "b7e2c4a91d63"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # `server.*` was the formal namespace for process infrastructure.  Keep
    # every functional setting (business.*, store.*, ticket.*, etc.) intact.
    op.execute(sa.text("DELETE FROM settings WHERE key LIKE 'server.%'"))

    # This singleton contained only SMTP delivery/routing configuration,
    # including its plaintext password.  SMTP remains available via OPENERP_*
    # process configuration; no outbox or notification data is removed.
    op.drop_table("system_settings")


def downgrade() -> None:
    # Structure is reversible, purged credentials and server values are not.
    op.create_table(
        "system_settings",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("smtp_host", sa.String(length=255), nullable=True),
        sa.Column("smtp_port", sa.Integer(), nullable=True),
        sa.Column("smtp_use_tls", sa.Boolean(), nullable=True),
        sa.Column("smtp_username", sa.String(length=255), nullable=True),
        sa.Column("smtp_password", sa.String(length=255), nullable=True),
        sa.Column("smtp_from_email", sa.String(length=255), nullable=True),
        sa.Column("notification_recipient_email", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_system_settings")),
    )
