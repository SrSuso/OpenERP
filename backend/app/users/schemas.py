"""Pydantic schemas for user accounts."""

from __future__ import annotations

import re

from pydantic import BaseModel, Field, field_validator

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalise_email(value: str) -> str:
    """Trim and lowercase an email, rejecting anything that isn't shaped like
    one. Used everywhere an email is accepted so ``users.email`` is always
    stored lowercase and lookups never need ``lower()`` at query time."""
    value = value.strip().lower()
    if not _EMAIL_RE.match(value):
        raise ValueError("Invalid email address.")
    return value


class UserCreate(BaseModel):
    email: str
    full_name: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=8, max_length=255)
    role_id: int

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        return normalise_email(value)


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=255)
    role_id: int | None = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=255)


class AdminPasswordReset(BaseModel):
    temporary_password: str = Field(min_length=12, max_length=255)


class UserRead(BaseModel):
    id: int
    email: str
    full_name: str
    is_active: bool
    must_change_password: bool
    role_id: int
    role_name: str
