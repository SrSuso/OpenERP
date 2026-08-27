"""Reglas de aviso escritas con condiciones, en vez de un tipo cerrado por
cada cosa que se quiera vigilar.

Misma idea (y mismas garantías) que ``app.reports.rules``: una lista
blanca fija de "sujetos", cada uno con sus campos consultables y su
expresión SQL escrita a mano. Una regla guardada sólo aporta **claves**
de estos diccionarios, un operador de una lista cerrada y un valor que
viaja como parámetro — nunca hay un camino de lo que el usuario escribe a
un trozo de SQL (regla 13). Añadir un campo consultable es una entrada
más aquí, en revisión de código.

Los dos tipos que existían antes (``LOW_STOCK``/``EXPIRING_LOT``) siguen
funcionando tal cual; esto es lo que permite además escribir "stock por
debajo de 5", "caduca en menos de 3 días" o "margen menor que 10" sin
tocar el código.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import Row, Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog.models import Product
from app.core.errors import ValidationError
from app.inventory.models import StockBalance
from app.lots.models import Lot


class FieldType(StrEnum):
    NUMBER = "NUMBER"
    #: Entero de días; se compara como número pero el panel lo etiqueta
    #: distinto ("días") para que se entienda qué se está midiendo.
    DAYS = "DAYS"


class Operator(StrEnum):
    EQ = "="
    NE = "!="
    LT = "<"
    LTE = "<="
    GT = ">"
    GTE = ">="


#: Cómo se aplica cada operador. Diccionario y no `eval`/`getattr` para
#: que un operador inventado no llegue nunca a la consulta.
_APPLY: dict[Operator, Callable[[Any, Any], Any]] = {
    Operator.EQ: lambda column, value: column == value,
    Operator.NE: lambda column, value: column != value,
    Operator.LT: lambda column, value: column < value,
    Operator.LTE: lambda column, value: column <= value,
    Operator.GT: lambda column, value: column > value,
    Operator.GTE: lambda column, value: column >= value,
}


@dataclass(frozen=True)
class FieldDef:
    label: str
    type: FieldType
    help: str


@dataclass(frozen=True)
class SubjectDef:
    label: str
    #: Lo que se guarda en `Incident.subject_type`.
    subject_type: str
    fields: dict[str, FieldDef]
    #: Construye la consulta base y las expresiones SQL de cada campo. Se
    #: llama por evaluación (y no se cachea) porque las subconsultas de
    #: saldo se crean nuevas cada vez.
    build: Callable[[], tuple[Select[Any], dict[str, Any]]]
    describe: Callable[[Row[Any]], str]


def _product_query() -> tuple[Select[Any], dict[str, Any]]:
    balances = (
        select(StockBalance.product_id, func.sum(StockBalance.quantity).label("quantity"))
        .group_by(StockBalance.product_id)
        .subquery()
    )
    stock = func.coalesce(balances.c.quantity, 0)
    stmt = (
        select(
            Product.id.label("subject_id"),
            Product.name,
            stock.label("stock"),
            Product.min_stock,
            Product.cost,
            Product.list_price,
        )
        .select_from(Product)
        .outerjoin(balances, balances.c.product_id == Product.id)
        .where(Product.is_active.is_(True))
    )
    return stmt, {
        "stock": stock,
        "min_stock": Product.min_stock,
        # Permite "por debajo del mínimo" (< 0) sin necesitar comparar dos
        # campos entre sí, que complicaría mucho el constructor.
        "stock_minus_min": stock - Product.min_stock,
        "cost": Product.cost,
        "list_price": Product.list_price,
    }


def _describe_product(row: Row[Any]) -> str:
    return f"{row.name}: stock {row.stock}, mínimo {row.min_stock}, PVP {row.list_price}."


def _lot_query() -> tuple[Select[Any], dict[str, Any]]:
    balances = (
        select(StockBalance.lot_id, func.sum(StockBalance.quantity).label("quantity"))
        .where(StockBalance.lot_id.is_not(None))
        .group_by(StockBalance.lot_id)
        .subquery()
    )
    quantity = func.coalesce(balances.c.quantity, 0)
    # En PostgreSQL restar dos fechas da días enteros.
    days = Lot.expiration_date - func.current_date()
    stmt = (
        select(
            Lot.id.label("subject_id"),
            Lot.lot_number,
            Lot.expiration_date,
            Product.name,
            quantity.label("quantity"),
            days.label("days_to_expiration"),
        )
        .select_from(Lot)
        .join(Product, Product.id == Lot.product_id)
        .outerjoin(balances, balances.c.lot_id == Lot.id)
        .where(Lot.expiration_date.is_not(None))
    )
    return stmt, {"days_to_expiration": days, "quantity": quantity}


def _describe_lot(row: Row[Any]) -> str:
    return (
        f"Lote {row.lot_number} de {row.name}: caduca el {row.expiration_date} "
        f"(en {row.days_to_expiration} días), quedan {row.quantity}."
    )


SUBJECTS: dict[str, SubjectDef] = {
    "PRODUCT": SubjectDef(
        label="Productos",
        subject_type="product",
        fields={
            "stock": FieldDef(
                "Stock actual",
                FieldType.NUMBER,
                "Unidades en todos los almacenes. Ojo: lo que no lleva control de "
                "existencias sale siempre a 0 —no se le cuenta nada a propósito—, "
                "así que una regla sobre stock lo señalará todos los días.",
            ),
            "min_stock": FieldDef("Stock mínimo", FieldType.NUMBER, "El que tenga fijado."),
            "stock_minus_min": FieldDef(
                "Stock menos el mínimo",
                FieldType.NUMBER,
                'Negativo cuando está por debajo del mínimo: pon "< 0" para avisar de eso. '
                "Lo que no lleva control de existencias sale siempre por debajo.",
            ),
            "cost": FieldDef("Coste", FieldType.NUMBER, "Lo que te cuesta a ti."),
            "list_price": FieldDef("PVP", FieldType.NUMBER, "Precio de venta."),
        },
        build=_product_query,
        describe=_describe_product,
    ),
    "LOT": SubjectDef(
        label="Lotes",
        subject_type="lot",
        fields={
            "days_to_expiration": FieldDef(
                "Días hasta caducar",
                FieldType.DAYS,
                'Negativo si ya caducó. Pon "<= 7" para avisar con una semana.',
            ),
            "quantity": FieldDef(
                "Unidades del lote", FieldType.NUMBER, "Lo que queda de ese lote."
            ),
        },
        build=_lot_query,
        describe=_describe_lot,
    ),
}


def apply_conditions(
    stmt: Select[Any], columns: dict[str, Any], conditions: list[dict[str, Any]]
) -> Select[Any]:
    """Añade un WHERE por condición. Cada una es
    ``{"field": clave, "operator": símbolo, "value": número}``; cualquier
    cosa fuera de la lista blanca se rechaza aquí, antes de tocar la base
    de datos."""
    for condition in conditions:
        field = condition.get("field")
        if field not in columns:
            raise ValidationError(f"Campo desconocido: {field!r}.")
        try:
            operator = Operator(str(condition.get("operator")))
        except ValueError:
            allowed = ", ".join(o.value for o in Operator)
            raise ValidationError(
                f"Comparador desconocido: {condition.get('operator')!r}. Se admiten: {allowed}."
            ) from None
        try:
            value = Decimal(str(condition.get("value")))
        except (TypeError, ValueError, ArithmeticError):
            raise ValidationError(f"El valor de «{field}» tiene que ser un número.") from None
        stmt = stmt.where(_APPLY[operator](columns[field], value))
    return stmt


async def detect(
    session: AsyncSession, subject_key: str, conditions: list[dict[str, Any]]
) -> list[tuple[str, int, str]]:
    """``(subject_type, subject_id, mensaje)`` de todo lo que cumple ahora
    mismo **todas** las condiciones."""
    subject = SUBJECTS.get(subject_key)
    if subject is None:
        raise ValidationError(f"Sujeto desconocido: {subject_key!r}.")
    if not conditions:
        raise ValidationError("Una regla necesita al menos una condición.")

    stmt, columns = subject.build()
    rows = (await session.execute(apply_conditions(stmt, columns, conditions))).all()
    return [(subject.subject_type, row.subject_id, subject.describe(row)) for row in rows]
