"""User accounts.

Users are deactivated, never deleted, once they have any history attached
(audit log, sales, ...) — rule 14. ``is_active`` is the switch every other
module checks before letting a user authenticate or act.
"""

from __future__ import annotations

from sqlalchemy import BigInteger, Boolean, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IntPrimaryKeyMixin, TimestampMixin
from app.rbac.models import Role


class User(IntPrimaryKeyMixin, TimestampMixin, Base):
    """A person who can sign in.

    One role per user in phase 1 (see :class:`app.rbac.models.Role`).
    ``email`` is stored already-normalised (:func:`app.users.schemas.normalise_email`
    lowercases it on every write) and additionally protected by a functional
    unique index, so a race between two signups for the same address with
    different casing still fails at the database.
    """

    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255))
    password_hash: Mapped[str] = mapped_column(String(255))
    # Las credenciales de caja no reutilizan la contraseña de administración:
    # el PIN se guarda con el mismo hasher, nunca en claro.
    pos_username: Mapped[str | None] = mapped_column(String(64), nullable=True)
    pos_pin_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Configurar un PIN no basta para abrir una caja: Administración decide
    # explícitamente qué cuentas están habilitadas para la superficie POS.
    pos_access_enabled: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    must_change_password: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    role_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("roles.id"), index=True)

    role: Mapped[Role] = relationship()

    # Referencing the `email` column object (not the string "email") is what
    # makes this a functional index on lower(email) rather than nonsense.
    __table_args__ = (
        Index("uq_users_email_lower", func.lower(email), unique=True),
        Index("uq_users_pos_username_lower", func.lower(pos_username), unique=True),
    )
