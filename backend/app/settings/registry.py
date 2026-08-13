"""The catalogue of everything a shop owner can configure.

One entry per option, declared here and **only** here: the database
stores nothing but the overrides (`app.settings.models.Setting`), the API
serves this catalogue alongside the current values, and the admin panel
renders the whole screen from it. Adding a new option is one
`SettingDef` below plus reading it wherever it applies — never a
migration, never a new form field, never a new endpoint.

Labels and help text live here, in Spanish, because they are what the
shop owner actually reads; the rest of the codebase stays in English.

Two rules that keep this honest:

* Every option here **must** be read somewhere. An option that changes
  nothing is worse than no option at all, so `tests/test_settings_registry.py`
  fails the build if a key is never used outside this module.
* Anything that has its own screen already (impuestos, unidades,
  categorías, plantillas de ticket, almacenes, usuarios, reglas de aviso)
  stays on that screen. This is for the loose knobs that had nowhere to
  live.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from enum import StrEnum
from typing import Any

from app.core.business_time import parse_timezone


class SettingType(StrEnum):
    BOOL = "BOOL"
    INT = "INT"
    DECIMAL = "DECIMAL"
    #: One line of text.
    STRING = "STRING"
    #: Several lines (the panel renders a textarea).
    TEXT = "TEXT"
    #: One of `SettingDef.choices`.
    ENUM = "ENUM"
    #: IANA name (Europe/Madrid, Europe/Lisbon, UTC), resolved by zoneinfo.
    TIMEZONE = "TIMEZONE"
    #: Un color, en hexadecimal (`#22c55e`). El panel lo pinta como un
    #: cuadro de colores: nadie tiene por qué saberse un hexadecimal para
    #: elegir el verde que quiere.
    COLOR = "COLOR"
    #: Como STRING, pero no sale nunca al leer: se puede escribir desde el
    #: panel y ahí se queda (contraseñas, cadenas de conexión). El panel
    #: enseña si hay algo guardado, no el qué.
    SECRET = "SECRET"


@dataclass(frozen=True)
class Choice:
    value: str
    label: str


@dataclass(frozen=True)
class SettingDef:
    key: str
    #: Which card of the settings screen this belongs on. Free text on
    #: purpose — grouping is a presentation decision, not a schema one.
    group: str
    label: str
    help: str
    type: SettingType
    default: Any
    choices: tuple[Choice, ...] = ()
    minimum: Decimal | None = None
    maximum: Decimal | None = None
    #: Shown as a warning next to the field. For the handful of options
    #: that change what the till charges or what the law requires.
    caution: str | None = None

    def parse(self, raw: str) -> Any:
        """Turn the stored string into the value the app uses. Raises
        ``ValueError`` with a message meant for the person editing it."""
        if self.type is SettingType.BOOL:
            if raw not in ("true", "false"):
                raise ValueError("Tiene que ser verdadero o falso.")
            return raw == "true"
        if self.type is SettingType.INT:
            try:
                value = int(raw)
            except ValueError:
                raise ValueError("Tiene que ser un número entero.") from None
            self._check_range(Decimal(value))
            return value
        if self.type is SettingType.DECIMAL:
            try:
                value_dec = Decimal(raw)
            except InvalidOperation:
                raise ValueError("Tiene que ser un número.") from None
            self._check_range(value_dec)
            return value_dec
        if self.type is SettingType.COLOR:
            if not re.fullmatch(r"#[0-9A-Fa-f]{6}", raw):
                raise ValueError("Tiene que ser un color.")
            return raw
        if self.type is SettingType.ENUM:
            if raw not in [c.value for c in self.choices]:
                allowed = ", ".join(c.label for c in self.choices)
                raise ValueError(f"Tiene que ser una de estas opciones: {allowed}.")
            return raw
        if self.type is SettingType.TIMEZONE:
            parse_timezone(raw)
            return raw
        return raw

    def _check_range(self, value: Decimal) -> None:
        if self.minimum is not None and value < self.minimum:
            raise ValueError(f"No puede ser menor que {self.minimum}.")
        if self.maximum is not None and value > self.maximum:
            raise ValueError(f"No puede ser mayor que {self.maximum}.")

    def serialise(self, value: Any) -> str:
        if self.type is SettingType.BOOL:
            return "true" if value else "false"
        return str(value)


GROUP_STORE = "Datos de la tienda"
GROUP_POS = "Caja (TPV)"
GROUP_SALES = "Ventas"
GROUP_CATALOG = "Productos"
GROUP_NOTIFICATIONS = "Avisos"
GROUP_UI = "Pantalla"
#: Lo que hasta ahora sólo estaba en el `.env`. No se lee en caliente: hace
#: falta reiniciar para que surta efecto, y así lo dice cada opción. Ver
#: `app.settings.server`.
GROUP_SERVER = "Servidor (avanzado)"

_RESTART = "Hay que reiniciar el servidor para que este cambio surta efecto."


_SERVER_SETTINGS: tuple[SettingDef, ...] = (
    SettingDef(
        key="server.app_name",
        group=GROUP_SERVER,
        label="Nombre interno de la aplicación",
        help="Sale en la documentación de la API y en el registro de sucesos, no en el ticket.",
        type=SettingType.STRING,
        default="OpenERP",
        caution=_RESTART,
    ),
    SettingDef(
        key="server.environment",
        group=GROUP_SERVER,
        label="Tipo de instalación",
        help=(
            'En "producción" la sesión sólo viaja por HTTPS. Cambiarlo a otra cosa en la '
            "tienda de verdad debilita la seguridad."
        ),
        type=SettingType.ENUM,
        default="production",
        choices=(
            Choice("production", "Producción (la tienda)"),
            Choice("local", "Local (desarrollo)"),
            Choice("ci", "Integración continua"),
            Choice("test", "Pruebas"),
        ),
        caution=_RESTART,
    ),
    SettingDef(
        key="server.debug",
        group=GROUP_SERVER,
        label="Modo depuración",
        help="Sólo para buscar un fallo. Déjalo apagado en la tienda.",
        type=SettingType.BOOL,
        default=False,
        caution=_RESTART,
    ),
    SettingDef(
        key="server.database_url",
        group=GROUP_SERVER,
        label="Dirección de la base de datos",
        help=(
            "Dónde vive todo lo que guarda la aplicación. Sólo se usa si se puede conectar "
            "con ella: si no, se vuelve a la del fichero de arranque, para que un error de "
            "tecleo no deje la tienda sin caja. No se muestra porque lleva la contraseña."
        ),
        type=SettingType.SECRET,
        default="",
        caution="Si te equivocas aquí, la aplicación sigue arrancando con la dirección de antes.",
    ),
    SettingDef(
        key="server.db_pool_size",
        group=GROUP_SERVER,
        label="Conexiones permanentes a la base de datos",
        help="Cuántas se mantienen abiertas. Con una tienda y un par de cajas, 5 sobra.",
        type=SettingType.INT,
        default=5,
        minimum=Decimal(1),
        maximum=Decimal(100),
        caution=_RESTART,
    ),
    SettingDef(
        key="server.db_max_overflow",
        group=GROUP_SERVER,
        label="Conexiones extra en un apuro",
        help="Las que se abren de más cuando todas las permanentes están ocupadas.",
        type=SettingType.INT,
        default=10,
        minimum=Decimal(0),
        maximum=Decimal(100),
        caution=_RESTART,
    ),
    SettingDef(
        key="server.db_pool_pre_ping",
        group=GROUP_SERVER,
        label="Comprobar la conexión antes de usarla",
        help=(
            "Evita el error de la primera petición de la mañana, cuando la base de datos ha "
            "cerrado por su cuenta una conexión dormida. Déjalo encendido."
        ),
        type=SettingType.BOOL,
        default=True,
        caution=_RESTART,
    ),
    SettingDef(
        key="server.db_echo",
        group=GROUP_SERVER,
        label="Escribir todas las consultas en el registro",
        help="Para buscar un fallo. Llena el registro muy deprisa; apágalo después.",
        type=SettingType.BOOL,
        default=False,
        caution=_RESTART,
    ),
    SettingDef(
        key="server.db_statement_timeout_ms",
        group=GROUP_SERVER,
        label="Tiempo máximo de una consulta (ms)",
        help=(
            "Una consulta que pase de aquí se corta, para que un informe pesado no deje "
            "la caja esperando. 30000 son 30 segundos."
        ),
        type=SettingType.INT,
        default=30_000,
        minimum=Decimal(1000),
        caution=_RESTART,
    ),
    SettingDef(
        key="server.log_level",
        group=GROUP_SERVER,
        label="Detalle del registro de sucesos",
        help='Cuánto se anota. "INFO" es lo normal; "DEBUG" sólo para buscar un fallo.',
        type=SettingType.ENUM,
        default="INFO",
        choices=(
            Choice("DEBUG", "DEBUG (todo)"),
            Choice("INFO", "INFO (lo normal)"),
            Choice("WARNING", "WARNING (sólo avisos)"),
            Choice("ERROR", "ERROR (sólo fallos)"),
            Choice("CRITICAL", "CRITICAL (sólo lo grave)"),
        ),
        caution=_RESTART,
    ),
    SettingDef(
        key="server.log_format",
        group=GROUP_SERVER,
        label="Formato del registro de sucesos",
        help='"json" para que lo lea una máquina; "console" para leerlo tú.',
        type=SettingType.ENUM,
        default="json",
        choices=(Choice("json", "JSON"), Choice("console", "Texto")),
        caution=_RESTART,
    ),
    SettingDef(
        key="server.cors_origins",
        group=GROUP_SERVER,
        label="Direcciones web que pueden usar la API",
        help=(
            "Separadas por comas. Sólo hace falta tocarlo si abres la aplicación desde una "
            "dirección distinta a la de siempre."
        ),
        type=SettingType.STRING,
        default="",
        caution=_RESTART,
    ),
    SettingDef(
        key="server.session_cookie_name",
        group=GROUP_SERVER,
        label="Nombre de la galleta de sesión",
        help="Cambiarlo cierra la sesión de todo el mundo.",
        type=SettingType.STRING,
        default="openerp_session",
        caution=_RESTART,
    ),
    SettingDef(
        key="server.session_ttl_days",
        group=GROUP_SERVER,
        label="Días que dura la sesión",
        help=(
            "Cuánto se tarda en volver a pedir la contraseña. En una caja que no se mueve de "
            "la tienda puede ser largo; en un portátil que sale de casa, corto."
        ),
        type=SettingType.INT,
        default=30,
        minimum=Decimal(1),
        maximum=Decimal(365),
        caution=_RESTART,
    ),
    SettingDef(
        key="server.session_touch_interval_seconds",
        group=GROUP_SERVER,
        label="Cada cuánto se renueva la sesión (segundos)",
        help=(
            "La sesión se va renovando sola mientras se usa, pero se apunta como mucho una "
            "vez cada este rato, para no escribir en la base de datos en cada petición."
        ),
        type=SettingType.INT,
        default=60,
        minimum=Decimal(0),
        caution=_RESTART,
    ),
    SettingDef(
        key="server.bootstrap_admin_email",
        group=GROUP_SERVER,
        label="Correo del administrador inicial",
        help=(
            "Sólo se usa al arrancar por primera vez, para crear el primer usuario. Con la "
            "tienda ya en marcha no hace nada: los usuarios se gestionan en su pantalla."
        ),
        type=SettingType.STRING,
        default="",
        caution=_RESTART,
    ),
    SettingDef(
        key="server.bootstrap_admin_password",
        group=GROUP_SERVER,
        label="Contraseña del administrador inicial",
        help="Igual que el correo de arriba: sólo cuenta en el primer arranque.",
        type=SettingType.SECRET,
        default="",
        caution=_RESTART,
    ),
    SettingDef(
        key="server.login_rate_limit_max_attempts",
        group=GROUP_SERVER,
        label="Intentos de contraseña por usuario",
        help="Cuántos fallos seguidos se permiten sobre una misma cuenta antes de bloquearla.",
        type=SettingType.INT,
        default=5,
        minimum=Decimal(1),
        caution=_RESTART,
    ),
    SettingDef(
        key="server.login_rate_limit_window_seconds",
        group=GROUP_SERVER,
        label="Durante cuánto se cuentan esos intentos (segundos)",
        help="Pasado este rato sin fallar, la cuenta vuelve a empezar de cero.",
        type=SettingType.DECIMAL,
        default=Decimal(300),
        minimum=Decimal(1),
        caution=_RESTART,
    ),
    SettingDef(
        key="server.login_rate_limit_ip_max_attempts",
        group=GROUP_SERVER,
        label="Intentos de contraseña por equipo",
        help=(
            "Más generoso que el de arriba a propósito: las cajas de la tienda salen todas "
            "por la misma línea, y varias personas equivocándose no pueden bloquearla."
        ),
        type=SettingType.INT,
        default=20,
        minimum=Decimal(1),
        caution=_RESTART,
    ),
    SettingDef(
        key="server.login_rate_limit_ip_window_seconds",
        group=GROUP_SERVER,
        label="Durante cuánto se cuentan los intentos por equipo (segundos)",
        help="Igual que el de por usuario, pero para el equipo.",
        type=SettingType.DECIMAL,
        default=Decimal(300),
        minimum=Decimal(1),
        caution=_RESTART,
    ),
)

SETTINGS: tuple[SettingDef, ...] = (
    # --- nombre de la aplicación ------------------------------------------
    SettingDef(
        key="app.display_name",
        group=GROUP_STORE,
        label="Nombre que se ve en la aplicación",
        help=(
            "Aparece en la pantalla de entrada, arriba del menú y en la caja. "
            'Ponle el nombre de tu tienda en vez de "OpenERP".'
        ),
        type=SettingType.STRING,
        default="OpenERP",
    ),
    SettingDef(
        key="business.timezone",
        group=GROUP_STORE,
        label="Zona horaria comercial",
        help=(
            "Calendario y hora de la tienda para mostrar, filtrar y agrupar operaciones. "
            "Escribe un nombre IANA, por ejemplo Europe/Madrid, Europe/Lisbon o UTC."
        ),
        type=SettingType.TIMEZONE,
        default="Europe/Madrid",
    ),
    # --- caja --------------------------------------------------------------
    SettingDef(
        key="pos.print_ticket_on_checkout",
        group=GROUP_POS,
        label="Imprimir el ticket al cobrar",
        help=(
            "Nada más cobrar, el ticket sale solo, sin tener que darle a imprimir. "
            "Apágalo si prefieres decidir cada vez (el botón sigue estando)."
        ),
        type=SettingType.BOOL,
        default=True,
    ),
    SettingDef(
        key="pos.catalog_refresh_seconds",
        group=GROUP_POS,
        label="Cada cuánto mira la caja si hay cambios",
        help=(
            "La caja pregunta cada tantos segundos si ha cambiado algo en el "
            "panel, y sólo cuando la respuesta es que sí vuelve a pedir precios, "
            "productos y botones. La pregunta es diminuta, así que bajarlo no "
            "pesa: con 3 segundos, un precio cambiado en el panel está en la caja "
            "antes de que te dé tiempo a ir hasta ella."
        ),
        type=SettingType.INT,
        default=3,
        minimum=Decimal(1),
        maximum=Decimal(600),
    ),
    SettingDef(
        key="pos.weighed_units",
        group=GROUP_POS,
        label="Unidades que se venden pesando",
        help=(
            "Un producto con estas unidades no se puede vender de un toque: al "
            "pulsarlo, la caja pregunta cuántos gramos se llevan, porque nadie "
            "compra exactamente un kilo de tomates. El resto se vende de un toque, "
            "una unidad. Varias separadas por comas (KG, L)."
        ),
        type=SettingType.STRING,
        default="KG",
    ),
    SettingDef(
        key="pos.default_payment_method",
        group=GROUP_POS,
        label="Forma de pago que sale marcada",
        help="Con cuál arranca la pantalla de cobro. Pon la que más uses.",
        type=SettingType.ENUM,
        default="CASH",
        choices=(
            Choice("CASH", "Efectivo"),
            Choice("CARD", "Tarjeta"),
            Choice("OTHER", "La tercera forma de pago"),
        ),
    ),
    SettingDef(
        key="pos.show_other_payment",
        group=GROUP_POS,
        label="Mostrar la tercera forma de pago en la caja",
        help=(
            "Añade un tercer botón junto a Efectivo y Tarjeta. Cómo se llama se "
            'configura arriba, en Ticket → "Nombre del otro método de pago" '
            "(Bizum, vale, transferencia…)."
        ),
        type=SettingType.BOOL,
        default=False,
    ),
    # --- ventas ------------------------------------------------------------
    SettingDef(
        key="sales.allow_negative_stock",
        group=GROUP_SALES,
        label="Dejar vender sin existencias suficientes",
        help=(
            "Hoy la caja bloquea la venta si el inventario no llega. Actívalo si tu "
            "inventario no siempre está al día y prefieres vender y cuadrar después."
        ),
        type=SettingType.BOOL,
        default=False,
        caution=(
            "Con esto activado el stock puede quedarse en negativo, y sabrás que algo "
            "no cuadra sólo mirando el inventario. Los productos con lotes siguen "
            "necesitando existencias: hay que saber de qué lote sale lo que vendes."
        ),
    ),
    SettingDef(
        key="sales.max_discount_rate",
        group=GROUP_SALES,
        label="Descuento máximo por línea (%)",
        help="Tope de descuento que se puede aplicar a una línea de venta.",
        type=SettingType.DECIMAL,
        default=Decimal(100),
        minimum=Decimal(0),
        maximum=Decimal(100),
    ),
    # --- productos ---------------------------------------------------------
    SettingDef(
        key="catalog.sku_prefix",
        group=GROUP_CATALOG,
        label="Letra de la referencia automática",
        help='Las referencias se generan solas: con "P" salen P000123, con "ART" ART000123.',
        type=SettingType.STRING,
        default="P",
    ),
    SettingDef(
        key="catalog.default_min_stock",
        group=GROUP_CATALOG,
        label="Stock mínimo por defecto",
        help=(
            "Con el que nace un producto nuevo si no le pones otro. Déjalo en 0 y no "
            "avisará de falta de existencias hasta que se lo pongas a mano."
        ),
        type=SettingType.DECIMAL,
        default=Decimal(0),
        minimum=Decimal(0),
    ),
    SettingDef(
        key="catalog.quick_price_units",
        group=GROUP_CATALOG,
        label="Unidades con el precio editable en la lista",
        help=(
            "Los productos que se venden con estas unidades llevan el precio en un "
            "recuadro dentro de la propia lista de Inventario → Productos, para poder "
            "repasar los precios del día de un tirón. El resto sólo lo muestran, y se "
            "cambian desde la ficha. Varias unidades, separadas por comas (KG, L). "
            "Déjalo vacío y no habrá recuadro en ninguna."
        ),
        type=SettingType.STRING,
        default="KG",
    ),
    # --- avisos ------------------------------------------------------------
    SettingDef(
        key="notifications.email_subject_prefix",
        group=GROUP_NOTIFICATIONS,
        label="Texto al principio del asunto de los avisos",
        help='Los correos de aviso llegan como "[OpenERP] Falta de stock". Cambia esa etiqueta.',
        type=SettingType.STRING,
        default="[OpenERP]",
    ),
    SettingDef(
        key="notifications.default_expiration_days",
        group=GROUP_NOTIFICATIONS,
        label="Días de antelación para avisar de caducidades",
        help="Con el que se crea una regla de caducidad nueva. Cada regla puede llevar el suyo.",
        type=SettingType.INT,
        default=7,
        minimum=Decimal(0),
        maximum=Decimal(365),
    ),
    # --- pantalla ----------------------------------------------------------
    SettingDef(
        key="ui.base_font_px",
        group=GROUP_UI,
        label="Tamaño de la letra",
        help=(
            "En píxeles. Manda sobre toda la aplicación —la caja y el panel—: al "
            "subirlo crecen también los botones, las filas y los recuadros, no sólo "
            "las letras. 16 es lo normal de un navegador; 18 se lee de pie delante "
            "de la caja, y 20 o 22 desde más lejos."
        ),
        type=SettingType.INT,
        default=18,
        minimum=Decimal(14),
        maximum=Decimal(24),
    ),
    SettingDef(
        key="ui.button_color",
        group=GROUP_UI,
        label="Color de los botones del panel",
        help=(
            "Del color que elijas se toma el tono: la aplicación reconstruye los "
            "claros y los oscuros con las mismas intensidades de siempre, para que "
            "la letra encima del botón se siga leyendo elijas lo que elijas."
        ),
        type=SettingType.COLOR,
        default="#2b5bb5",
    ),
    SettingDef(
        key="ui.pos_button_color",
        group=GROUP_UI,
        label="Color de los botones de cobrar (caja)",
        help=(
            "El de los botones que rematan una acción en el TPV: cobrar, añadir al "
            "carrito, aceptar los gramos. Aparte del anterior a propósito, para que "
            "en la caja se distingan de un vistazo."
        ),
        type=SettingType.COLOR,
        default="#059669",
    ),
    # --- servidor ----------------------------------------------------------
    # Al final a propósito: son los que casi nunca se tocan, y así el panel
    # los pinta en la última tarjeta.
    *_SERVER_SETTINGS,
)

SETTINGS_BY_KEY: dict[str, SettingDef] = {s.key: s for s in SETTINGS}

#: El orden en que se pintan las tarjetas en el panel.
GROUPS: tuple[str, ...] = tuple(dict.fromkeys(s.group for s in SETTINGS))
