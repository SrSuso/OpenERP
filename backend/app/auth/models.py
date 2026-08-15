"""Server-side sessions.

A session is opaque and revocable — the deliberate opposite of a stateless
JWT — so a compromised or shared-terminal (POS) session can be killed
instantly from another device instead of waiting out an expiry. Rule 11:
every request that claims to be authenticated re-resolves its session
against this table.

The raw token handed to the client (in the ``openerp_session`` cookie) is
never stored: only its SHA-256 hash is, so a database leak alone never
yields a usable session (see :mod:`app.auth.security`).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IntPrimaryKeyMixin, TimestampMixin
from app.users.models import User


class AuthSession(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "auth_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    # ADMIN y POS viven en cookies y filas distintas, para que cerrar la
    # caja nunca cierre una administración abierta en el mismo navegador.
    surface: Mapped[str] = mapped_column(String(16), default="ADMIN", server_default="ADMIN")
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)

    user: Mapped[User] = relationship()
