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
from app.rbac.dependencies import require_permission
from app.rbac.permissions import SETTINGS_MANAGE, SETTINGS_READ
from app.settings import store
from app.settings.registry import GROUPS, SETTINGS, SettingDef, SettingType
from app.settings.schemas import (
    SettingChoiceRead,
    SettingDefinitionRead,
    SettingsOptionsRead,
    SettingsUpdate,
)

router = APIRouter(tags=["settings"])

_require_read = Depends(require_permission(SETTINGS_READ))
_require_manage = Depends(require_permission(SETTINGS_MANAGE))


def _definition_to_read(definition: SettingDef, value: Any) -> SettingDefinitionRead:
    # Un SECRET (una contraseña, una cadena de conexión) se puede escribir
    # desde el panel pero no sale nunca al leer: sólo si hay algo guardado.
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

    Los `SECRET` (contraseñas, la cadena de conexión) se quedan fuera: son
    lo único del registro que no puede ver cualquiera que esté dentro. El
    resto son etiquetas, formatos e interruptores, y la mayoría van
    impresos en el ticket del cliente. Las credenciales de correo siguen
    donde estaban, en los endpoints SMTP de `app.settings.router`, que sólo
    ve un administrador.
    """
    values = await store.get_values(session)
    return {d.key: d.serialise(values[d.key]) for d in SETTINGS if d.type is not SettingType.SECRET}


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
