"""Pydantic schemas for the report builder."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.reports.rules import ReportFilters, ReportSubject


class ReportFieldInfo(BaseModel):
    key: str
    label: str


class ReportSubjectInfo(BaseModel):
    subject: ReportSubject
    label: str
    dimensions: list[ReportFieldInfo]
    metrics: list[ReportFieldInfo]
    filter_keys: list[str]


class ReportRunRequest(BaseModel):
    subject: ReportSubject
    dimensions: list[str] = Field(default_factory=list)
    metrics: list[str] = Field(min_length=1)
    filters: ReportFilters = Field(default_factory=ReportFilters)


class ReportRunResult(BaseModel):
    #: Ordered output keys — the frontend renders table columns in this
    #: order rather than however a Python dict happens to iterate.
    columns: list[str]
    rows: list[dict[str, Any]]


class ReportDefinitionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    subject: ReportSubject
    dimensions: list[str] = Field(default_factory=list)
    metrics: list[str] = Field(min_length=1)
    filters: ReportFilters = Field(default_factory=ReportFilters)


class ReportDefinitionRead(BaseModel):
    id: int
    name: str
    subject: ReportSubject
    dimensions: list[str]
    metrics: list[str]
    filters: ReportFilters
    created_at: datetime
