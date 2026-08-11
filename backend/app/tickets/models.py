"""Versioned receipt templates and the immutable tickets rendered from them.

"Versioned" is not cosmetic: editing a template never mutates the row a
past ticket was rendered with (same append-only philosophy as
``product_price_history``/``audit_log``) — ``revise_template`` retires the
current version (``is_active=False``) and inserts a new row with
``version + 1`` under the same ``name``, so a ticket printed last month
still points at the exact header/footer it was actually printed with, even
if today's store policy text has changed.

A ``Ticket`` itself is generated once per sale and never re-rendered:
``rendered_text`` is a snapshot (rule 6/7's philosophy, applied to
receipts) — the layout the customer's copy actually had, frozen at
generation time, regardless of any template edits or reprints afterwards.
"""

from __future__ import annotations

from enum import StrEnum

from sqlalchemy import BigInteger, ForeignKey, Integer, String, Text, UniqueConstraint
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


class TicketTemplate(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "ticket_templates"
    __table_args__ = (UniqueConstraint("name", "version", name="uq_ticket_templates_name_version"),)

    name: Mapped[str] = mapped_column(String(100), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    #: 58mm/80mm are the two standard thermal roll widths; the character
    #: count a monospace receipt font fits per line follows directly from
    #: it (see ``app.tickets.render``).
    width_mm: Mapped[int] = mapped_column(Integer)
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
    # quedan versionadas con ella: una plantilla vieja sigue diciendo cómo
    # se imprimía entonces.
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

    #: Only one version per ``name`` is active at a time — the one new
    #: tickets render with. Retired versions stay forever, still readable
    #: through whichever ``Ticket`` rows already reference them.
    is_active: Mapped[bool] = mapped_column(default=True, server_default="true")


class Ticket(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "tickets"
    __table_args__ = (UniqueConstraint("sale_id", name="uq_tickets_sale_id"),)

    sale_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("sales.id"), index=True)
    template_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("ticket_templates.id"))
    width_mm: Mapped[int] = mapped_column(Integer)
    #: The fully formatted receipt, frozen at generation time — see the
    #: module docstring for why this is never recomputed.
    rendered_text: Mapped[str] = mapped_column(Text)

    sale: Mapped[Sale] = relationship()
    template: Mapped[TicketTemplate] = relationship()
