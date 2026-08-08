"""Pydantic schemas for dashboards and their widgets."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator
from pydantic import ValidationError as PydanticValidationError

from app.dashboards.metrics import MetricKey, validate_params

ChartType = Literal["kpi", "line", "bar", "table"]


class DashboardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class DashboardWidgetCreate(BaseModel):
    metric: MetricKey
    title: str = Field(min_length=1, max_length=100)
    #: Validated below against ``metric``'s own params schema — see
    #: ``app.dashboards.metrics`` for why this is the only door into a
    #: query, never a raw SQL fragment.
    params: dict[str, Any] = Field(default_factory=dict)
    chart_type: ChartType
    display_order: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def _params_must_fit_the_metric(self) -> DashboardWidgetCreate:
        try:
            validate_params(self.metric, self.params)
        except PydanticValidationError as exc:
            raise ValueError(f"params does not fit metric {self.metric!r}: {exc}") from exc
        return self


class DashboardWidgetRead(BaseModel):
    id: int
    dashboard_id: int
    metric: MetricKey
    title: str
    params: dict[str, Any]
    chart_type: str
    display_order: int


class DashboardRead(BaseModel):
    id: int
    name: str
    owner_user_id: int | None
    widgets: list[DashboardWidgetRead]


class WidgetDataRead(BaseModel):
    """The live result of running a widget's metric — shape depends on
    which metric it is (a single KPI dict, or a list of rows for a
    chart/table); always freshly queried, never cached (see
    ``app.dashboards.service.get_widget_data``)."""

    data: Any


class MetricDescriptorRead(BaseModel):
    """What a metric needs to be configured — lets the admin UI build a
    form for a new widget without hard-coding each metric's params."""

    key: MetricKey
    params_schema: dict[str, Any]
