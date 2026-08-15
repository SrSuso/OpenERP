"""Pydantic schemas for login, the current session and its siblings."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.users.schemas import normalise_email, normalise_pos_username


class LoginRequest(BaseModel):
    email: str
    password: str = Field(min_length=1)

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        return normalise_email(value)


class PosLoginRequest(BaseModel):
    username: str
    pin: str = Field(pattern=r"^\d{4,12}$")

    @field_validator("username")
    @classmethod
    def _username(cls, value: str) -> str:
        return normalise_pos_username(value)


class PosLoginUser(BaseModel):
    """Public, deliberately minimal identity used by the shared POS screen."""

    id: int
    full_name: str
    username: str


class MeResponse(BaseModel):
    """The signed-in user plus their effective permissions, so the frontend
    can build its nav and route guards from one call instead of re-deriving
    role membership on every page."""

    id: int
    email: str
    full_name: str
    role: str
    permissions: list[str]
    must_change_password: bool


class SessionRead(BaseModel):
    id: int
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    user_agent: str | None
    ip: str | None
    is_current: bool
