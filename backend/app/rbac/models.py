"""Roles and permissions.

Authorisation is data-driven: permissions are looked up by a stable string
key (e.g. ``"users.manage"``), never by role name in application code. See
:mod:`app.rbac.permissions` for the known catalogue of keys and
:func:`app.rbac.dependencies.require_permission` for the check every
protected router depends on (rule 11 — permissions are always verified in
the backend).
"""

from __future__ import annotations

from sqlalchemy import BigInteger, Column, ForeignKey, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IntPrimaryKeyMixin, TimestampMixin

role_permissions = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", BigInteger, ForeignKey("roles.id"), primary_key=True),
    Column("permission_id", BigInteger, ForeignKey("permissions.id"), primary_key=True),
)


class Role(IntPrimaryKeyMixin, TimestampMixin, Base):
    """A named bundle of permissions.

    One role per user in phase 1 — kept deliberately simple; nothing about
    the shape below prevents a future many-to-many ``user_roles`` if that
    turns out to be needed, since permission checks only ever go through
    :func:`app.rbac.dependencies.require_permission`, never a hardcoded role
    name.
    """

    __tablename__ = "roles"

    name: Mapped[str] = mapped_column(String(50), unique=True)
    description: Mapped[str] = mapped_column(String(255), default="")

    permissions: Mapped[list[Permission]] = relationship(
        secondary=role_permissions, back_populates="roles", order_by="Permission.key"
    )


class Permission(IntPrimaryKeyMixin, TimestampMixin, Base):
    """A single grantable capability, keyed by a stable string."""

    __tablename__ = "permissions"

    key: Mapped[str] = mapped_column(String(100), unique=True)
    description: Mapped[str] = mapped_column(String(255), default="")

    roles: Mapped[list[Role]] = relationship(
        secondary=role_permissions, back_populates="permissions"
    )
