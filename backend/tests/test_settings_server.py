"""Los ajustes del `.env`, ahora también en el panel.

Lo que importa: que un valor guardado mande sobre el fichero de arranque,
que uno malo no impida arrancar, y que lo que es secreto no salga al
leerlo.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient

from app.core.config import Settings
from app.settings import server
from app.settings.registry import SETTINGS_BY_KEY, SettingType


def _settings() -> Settings:
    return Settings(database_url="postgresql://openerp:openerp@127.0.0.1:5432/openerp")


def test_a_stored_value_wins_over_the_env_file() -> None:
    applied = server.apply(_settings(), {"server.session_ttl_days": "7"})

    assert applied.settings.session_ttl_days == 7
    assert applied.keys == ("server.session_ttl_days",)


def test_a_bad_value_is_dropped_without_taking_the_good_ones_with_it() -> None:
    """Un cero mal puesto en el tamaño del pool no puede dejar la tienda sin
    caja: se ignora ése y se aplican los demás."""
    applied = server.apply(
        _settings(),
        {"server.db_pool_size": "no soy un número", "server.log_level": "WARNING"},
    )

    assert applied.settings.db_pool_size == 5  # el del .env
    assert applied.settings.log_level == "WARNING"
    assert applied.keys == ("server.log_level",)


def test_an_empty_value_leaves_the_env_file_alone() -> None:
    """Vacío es "no lo toco" — así se puede dejar en blanco el recuadro de
    una contraseña sin borrar la que hay."""
    applied = server.apply(_settings(), {"server.session_cookie_name": ""})

    assert applied.settings.session_cookie_name == "openerp_session"
    assert applied.keys == ()


def test_the_cors_list_is_split_on_commas() -> None:
    applied = server.apply(
        _settings(), {"server.cors_origins": "https://tienda.example, https://caja.example"}
    )

    assert applied.settings.cors_origins == ["https://tienda.example", "https://caja.example"]


def test_every_server_setting_maps_to_a_real_field() -> None:
    """Un ajuste que apunte a un campo que no existe saldría en el panel y
    no haría nada."""
    fields = Settings.model_fields
    for key, field in server.SERVER_SETTING_FIELDS.items():
        assert key in SETTINGS_BY_KEY, f"{key} no está en el registro"
        assert field in fields, f"{key} apunta a {field}, que no existe en Settings"


async def test_secrets_can_be_written_but_never_read_back(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    saved = await client.put(
        "/api/v1/settings/options",
        json={"values": {"server.bootstrap_admin_password": "una-contraseña-larga"}},
    )
    assert saved.status_code == 200

    option = next(
        s
        for s in (await client.get("/api/v1/settings/options")).json()["settings"]
        if s["key"] == "server.bootstrap_admin_password"
    )
    assert option["type"] == SettingType.SECRET
    assert option["value"] == ""
    # Pero se sabe que hay algo guardado, para poder decirlo en pantalla.
    assert option["is_set"] is True


async def test_secrets_stay_out_of_the_staff_wide_values(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """`/settings/values` lo lee cualquiera que haya entrado, cajeros
    incluidos: ahí no puede viajar una contraseña."""
    await login(role_name="ADMIN")
    await client.put(
        "/api/v1/settings/options",
        json={"values": {"server.bootstrap_admin_password": "una-contraseña-larga"}},
    )

    await login(role_name="CASHIER")
    values = (await client.get("/api/v1/settings/values")).json()

    assert "server.bootstrap_admin_password" not in values
    assert "server.database_url" not in values
    # Lo que no es secreto sí sigue estando.
    assert "app.display_name" in values
    assert "server.log_level" in values
