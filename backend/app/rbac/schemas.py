"""Pydantic schemas for role and permission management."""

from __future__ import annotations

from pydantic import BaseModel, Field


class PermissionRead(BaseModel):
    id: int
    key: str
    description: str


class RoleRead(BaseModel):
    id: int
    name: str
    description: str
    permissions: list[str]


class RoleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    description: str = Field(default="", max_length=255)


class RolePermissionsUpdate(BaseModel):
    permission_keys: list[str]
