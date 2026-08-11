"""Los ajustes que hasta ahora sólo estaban en el `.env`, también en el
panel.

Se guardan como cualquier otra opción del registro (una fila en
``settings``), pero no los lee nadie en caliente: son los que construyen
el motor de base de datos, los middlewares y el registro de sucesos, y eso
pasa una sola vez al arrancar. Así que el arranque los lee de la base de
datos y los mete en el objeto `Settings` *antes* de montar nada — por eso
cada uno lleva escrito en su ayuda que hay que reiniciar.

Tres decisiones que hacen que esto no sea un pie de cañón:

* Un valor guardado que no se pueda aplicar **no impide arrancar**: se
  anota en el registro de sucesos y se sigue con el del `.env`. Un cero
  mal puesto en el tamaño del pool no puede dejar la tienda sin caja.
* La dirección de la base de datos se aplica igual, pero sólo si se puede
  conectar con ella; si no, se vuelve a la del `.env`. Es el único ajuste
  que se necesita a sí mismo para leerse, y por eso es el único que se
  comprueba antes de usarlo.
* La contraseña del administrador inicial y la dirección de la base de
  datos (que lleva usuario y contraseña dentro) son `SECRET`: se pueden
  escribir desde el panel, pero no salen nunca al leer.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.core.config import Settings
from app.core.logging import get_logger

logger = get_logger(__name__)

#: Clave del registro -> campo de `Settings`. Sólo estos se aplican al
#: arrancar; el resto de opciones son de negocio y se leen en caliente.
SERVER_SETTING_FIELDS: dict[str, str] = {
    "server.app_name": "app_name",
    "server.environment": "environment",
    "server.debug": "debug",
    "server.database_url": "database_url",
    "server.db_pool_size": "db_pool_size",
    "server.db_max_overflow": "db_max_overflow",
    "server.db_pool_pre_ping": "db_pool_pre_ping",
    "server.db_echo": "db_echo",
    "server.db_statement_timeout_ms": "db_statement_timeout_ms",
    "server.log_level": "log_level",
    "server.log_format": "log_format",
    "server.cors_origins": "cors_origins",
    "server.session_cookie_name": "session_cookie_name",
    "server.session_ttl_days": "session_ttl_days",
    "server.session_touch_interval_seconds": "session_touch_interval_seconds",
    "server.bootstrap_admin_email": "bootstrap_admin_email",
    "server.bootstrap_admin_password": "bootstrap_admin_password",
    "server.login_rate_limit_max_attempts": "login_rate_limit_max_attempts",
    "server.login_rate_limit_window_seconds": "login_rate_limit_window_seconds",
    "server.login_rate_limit_ip_max_attempts": "login_rate_limit_ip_max_attempts",
    "server.login_rate_limit_ip_window_seconds": "login_rate_limit_ip_window_seconds",
}


@dataclass(frozen=True)
class Applied:
    settings: Settings
    #: Claves que se han aplicado de verdad, para dejarlo dicho en el
    #: arranque: si algo no va como se espera, lo primero es saber qué
    #: valores no venían del `.env`.
    keys: tuple[str, ...]


def _coerce(field: str, raw: str) -> Any:
    """De cadena guardada al tipo que espera `Settings`. Pydantic valida
    de verdad al construir el objeto; esto sólo deshace lo que el registro
    aplanó a texto."""
    if field == "cors_origins":
        return [origin.strip() for origin in raw.split(",") if origin.strip()]
    return raw


def apply(settings: Settings, stored: dict[str, str]) -> Applied:
    """`settings` con los valores guardados encima. Los que no se puedan
    aplicar se descartan de uno en uno, no en bloque: un valor malo no
    tiene por qué llevarse por delante a los buenos."""
    data = settings.model_dump()
    applied: list[str] = []

    for key, field in SERVER_SETTING_FIELDS.items():
        raw = stored.get(key)
        # Vacío = "no lo toco", que es lo que hace falta para poder dejar en
        # blanco una contraseña sin borrarla, y para no pisar el `.env` con
        # el valor por defecto de una opción que nadie ha rellenado.
        if raw is None or raw == "":
            continue
        candidate = dict(data)
        candidate[field] = _coerce(field, raw)
        try:
            Settings(**candidate)
        # Cualquier fallo de validación de pydantic, que son varios tipos.
        except Exception as error:
            logger.warning(
                "settings.server.ignored",
                extra={"setting": key, "reason": str(error)},
            )
            continue
        data = candidate
        applied.append(key)

    return Applied(settings=Settings(**data), keys=tuple(applied))


def _stored_values(database_url: str) -> dict[str, str]:
    """Las filas de `settings` leídas con una conexión suelta y síncrona.

    No se usa el motor de la aplicación porque esto pasa *antes* de
    construirlo: precisamente uno de los valores que se leen aquí es con qué
    construirlo. Cualquier fallo (base de datos apagada, tabla todavía sin
    migrar en el primer arranque) devuelve un diccionario vacío: sin
    ajustes guardados, la aplicación arranca con el `.env` de siempre, que
    es exactamente lo que hacía antes de todo esto.
    """
    import psycopg

    try:
        with (
            psycopg.connect(database_url, connect_timeout=5) as connection,
            connection.cursor() as cursor,
        ):
            cursor.execute("SELECT key, value FROM settings WHERE key LIKE 'server.%%'")
            return {str(key): str(value) for key, value in cursor.fetchall()}
    except Exception as error:
        logger.info("settings.server.not_loaded", extra={"reason": str(error)})
        return {}


def _connects(database_url: str) -> bool:
    import psycopg

    try:
        with psycopg.connect(database_url, connect_timeout=5):
            return True
    except Exception as error:
        logger.warning(
            "settings.server.database_url_ignored",
            extra={"reason": str(error)},
        )
        return False


def load(settings: Settings) -> Settings:
    """Punto de entrada del arranque: `settings` del `.env`, con lo que haya
    guardado en el panel por encima.

    La dirección de la base de datos se comprueba conectando antes de
    usarla —es la única que puede dejar la aplicación sin arrancar— y, si
    no responde, se descarta y se sigue con la del `.env`.
    """
    stored = _stored_values(settings.sync_database_url)
    if not stored:
        return settings

    new_url = stored.get("server.database_url", "")
    if new_url and new_url != settings.database_url:
        probe = Settings(**{**settings.model_dump(), "database_url": new_url})
        if not _connects(probe.sync_database_url):
            stored = {k: v for k, v in stored.items() if k != "server.database_url"}

    applied = apply(settings, stored)
    if applied.keys:
        logger.info("settings.server.applied", extra={"settings": list(applied.keys)})
    return applied.settings
