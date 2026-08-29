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
from ipaddress import ip_address
from typing import Any

from app.core.business_time import parse_timezone


class SettingType(StrEnum):
    BOOL = "BOOL"
    INT = "INT"
    DECIMAL = "DECIMAL"
    #: One line of text.
    STRING = "STRING"
    #: IP address, localhost or a fully qualified DNS name, without scheme/port.
    HOST = "HOST"
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
    #: Reserved for a future functional secret. Process credentials and
    #: connection strings must never be registered here; they come from the
    #: environment through app.core.config.Settings.
    SECRET = "SECRET"


_DNS_LABEL_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$")


def _parse_host(raw: str) -> str:
    value = raw.strip()
    if not value:
        raise ValueError("No puede quedar vacío.")
    if value.lower() == "localhost":
        return "localhost"
    try:
        ip_address(value)
        return value
    except ValueError:
        pass
    labels = value.removesuffix(".").split(".")
    if len(labels) < 2 or len(value) > 253 or any(not _DNS_LABEL_RE.fullmatch(x) for x in labels):
        raise ValueError(
            "Usa una IP o un nombre DNS completo, sin https://, ruta, puerto ni espacios."
        )
    return value


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
    #: Most labels/texts may intentionally be empty. Connection endpoints may not.
    allow_blank: bool = True

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
        if self.type is SettingType.HOST:
            return _parse_host(raw)
        if (
            self.type in (SettingType.STRING, SettingType.TEXT)
            and not self.allow_blank
            and not raw.strip()
        ):
            raise ValueError("No puede quedar vacío.")
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
GROUP_QZ = "Impresión QZ Tray"
GROUP_SALES = "Ventas"
GROUP_CATALOG = "Productos"
GROUP_NOTIFICATIONS = "Avisos"
GROUP_UI = "Pantalla"

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
    SettingDef(
        key="pos.cold_drink_surcharge_amount",
        group=GROUP_POS,
        label="Recargo por bebida fría (por unidad)",
        help=(
            "Importe final que suma la caja a cada unidad marcada como bebida fría. "
            "Pon 0 para desactivar el botón en el TPV."
        ),
        type=SettingType.DECIMAL,
        default=Decimal(0),
        minimum=Decimal(0),
        maximum=Decimal(100),
    ),
    SettingDef(
        key="pos.surface_color",
        group=GROUP_POS,
        label="Color de fondo del TPV",
        help=(
            "El fondo principal de la pantalla de venta. Se usa exactamente el color elegido, "
            "sin aclararlo, oscurecerlo ni cambiar su saturación automáticamente."
        ),
        type=SettingType.COLOR,
        default="#0f172a",
    ),
    SettingDef(
        key="pos.panel_color",
        group=GROUP_POS,
        label="Color de paneles y ventanas del TPV",
        help=(
            "Fondo de la cesta, cobro, diálogos y demás superficies elevadas de la caja. "
            "Se aplica exactamente como lo elijas."
        ),
        type=SettingType.COLOR,
        default="#1e293b",
    ),
    SettingDef(
        key="pos.border_color",
        group=GROUP_POS,
        label="Color de bordes y separadores del TPV",
        help=(
            "Color de las líneas que separan paneles, formularios y controles de la caja. "
            "El TPV no calcula tonos alternativos para este ajuste."
        ),
        type=SettingType.COLOR,
        default="#475569",
    ),
    SettingDef(
        key="pos.text_color",
        group=GROUP_POS,
        label="Color del texto principal del TPV",
        help=(
            "Color de los títulos y textos principales sobre el fondo de la caja. Elígelo "
            "con el contraste que quieras usar; no se modifica automáticamente."
        ),
        type=SettingType.COLOR,
        default="#f8fafc",
    ),
    SettingDef(
        key="pos.muted_text_color",
        group=GROUP_POS,
        label="Color del texto secundario del TPV",
        help=(
            "Color de ayudas, etiquetas y detalles secundarios de la caja. Se guarda tal cual "
            "para que puedas decidir la luminosidad y saturación exactas."
        ),
        type=SettingType.COLOR,
        default="#cbd5e1",
    ),
    SettingDef(
        key="pos.amount_color",
        group=GROUP_POS,
        label="Color de importes y totales del TPV",
        help=(
            "Color de los precios, importes y totales que aparecen en la caja. No se mezcla "
            "con el fondo ni se transforma para generar contraste."
        ),
        type=SettingType.COLOR,
        default="#34d399",
    ),
    SettingDef(
        key="pos.input_background_color",
        group=GROUP_POS,
        label="Color de campos de entrada del TPV",
        help=(
            "Fondo de los campos donde se escanea, busca o introduce un importe. El valor se "
            "aplica literalmente, sin una capa gris por encima."
        ),
        type=SettingType.COLOR,
        default="#0f172a",
    ),
    SettingDef(
        key="pos.input_text_color",
        group=GROUP_POS,
        label="Color de texto en campos del TPV",
        help=(
            "Color del texto escrito dentro de los campos de búsqueda, escáner e importes. "
            "Configúralo independientemente del resto del texto."
        ),
        type=SettingType.COLOR,
        default="#f8fafc",
    ),
    SettingDef(
        key="pos.font_size_px",
        group=GROUP_POS,
        label="Tamaño de letra del TPV",
        help=(
            "En píxeles. Aumenta a la vez el texto, los botones y los recuadros de la caja "
            "para que se lea mejor desde el mostrador."
        ),
        type=SettingType.INT,
        default=18,
        minimum=Decimal(14),
        maximum=Decimal(28),
    ),
    SettingDef(
        key="pos.qz_host",
        group=GROUP_QZ,
        label="Servidor QZ (IP o nombre completo)",
        help=(
            "Equipo Windows donde se ejecuta QZ Tray. Usa localhost si este navegador está "
            "en la caja, o una IP fija/nombre DNS completo para imprimir desde otro PC. "
            "No escribas https:// ni el puerto."
        ),
        type=SettingType.HOST,
        default="localhost",
    ),
    SettingDef(
        key="pos.qz_secure_port",
        group=GROUP_QZ,
        label="Puerto seguro de QZ",
        help=(
            "Puerto WSS que escucha QZ Tray. Empieza por 8181 y usa otro únicamente si "
            "QZ indica que ese puerto ya está ocupado."
        ),
        type=SettingType.ENUM,
        default="8181",
        choices=(
            Choice("8181", "8181 (principal)"),
            Choice("8282", "8282"),
            Choice("8383", "8383"),
            Choice("8484", "8484"),
        ),
    ),
    SettingDef(
        key="pos.qz_printer_name",
        group=GROUP_QZ,
        label="Nombre de la impresora en Windows",
        help=(
            "Debe coincidir exactamente con el nombre que aparece en Impresoras y escáneres "
            "del PC donde se ejecuta QZ Tray."
        ),
        type=SettingType.STRING,
        default="POSPrinter POS-80",
        allow_blank=False,
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
        group=GROUP_POS,
        label="Color de los botones principales del TPV",
        help=(
            "El de las acciones que confirman una operación: cobrar, añadir al carrito, "
            "aceptar una cantidad o cerrar caja. Se aplica exactamente al fondo del botón."
        ),
        type=SettingType.COLOR,
        default="#059669",
    ),
    SettingDef(
        key="ui.pos_button_hover_color",
        group=GROUP_POS,
        label="Color al tocar un botón principal del TPV",
        help=(
            "Color del estado al pasar o pulsar un botón principal. Es un valor independiente: "
            "la aplicación no lo calcula ni lo aclara a partir del fondo principal."
        ),
        type=SettingType.COLOR,
        default="#10b981",
    ),
    SettingDef(
        key="ui.pos_button_text_color",
        group=GROUP_POS,
        label="Color del texto de botones principales del TPV",
        help=(
            "Texto de Cobrar, confirmar y demás acciones principales. Puedes definir su propio "
            "contraste frente al fondo sin que el TPV lo sustituya."
        ),
        type=SettingType.COLOR,
        default="#ffffff",
    ),
    SettingDef(
        key="ui.pos_secondary_button_color",
        group=GROUP_POS,
        label="Color de los botones generales del TPV",
        help=(
            "El de los botones de navegación, productos, teclados y métodos de pago no "
            "seleccionados. Sustituye el gris fijo de la caja sin cambiar los colores propios "
            "de las categorías POS."
        ),
        type=SettingType.COLOR,
        default="#334155",
    ),
    SettingDef(
        key="ui.pos_secondary_button_hover_color",
        group=GROUP_POS,
        label="Color al tocar un botón general del TPV",
        help=(
            "Color del estado al pasar o pulsar productos, teclado, navegación y métodos de "
            "pago no seleccionados. Se configura por separado del fondo del botón."
        ),
        type=SettingType.COLOR,
        default="#475569",
    ),
    SettingDef(
        key="ui.pos_secondary_button_text_color",
        group=GROUP_POS,
        label="Color del texto de botones generales del TPV",
        help=(
            "Texto de productos, teclas, navegación y acciones secundarias. El valor elegido "
            "se muestra exactamente, sin correcciones automáticas de contraste."
        ),
        type=SettingType.COLOR,
        default="#f8fafc",
    ),
    SettingDef(
        key="ui.pos_danger_button_color",
        group=GROUP_POS,
        label="Color de los botones de anulación del TPV",
        help=(
            "El de las acciones destructivas, como cancelar una venta. Mantenerlo distinto de "
            "los botones principales ayuda a evitar una anulación por error en caja."
        ),
        type=SettingType.COLOR,
        default="#b91c1c",
    ),
    SettingDef(
        key="ui.pos_danger_button_hover_color",
        group=GROUP_POS,
        label="Color al tocar un botón de anulación del TPV",
        help=(
            "Color del estado al pasar o pulsar una acción de anulación. Se guarda de forma "
            "independiente para que puedas controlarlo sin ningún cálculo automático."
        ),
        type=SettingType.COLOR,
        default="#dc2626",
    ),
    SettingDef(
        key="ui.pos_danger_button_text_color",
        group=GROUP_POS,
        label="Color del texto de botones de anulación del TPV",
        help=(
            "Texto de cancelar venta, quitar línea y demás acciones destructivas. Define tú "
            "mismo el contraste con el fondo de ese botón."
        ),
        type=SettingType.COLOR,
        default="#ffffff",
    ),
)

SETTINGS_BY_KEY: dict[str, SettingDef] = {s.key: s for s in SETTINGS}

#: El orden en que se pintan las tarjetas en el panel.
GROUPS: tuple[str, ...] = tuple(dict.fromkeys(s.group for s in SETTINGS))
