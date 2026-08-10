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

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from enum import StrEnum
from typing import Any


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
        if self.type is SettingType.ENUM:
            if raw not in [c.value for c in self.choices]:
                allowed = ", ".join(c.label for c in self.choices)
                raise ValueError(f"Tiene que ser una de estas opciones: {allowed}.")
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
GROUP_TICKET = "Ticket"
GROUP_POS = "Caja (TPV)"
GROUP_SALES = "Ventas"
GROUP_CATALOG = "Productos"
GROUP_NOTIFICATIONS = "Avisos"

#: Formatos de fecha del ticket. Valor = patrón de `strftime`; etiqueta =
#: cómo se ve, que es lo único que le importa a quien elige.
_DATE_FORMATS = (
    Choice("%d/%m/%Y %H:%M", "31/12/2026 14:05"),
    Choice("%d-%m-%Y %H:%M", "31-12-2026 14:05"),
    Choice("%Y-%m-%d %H:%M", "2026-12-31 14:05"),
    Choice("%d/%m/%Y", "31/12/2026 (sin hora)"),
)

SETTINGS: tuple[SettingDef, ...] = (
    # --- datos de la tienda ------------------------------------------------
    SettingDef(
        key="store.name",
        group=GROUP_STORE,
        label="Nombre de la tienda",
        help=(
            "Se imprime arriba del todo en el ticket. Déjalo vacío si ya lo tienes "
            "escrito en la cabecera de la plantilla, o saldrá dos veces."
        ),
        type=SettingType.STRING,
        default="",
    ),
    SettingDef(
        key="store.tax_id",
        group=GROUP_STORE,
        label="NIF / CIF",
        help="Se imprime bajo el nombre. Obligatorio en una factura simplificada.",
        type=SettingType.STRING,
        default="",
    ),
    SettingDef(
        key="store.address",
        group=GROUP_STORE,
        label="Dirección",
        help="Una línea por renglón. Se imprime bajo el NIF.",
        type=SettingType.TEXT,
        default="",
    ),
    SettingDef(
        key="store.phone",
        group=GROUP_STORE,
        label="Teléfono",
        help="Opcional. Se imprime al final de los datos de la tienda.",
        type=SettingType.STRING,
        default="",
    ),
    # --- ticket ------------------------------------------------------------
    SettingDef(
        key="ticket.sale_number_prefix",
        group=GROUP_TICKET,
        label="Texto antes del número de venta",
        help='Lo que va delante del número: "Venta #1043", "Ticket nº 1043"…',
        type=SettingType.STRING,
        default="Venta #",
    ),
    SettingDef(
        key="ticket.date_format",
        group=GROUP_TICKET,
        label="Formato de la fecha",
        help="Cómo se escribe la fecha y la hora de la venta.",
        type=SettingType.ENUM,
        default="%Y-%m-%d %H:%M",
        choices=_DATE_FORMATS,
    ),
    SettingDef(
        key="ticket.show_unit_price",
        group=GROUP_TICKET,
        label='Mostrar la línea "2 x 1,65 €" bajo cada producto',
        help="Desactívalo para un ticket más corto, con solo el importe de cada línea.",
        type=SettingType.BOOL,
        default=True,
    ),
    SettingDef(
        key="ticket.show_cashier",
        group=GROUP_TICKET,
        label="Mostrar quién ha atendido",
        help="Añade el nombre del cajero o cajera bajo la fecha.",
        type=SettingType.BOOL,
        default=False,
    ),
    SettingDef(
        key="ticket.label_total",
        group=GROUP_TICKET,
        label="Palabra para el total",
        help='Lo que se imprime junto al importe final. Por defecto "TOTAL".',
        type=SettingType.STRING,
        default="TOTAL",
    ),
    SettingDef(
        key="ticket.label_change",
        group=GROUP_TICKET,
        label="Palabra para el cambio",
        help="Lo que se imprime junto al dinero que se le devuelve al cliente.",
        type=SettingType.STRING,
        default="Cambio",
    ),
    SettingDef(
        key="ticket.label_cash",
        group=GROUP_TICKET,
        label="Nombre del pago en efectivo",
        help="Cómo se llama en el ticket a un cobro en efectivo.",
        type=SettingType.STRING,
        default="Efectivo",
    ),
    SettingDef(
        key="ticket.label_card",
        group=GROUP_TICKET,
        label="Nombre del pago con tarjeta",
        help="Cómo se llama en el ticket a un cobro con tarjeta.",
        type=SettingType.STRING,
        default="Tarjeta",
    ),
    SettingDef(
        key="ticket.label_other",
        group=GROUP_TICKET,
        label="Nombre del otro método de pago",
        help='El tercer método que ofrece el TPV. Cámbialo a "Bizum", "Vale"… según uses.',
        type=SettingType.STRING,
        default="Otro",
    ),
    SettingDef(
        key="ticket.tax_note",
        group=GROUP_TICKET,
        label="Texto de la nota de IVA",
        help=(
            'Se imprime cuando la plantilla tiene el IVA en modo "nota" o "desglose". '
            "Una factura simplificada necesita esta expresión o el tipo aplicado."
        ),
        type=SettingType.STRING,
        default="IVA incluido",
    ),
    SettingDef(
        key="ticket.label_discount",
        group=GROUP_TICKET,
        label="Palabra para el descuento",
        help='Va delante del porcentaje en las líneas con descuento: "Dto. 10%".',
        type=SettingType.STRING,
        default="Dto.",
    ),
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
    # --- caja --------------------------------------------------------------
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
)

SETTINGS_BY_KEY: dict[str, SettingDef] = {s.key: s for s in SETTINGS}

#: El orden en que se pintan las tarjetas en el panel.
GROUPS: tuple[str, ...] = tuple(dict.fromkeys(s.group for s in SETTINGS))
