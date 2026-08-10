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

from sqlalchemy import BigInteger, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IntPrimaryKeyMixin, TimestampMixin
from app.sales.models import Sale


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
    #: When on, the tax block breaks the total down one line per distinct
    #: tax rate present on the sale (e.g. "IVA 21%: 3,47 €") instead of a
    #: single combined figure — see ``app.tickets.render``.
    show_tax_breakdown: Mapped[bool] = mapped_column(default=True, server_default="true")
    #: When on, a line whose ``discount_rate`` is above zero gets an extra
    #: row underneath it showing the discount applied.
    show_line_discounts: Mapped[bool] = mapped_column(default=False, server_default="false")
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
