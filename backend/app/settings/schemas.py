"""Pydantic schemas for business settings in the admin panel."""

from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel

from app.settings.registry import SettingType

# --- ajustes de negocio (app.settings.registry) ----------------------------


class SettingChoiceRead(BaseModel):
    value: str
    label: str


class SettingDefinitionRead(BaseModel):
    """Una opción con todo lo que el panel necesita para pintarla sola: qué
    es, cómo se llama en castellano, de qué tipo, qué vale ahora y entre qué
    límites. Ver app.settings.registry."""

    key: str
    group: str
    label: str
    help: str
    type: SettingType
    #: Siempre en forma de texto; el panel lo interpreta según `type`. Un
    #: `SECRET` viene siempre vacío: se escribe, no se lee.
    value: str
    #: Sólo para `SECRET`: si hay algo guardado, para que el panel pueda
    #: decir "guardada" sin enseñar el qué.
    is_set: bool = False
    default: str
    choices: list[SettingChoiceRead]
    minimum: Decimal | None
    maximum: Decimal | None
    caution: str | None


class SettingsOptionsRead(BaseModel):
    #: Orden en que se pintan las tarjetas.
    groups: list[str]
    settings: list[SettingDefinitionRead]


class SettingsUpdate(BaseModel):
    """Sólo las claves presentes se tocan — el panel puede guardar una
    tarjeta sin mandar el resto de la pantalla."""

    values: dict[str, str]


class ColdDrinkSurchargeUpdate(BaseModel):
    """El único ajuste delegable de bebida fría.

    Un modelo dedicado impide que el permiso específico se pueda reutilizar
    para enviar por accidente otras claves del registro general.
    """

    amount: str
