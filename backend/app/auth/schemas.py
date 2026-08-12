"""Pydantic schemas for login, the current session and its siblings."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.users.schemas import normalise_email


class LoginRequest(BaseModel):
    email: str
    password: str = Field(min_length=1)

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        return normalise_email(value)


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
