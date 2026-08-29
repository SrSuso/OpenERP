"""Sales, their lines and payments.

Phase 11 only ever drove a sale through ``DRAFT -> CANCELLED``; reaching
``COMPLETED`` is phase 13's job (this module) — recording a payment is what
actually moves stock (via ``app.inventory.service.record_movement``/
``app.lots.service`` FEFO consumption) and closes the sale, atomically with
the payment itself (rule 5). See ``app.sales.service.checkout``.

Every line snapshots the economics it was rung up at (rule 6/7: a later
price or tax change must never reshape a sale already on the ticket) —
``unit_price``/``tax_rate`` are copied from the product at the moment the
line is added, never re-read from it afterwards.

``Payment`` rows are append-only too (same philosophy as ``audit_log``,
``product_price_history``): a till never edits or deletes a tender once
recorded, only ``app.returns`` (phase 14) can economically undo one, and
that is a new row of its own, not a mutation of this one.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.catalog.models import Product, ProductPackage
from app.db.base import Base, IntPrimaryKeyMixin, TimestampMixin
from app.db.types import Money, Quantity, numeric
from app.inventory.models import Location, Warehouse
from app.pos.models import PosTerminal


class SaleStatus(StrEnum):
    DRAFT = "DRAFT"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class PaymentMethod(StrEnum):
    CASH = "CASH"
    CARD = "CARD"
    OTHER = "OTHER"


class Sale(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "sales"
    __table_args__ = (
        CheckConstraint(
            "status <> 'COMPLETED' OR prices_include_tax IS NOT NULL",
            name="completed_has_fiscal_snapshot",
        ),
        CheckConstraint(
            "status <> 'COMPLETED' OR cashier_user_id IS NULL OR cashier_name IS NOT NULL",
            name="completed_has_cashier_snapshot",
        ),
        Index("ix_sales_terminal_id_status", "terminal_id", "status"),
    )

    #: El número que ve el cliente, el que va impreso en el ticket.
    #:
    #: No es el `id`: ése lo reparte la base de datos al abrir el carrito, y
    #: un carrito que no llega a cobrarse se lleva su número a la tumba,
    #: dejando huecos en la numeración. Éste se asigna al **cobrar**, que es
    #: cuando la venta existe de verdad, y va correlativo sin saltos.
    #: `None` mientras está en borrador.
    number: Mapped[int | None] = mapped_column(Integer, nullable=True, unique=True)

    warehouse_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("warehouses.id"), index=True)
    location_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("locations.id"))
    #: Nullable for pre-A9 history and legitimate non-POS sales. Every new
    #: browser POS cart supplies one and the domain validates that it belongs
    #: to the same warehouse. The FK is retained after checkout as history.
    terminal_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("pos_terminals.id", ondelete="RESTRICT"), nullable=True
    )
    # Indexed (phase 20): the POS "resume or open a draft" lookup and every
    # dashboard/report metric filter on this column, on a table that only
    # ever grows.
    status: Mapped[str] = mapped_column(
        String(20), default=SaleStatus.DRAFT, server_default=SaleStatus.DRAFT, index=True
    )
    notes: Mapped[str] = mapped_column(String(2000), default="")
    #: While DRAFT this identifies the user who opened the cart. Checkout
    #: replaces it with the authenticated user who actually took payment;
    #: that user may later be deactivated without invalidating history.
    cashier_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=True
    )
    #: Display identity frozen at checkout.  The user id remains useful for
    #: filtering, while this value keeps old tickets/reports stable if that
    #: user's profile is edited later.
    cashier_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    #: Set exclusively by phase 13, once a payment completes the sale.
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: Fiscal interpretation frozen at checkout.  Drafts deliberately keep
    #: this null and are presented with the current shop setting; a completed
    #: sale must never be reinterpreted after that setting changes.
    prices_include_tax: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    warehouse: Mapped[Warehouse] = relationship()
    location: Mapped[Location] = relationship()
    terminal: Mapped[PosTerminal | None] = relationship()
    lines: Mapped[list[SaleLine]] = relationship(
        back_populates="sale", cascade="all, delete-orphan", order_by="SaleLine.id"
    )
    payments: Mapped[list[Payment]] = relationship(
        back_populates="sale", cascade="all, delete-orphan", order_by="Payment.id"
    )


class SaleLine(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "sale_lines"
    __table_args__ = (
        CheckConstraint("quantity_refunded >= 0", name="quantity_refunded_non_negative"),
        CheckConstraint(
            "quantity_refunded <= quantity_base", name="quantity_refunded_not_above_sold"
        ),
        CheckConstraint(
            "quantity_physically_returned >= 0",
            name="quantity_physically_returned_non_negative",
        ),
        CheckConstraint(
            "quantity_physically_returned <= quantity_base",
            name="quantity_physically_returned_not_above_sold",
        ),
    )

    sale_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("sales.id"), index=True)
    product_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("products.id"), index=True)
    #: Minimal identity/classification snapshots used by historical sale
    #: views, receipts and reports.  ``product_id`` remains the stable link
    #: to today's catalogue; these values describe what was sold then.
    product_sku: Mapped[str] = mapped_column(String(50))
    product_name: Mapped[str] = mapped_column(String(255))
    product_category_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    product_category_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    package_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("product_packages.id"))
    #: Snapshots of the package as it was when the line was rung up — a
    #: later change to the package's name/factor must not reshape this line.
    package_name: Mapped[str] = mapped_column(String(50))
    package_factor: Mapped[Quantity]

    #: Sold, in the package chosen above (what the cashier scanned/typed).
    quantity_packages: Mapped[Quantity]
    #: The same quantity converted to base units at the factor snapshotted
    #: above (rule 3) — what phase 13's checkout actually moves out of the
    #: ledger.
    quantity_base: Mapped[Quantity]
    #: Independent running totals maintained under ``Sale FOR UPDATE`` by
    #: ``app.returns``. A goodwill exchange may increase only the physical
    #: counter; a damaged/not-returned item may increase only the economic one.
    quantity_refunded: Mapped[Quantity] = mapped_column(default=Decimal(0), server_default="0")
    quantity_physically_returned: Mapped[Quantity] = mapped_column(
        default=Decimal(0), server_default="0"
    )

    #: Price snapshot, per base unit — copied from ``Product.list_price`` at
    #: the moment the line was added, never recomputed from it afterwards
    #: (rule 7).
    unit_price: Mapped[Money]
    #: Optional per-base-unit amount selected by the cashier for a cold
    #: drink. It is a sale snapshot, never a change to the catalogue PVP.
    cold_drink_surcharge: Mapped[Money] = mapped_column(default=Decimal(0), server_default="0")
    #: Human-readable snapshot for the configured POS supplement (cold drink
    #: or bag). Its amount remains in ``cold_drink_surcharge`` for backwards
    #: compatibility with the established fiscal calculations.
    pos_surcharge_label: Mapped[str | None] = mapped_column(String(50), nullable=True)
    #: Cost and stock policy used by the original sale and by any later
    #: physical reversal.  Without these, editing the current product could
    #: make a return value or move stock differently from the sale it undoes.
    unit_cost: Mapped[Money]
    tracks_stock: Mapped[bool] = mapped_column(Boolean)
    track_lots: Mapped[bool] = mapped_column(Boolean)
    tax_rate: Mapped[Decimal] = mapped_column(numeric(), default=Decimal(0))
    discount_rate: Mapped[Decimal] = mapped_column(numeric(), default=Decimal(0))

    sale: Mapped[Sale] = relationship(back_populates="lines")
    product: Mapped[Product] = relationship()
    package: Mapped[ProductPackage] = relationship()


class Payment(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "payments"

    sale_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("sales.id"), index=True)
    method: Mapped[str] = mapped_column(String(20))
    #: What the customer actually tendered for this payment — may exceed
    #: what was still owed at the time (a cash tender bigger than the
    #: balance due), in which case ``checkout`` returns the excess as
    #: change rather than recording it here (rule 8: this is what was
    #: handed over, not what the till kept).
    amount: Mapped[Money]

    sale: Mapped[Sale] = relationship(back_populates="payments")


class ZReport(IntPrimaryKeyMixin, TimestampMixin, Base):
    """El cierre de caja: los totales del turno, congelados.

    Se guarda calculado, no como una consulta que se rehaga al mirarla: una
    Z es el papel con el que se cuadra el cajón esa noche, y tiene que decir
    dentro de un año exactamente lo mismo que decía entonces, aunque después
    se haya devuelto media compra o cambiado un precio. Mismo criterio que
    el texto del ticket (`app.tickets`).

    El turno va del cierre anterior a éste: `covers_from` es el `closed_at`
    de la Z anterior de ese almacén, o nulo la primera vez (entran todas las
    ventas que haya). Así no hay huecos ni solapes entre dos Z seguidas.

    `number` es correlativo por almacén, que es lo que se espera de una Z y
    lo que hace que se note si falta una.
    """

    __tablename__ = "z_reports"
    __table_args__ = (
        UniqueConstraint("warehouse_id", "number", name="uq_z_reports_warehouse_number"),
    )

    warehouse_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("warehouses.id"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    #: Nulo en la primera Z: antes de ella no hay corte, así que entra todo.
    covers_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    sales_count: Mapped[int] = mapped_column(Integer, default=0)
    gross_total: Mapped[Money]
    tax_total: Mapped[Money]
    discount_total: Mapped[Money]
    #: Desglose por forma de pago: es con lo que se cuadra el cajón.
    cash_total: Mapped[Money]
    card_total: Mapped[Money]
    other_total: Mapped[Money]
    #: Lo devuelto en el mismo turno, que sale del cajón igual que una
    #: venta entra en él.
    returns_count: Mapped[int] = mapped_column(Integer, default=0)
    returns_total: Mapped[Money]

    #: Nulo si quien la cerró se da de baja después (regla 14).
    closed_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=True
    )
