"""Saved receipt templates and the immutable tickets rendered from them.

A template is edited directly. A ``Ticket`` itself is generated once per
sale and never re-rendered:
``rendered_text`` is a snapshot (rule 6/7's philosophy, applied to
receipts) — the layout the customer's copy actually had, frozen at
generation time, regardless of any template edits or reprints afterwards.
"""

from __future__ import annotations

from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IntPrimaryKeyMixin, TimestampMixin
from app.sales.models import Sale


class TicketTaxDisplay(StrEnum):
    """How a receipt reports the tax contained in its total.

    A Spanish *factura simplificada* must carry at least the tax rate or
    the words "IVA incluido" — ``NONE`` is therefore only appropriate for
    an internal/non-fiscal receipt, which is why it isn't the default.
    """

    #: Nothing beyond the total.
    NONE = "NONE"
    #: One centred line ("IVA incluido") and no figures — the legal
    #: minimum, and enough for a small shop under recargo de equivalencia.
    NOTE = "NOTE"
    #: A table with one row per tax rate on the sale: rate, taxable base
    #: and tax amount.
    BREAKDOWN = "BREAKDOWN"


class TicketFontFamily(StrEnum):
    """Safe, monospace fonts supported by the browser print view.

    The receipt renderer aligns columns by character. Keeping this list
    monospace is deliberate: allowing an arbitrary proportional CSS font
    would make a line that fits on screen wrap on the thermal printer.
    """

    COURIER_NEW = "COURIER_NEW"
    LIBERATION_MONO = "LIBERATION_MONO"
    DEJAVU_SANS_MONO = "DEJAVU_SANS_MONO"


class TicketFontWeight(StrEnum):
    NORMAL = "NORMAL"
    BOLD = "BOLD"


class TicketLayoutMode(StrEnum):
    STANDARD = "STANDARD"
    CUSTOM = "CUSTOM"


