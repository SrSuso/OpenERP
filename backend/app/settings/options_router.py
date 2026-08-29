"""The registry-backed settings endpoints.

`GET /settings/options` serves the catalogue *and* the current values in
one response, so the admin panel can render the whole screen — groups,
labels, help text, field types, choices, ranges — without knowing what
any individual option is. Adding an option to `app.settings.registry`
therefore shows up in the panel on its own.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app.audit import service as audit
from app.auth.dependencies import CurrentUser, SessionDep
from app.core.errors import ValidationError
from app.rbac.dependencies import require_permission
from app.rbac.permissions import POS_COLD_DRINK_SURCHARGE_MANAGE, SETTINGS_MANAGE, SETTINGS_READ
from app.settings import store
from app.settings.registry import GROUPS, SETTINGS, SETTINGS_BY_KEY, SettingDef, SettingType
from app.settings.schemas import (
    ColdDrinkSurchargeUpdate,
    SettingChoiceRead,
    SettingDefinitionRead,
    SettingsOptionsRead,
    SettingsUpdate,
)

router = APIRouter(tags=["settings"])

_require_read = Depends(require_permission(SETTINGS_READ))
_require_manage = Depends(require_permission(SETTINGS_MANAGE))
_require_cold_drink_surcharge_manage = Depends(require_permission(POS_COLD_DRINK_SURCHARGE_MANAGE))

COLD_DRINK_SURCHARGE_KEY = "pos.cold_drink_surcharge_amount"
POS_SURCHARGE_KEYS = (
    COLD_DRINK_SURCHARGE_KEY,
    "pos.large_bag_surcharge_amount",
    "pos.medium_bag_surcharge_amount",
    "pos.small_bag_surcharge_amount",
)


def _definition_to_read(definition: SettingDef, value: Any) -> SettingDefinitionRead:
    # Future functional secrets can use this presentation rule. Infrastructure
    # credentials cannot be registered here in the first place.
    is_secret = definition.type is SettingType.SECRET
    return SettingDefinitionRead(
        key=definition.key,
        group=definition.group,
        label=definition.label,
        help=definition.help,
        type=definition.type,
        value="" if is_secret else definition.serialise(value),
        is_set=bool(definition.serialise(value)) if is_secret else False,
        default="" if is_secret else definition.serialise(definition.default),
        choices=[SettingChoiceRead(value=c.value, label=c.label) for c in definition.choices],
        minimum=definition.minimum,
        maximum=definition.maximum,
        caution=definition.caution,
    )


async def _current(session: SessionDep) -> SettingsOptionsRead:
    values = await store.get_values(session)
    return SettingsOptionsRead(
        groups=list(GROUPS),
        settings=[_definition_to_read(d, values[d.key]) for d in SETTINGS],
    )


@router.get("/settings/options", response_model=SettingsOptionsRead, dependencies=[_require_read])
async def list_options(session: SessionDep) -> SettingsOptionsRead:
    return await _current(session)


@router.get("/settings/values", response_model=dict[str, str])
async def list_values(session: SessionDep, user: CurrentUser) -> dict[str, str]:
    """Just the values, for anyone signed in — the till has to know the
    shop's name and which payment button starts selected, and a cashier
    does not (and should not) hold `settings.read`, which is what gates the
    editable catalogue above.

    Cualquier futura opción `SECRET` queda fuera por construcción. La
    infraestructura y las credenciales SMTP no forman parte de este registro:
    proceden exclusivamente del entorno del proceso.
    """
    values = await store.get_values(session)
    return {d.key: d.serialise(values[d.key]) for d in SETTINGS if d.type is not SettingType.SECRET}


async def _cold_drink_surcharge_definition(session: SessionDep) -> SettingDefinitionRead:
    values = await store.get_values(session)
    definition = SETTINGS_BY_KEY[COLD_DRINK_SURCHARGE_KEY]
    return _definition_to_read(definition, values[definition.key])


async def _pos_surcharges(session: SessionDep) -> SettingsOptionsRead:
    values = await store.get_values(session)
    definitions = [SETTINGS_BY_KEY[key] for key in POS_SURCHARGE_KEYS]
    return SettingsOptionsRead(
        groups=list(dict.fromkeys(definition.group for definition in definitions)),
        settings=[
            _definition_to_read(definition, values[definition.key]) for definition in definitions
        ],
    )


@router.get(
    "/settings/pos/cold-drink-surcharge",
    response_model=SettingDefinitionRead,
    dependencies=[_require_cold_drink_surcharge_manage],
)
async def get_cold_drink_surcharge(session: SessionDep) -> SettingDefinitionRead:
    """Read only the surcharge delegated to a POS supervisor role."""
    return await _cold_drink_surcharge_definition(session)


@router.put(
    "/settings/pos/cold-drink-surcharge",
    response_model=SettingDefinitionRead,
    dependencies=[_require_cold_drink_surcharge_manage],
)
async def update_cold_drink_surcharge(
    payload: ColdDrinkSurchargeUpdate, session: SessionDep
) -> SettingDefinitionRead:
    """Change only the price added per cold-drink unit in the POS.

    The specific permission intentionally grants both view and edit access:
    showing an amount that cannot be maintained would not be useful for the
    delegated operational role.
    """
    before = await store.get_value(session, COLD_DRINK_SURCHARGE_KEY)
    after = await store.update_values(session, {COLD_DRINK_SURCHARGE_KEY: payload.amount})
    await audit.record(
        session,
        action="settings_changed",
        entity_type="settings",
        entity_id=None,
        after={
            COLD_DRINK_SURCHARGE_KEY: {
                "antes": str(before),
                "ahora": str(after[COLD_DRINK_SURCHARGE_KEY]),
            }
        },
    )
    return await _cold_drink_surcharge_definition(session)


@router.get(
    "/settings/pos/surcharges",
    response_model=SettingsOptionsRead,
    dependencies=[_require_cold_drink_surcharge_manage],
)
async def get_pos_surcharges(session: SessionDep) -> SettingsOptionsRead:
    """Read the fixed POS supplements delegated to a till supervisor."""
    return await _pos_surcharges(session)


@router.put(
    "/settings/pos/surcharges",
    response_model=SettingsOptionsRead,
    dependencies=[_require_cold_drink_surcharge_manage],
)
async def update_pos_surcharges(
    payload: SettingsUpdate, session: SessionDep
) -> SettingsOptionsRead:
    """Change one or more fixed POS supplements, and nothing else."""
    invalid_keys = sorted(set(payload.values) - set(POS_SURCHARGE_KEYS))
    if invalid_keys:
        raise ValidationError(f"Ajustes no permitidos: {', '.join(invalid_keys)}.")
    before = await store.get_values(session)
    after = await store.update_values(session, payload.values)
    await audit.record(
        session,
        action="settings_changed",
        entity_type="settings",
        entity_id=None,
        after={
            key: {"antes": str(before[key]), "ahora": str(after[key])} for key in payload.values
        },
    )
    return await _pos_surcharges(session)


@router.put("/settings/options", response_model=SettingsOptionsRead, dependencies=[_require_manage])
async def update_options(payload: SettingsUpdate, session: SessionDep) -> SettingsOptionsRead:
    """Only the keys present in ``values`` are touched, and the whole batch
    is validated before anything is written — a screenful of edits either
    saves completely or not at all."""
    before = await store.get_values(session)
    after = await store.update_values(session, payload.values)
    changed = {k: {"antes": str(before[k]), "ahora": str(after[k])} for k in payload.values}
    await audit.record(
        session,
        action="settings_changed",
        entity_type="settings",
        entity_id=None,
        after=changed,
    )
    return await _current(session)
