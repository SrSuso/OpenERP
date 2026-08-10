"""The registry's own guard rails.

The point of `app.settings.registry` is that the admin panel renders
itself from it, which makes it very easy to add an option that looks
configurable and changes nothing. These tests make that a build failure
instead of a customer discovering it.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from app.settings.registry import SETTINGS, SETTINGS_BY_KEY, SettingDef, SettingType

_REPO = Path(__file__).resolve().parents[2]
_SEARCH_ROOTS = (_REPO / "backend" / "app", _REPO / "frontend" / "src")
#: El módulo que las declara no cuenta como uso.
_REGISTRY_FILE = _REPO / "backend" / "app" / "settings" / "registry.py"


def _files_mentioning(key: str) -> set[Path]:
    """Every source file that names ``key``, via git grep (fast, and it
    already ignores build output and dependencies)."""
    result = subprocess.run(
        ["git", "grep", "--name-only", "--fixed-strings", key, "--", *map(str, _SEARCH_ROOTS)],
        cwd=_REPO,
        capture_output=True,
        text=True,
        check=False,
    )
    return {(_REPO / line).resolve() for line in result.stdout.splitlines() if line}


@pytest.mark.parametrize("definition", SETTINGS, ids=lambda d: d.key)
def test_every_option_is_actually_read_somewhere(definition: SettingDef) -> None:
    """An option nobody reads is worse than no option: it tells the shop
    owner they changed something when they didn't."""
    key = definition.key
    users = _files_mentioning(key) - {_REGISTRY_FILE.resolve()}
    assert users, (
        f'El ajuste "{key}" no se lee en ningún sitio: saldría en el panel y no '
        f"haría nada. Conéctalo donde aplique o quítalo del registro."
    )


def test_keys_are_unique() -> None:
    assert len(SETTINGS_BY_KEY) == len(SETTINGS)


@pytest.mark.parametrize("definition", SETTINGS, ids=lambda d: d.key)
def test_default_round_trips_through_its_own_type(definition: SettingDef) -> None:
    """`serialise` then `parse` has to give back the same value — that pair
    is what the API and the database rely on for every option."""
    d = definition
    assert d.parse(d.serialise(d.default)) == d.default


@pytest.mark.parametrize("definition", SETTINGS, ids=lambda d: d.key)
def test_enums_offer_choices_and_a_valid_default(definition: SettingDef) -> None:
    d = definition
    if d.type is not SettingType.ENUM:
        return
    values = [c.value for c in d.choices]
    assert values, f"{d.key} es un desplegable sin opciones."
    assert d.default in values, f"{d.key}: el valor por defecto no está entre las opciones."


@pytest.mark.parametrize("definition", SETTINGS, ids=lambda d: d.key)
def test_every_option_is_explained_in_spanish(definition: SettingDef) -> None:
    """El dueño de la tienda lee esto, no un programador."""
    d = definition
    assert d.label.strip(), f"{d.key} no tiene etiqueta."
    assert len(d.help.strip()) > 20, (
        f"{d.key}: la ayuda es demasiado escueta para que alguien sepa qué hace."
    )