class TicketTemplate(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "ticket_templates"
    __table_args__ = (
        # Kept for existing installations that previously stored revisions.
        # New templates are unique by name at the service boundary.
        UniqueConstraint("name", "version", name="uq_ticket_templates_name_version"),
        # There is one receipt layout for the whole store, not one per name,
        # warehouse or document type. PostgreSQL protects that global scope
        # even if a caller bypasses the service-level transition lock.
        Index(
            "uq_ticket_templates_single_active",
            "is_active",
            unique=True,
            postgresql_where=text("is_active"),
        ),
        CheckConstraint(
            "margin_left_mm >= 0 AND margin_right_mm >= 0 "
            "AND printable_width_mm + margin_left_mm + margin_right_mm <= 80",
            name="ck_ticket_templates_print_area_within_80mm",
        ),
    )

    name: Mapped[str] = mapped_column(String(100), index=True)
    # Legacy storage detail from the former revision system. It is no longer
    # exposed or incremented; templates are updated in place.
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    #: The real printable width, rather than the nominal width of the paper
    #: roll. An 80mm thermal printer commonly exposes about 72mm to ink.
    printable_width_mm: Mapped[int] = mapped_column(Integer)
    margin_left_mm: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    margin_right_mm: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    font_family: Mapped[str] = mapped_column(
        String(30),
        default=TicketFontFamily.COURIER_NEW,
        server_default=TicketFontFamily.COURIER_NEW,
    )
    font_size_px: Mapped[int] = mapped_column(Integer, default=9, server_default="9")
    line_height_px: Mapped[int] = mapped_column(Integer, default=12, server_default="12")
    font_weight: Mapped[str] = mapped_column(
        String(10), default=TicketFontWeight.NORMAL, server_default=TicketFontWeight.NORMAL
    )
    #: Thermal receipts have no useful fixed height: content determines when
    #: the printer cuts. These margins are the controllable vertical size.
    margin_top_mm: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    margin_bottom_mm: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    #: Optional safe receipt-layout source. Empty keeps the structured layout
    #: used by existing shops; a non-empty value is rendered once and frozen
    #: in ``Ticket.rendered_text`` when a sale is completed.
    layout_template: Mapped[str] = mapped_column(Text, default="", server_default="")
    layout_mode: Mapped[str] = mapped_column(
        String(10), default=TicketLayoutMode.STANDARD, server_default=TicketLayoutMode.STANDARD
    )
    header_text: Mapped[str] = mapped_column(Text, default="")
    footer_text: Mapped[str] = mapped_column(Text, default="")
    #: How the receipt reports its tax — see ``TicketTaxDisplay`` and
    #: ``app.tickets.render``. Replaces the earlier ``show_tax_breakdown``
    #: boolean, which could only say "a breakdown or nothing" and left no
    #: room for the "IVA incluido" note a shop under recargo de
    #: equivalencia actually wants.
    tax_display: Mapped[str] = mapped_column(
        String(20), default=TicketTaxDisplay.BREAKDOWN, server_default=TicketTaxDisplay.BREAKDOWN
    )
    #: When on, a line whose ``discount_rate`` is above zero gets an extra
    #: row underneath it showing the discount applied.
    show_line_discounts: Mapped[bool] = mapped_column(default=False, server_default="false")
    # --- lo que antes vivía en Configuración -------------------------------
    #
    # El ticket se edita en un solo sitio: aquí. Tenerlo repartido entre la
    # plantilla y la pantalla de ajustes hacía que los datos de la tienda
    # salieran impresos dos veces —una desde cada lado— y que nadie supiera
    # cuál de los dos mandaba. Además, siendo columnas de la plantilla,
    # quedan junto con ella; el ticket generado guarda su propio snapshot.
    store_name: Mapped[str] = mapped_column(Text, default="", server_default="")
    store_tax_id: Mapped[str] = mapped_column(Text, default="", server_default="")
    store_address: Mapped[str] = mapped_column(Text, default="", server_default="")
    store_phone: Mapped[str] = mapped_column(Text, default="", server_default="")

    sale_number_prefix: Mapped[str] = mapped_column(
        String(50), default="Venta #", server_default="Venta #"
    )
    #: Patrón de `strftime`.
    date_format: Mapped[str] = mapped_column(
        String(50), default="%Y-%m-%d %H:%M", server_default="%Y-%m-%d %H:%M"
    )
    show_unit_price: Mapped[bool] = mapped_column(default=True, server_default="true")
    show_cashier: Mapped[bool] = mapped_column(default=False, server_default="false")

    label_total: Mapped[str] = mapped_column(String(50), default="TOTAL", server_default="TOTAL")
    label_change: Mapped[str] = mapped_column(String(50), default="Cambio", server_default="Cambio")
    label_cash: Mapped[str] = mapped_column(
        String(50), default="Efectivo", server_default="Efectivo"
    )
    label_card: Mapped[str] = mapped_column(String(50), default="Tarjeta", server_default="Tarjeta")
    label_other: Mapped[str] = mapped_column(String(50), default="Otros", server_default="Otros")
    label_discount: Mapped[str] = mapped_column(String(50), default="Dto.", server_default="Dto.")
    #: La nota que explica el IVA cuando no se desglosa.
    tax_note: Mapped[str] = mapped_column(
        String(200), default="IVA incluido", server_default="IVA incluido"
    )

    #: At most one template is active store-wide — the one new tickets render
    #: with. A store may have none before initial setup; the others remain as
    #: alternatives that can be activated later.
    is_active: Mapped[bool] = mapped_column(default=True, server_default="true")


class Ticket(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "tickets"
    __table_args__ = (
        UniqueConstraint("sale_id", name="uq_tickets_sale_id"),
        CheckConstraint(
            "margin_left_mm >= 0 AND margin_right_mm >= 0 "
            "AND printable_width_mm + margin_left_mm + margin_right_mm <= 80",
            name="ck_tickets_print_area_within_80mm",
        ),
    )

    sale_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("sales.id"), index=True)
    # El ticket es un snapshot completo; si se elimina una plantilla creada
    # por error, el recibo emitido sigue siendo íntegro aunque ya no haya una
    # configuración viva a la que apuntar.
    template_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("ticket_templates.id", ondelete="SET NULL"),
        nullable=True,
    )
    #: Snapshot of the physical print profile, keeping an old ticket
    #: self-contained even after its source template is edited or deleted.
    printable_width_mm: Mapped[int] = mapped_column(Integer)
    margin_left_mm: Mapped[int] = mapped_column(Integer, server_default="0")
    margin_right_mm: Mapped[int] = mapped_column(Integer, server_default="0")
    # These server defaults have existed since the print-profile migration.
    # Keep the ORM declaration aligned so Alembic can reliably detect real
    # migration drift.
    font_family: Mapped[str] = mapped_column(
        String(30), server_default=TicketFontFamily.COURIER_NEW
    )
    font_size_px: Mapped[int] = mapped_column(Integer, server_default="9")
    line_height_px: Mapped[int] = mapped_column(Integer, server_default="12")
    font_weight: Mapped[str] = mapped_column(String(10), server_default=TicketFontWeight.NORMAL)
    margin_top_mm: Mapped[int] = mapped_column(Integer, server_default="0")
    margin_bottom_mm: Mapped[int] = mapped_column(Integer, server_default="0")
    #: The fully formatted receipt, frozen at generation time — see the
    #: module docstring for why this is never recomputed.
    rendered_text: Mapped[str] = mapped_column(Text)

    sale: Mapped[Sale] = relationship()
    template: Mapped[TicketTemplate | None] = relationship()
