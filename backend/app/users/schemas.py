"""Pydantic schemas for user accounts."""

from __future__ import annotations

import re

from pydantic import BaseModel, Field, field_validator, model_validator

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
    pos_username: str | None = Field(default=None, min_length=3, max_length=64)
    pos_pin: str | None = Field(default=None, pattern=r"^\d{4,12}$")

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        return normalise_email(value)

    @model_validator(mode="after")
    def _pos_credentials_together(self) -> UserCreate:
        if (self.pos_username is None) != (self.pos_pin is None):
            raise ValueError("POS username and PIN must be configured together.")
        if self.pos_username is not None:
            self.pos_username = normalise_pos_username(self.pos_username)
        return self


class UserUpdate(BaseModel):
    email: str | None = None
    full_name: str | None = Field(default=None, min_length=1, max_length=255)
    role_id: int | None = None

    @field_validator("email")
    @classmethod
    def _email(cls, value: str | None) -> str | None:
        return normalise_email(value) if value is not None else None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=255)


class AdminPasswordReset(BaseModel):
    temporary_password: str = Field(min_length=12, max_length=255)


def normalise_pos_username(value: str) -> str:
    value = value.strip().lower()
    if not re.fullmatch(r"[a-z0-9._-]{3,64}", value):
        raise ValueError("Invalid POS username.")
    return value


class PosCredentialsUpdate(BaseModel):
    pos_username: str = Field(min_length=3, max_length=64)
    pos_pin: str = Field(pattern=r"^\d{4,12}$")

    @field_validator("pos_username")
    @classmethod
    def _pos_username(cls, value: str) -> str:
        return normalise_pos_username(value)


class UserRead(BaseModel):
    id: int
    email: str
    full_name: str
    is_active: bool
    must_change_password: bool
    role_id: int
    role_name: str
    pos_username: str | None
    pos_pin_configured: bool
