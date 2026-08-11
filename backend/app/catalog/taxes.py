"""Which tax rate actually applies to a product.

Lives here, and not in ``app.pricing`` where it is mostly used, because
``app.catalog`` must not depend on ``app.pricing`` (the dependency runs
the other way) and the product's read shape needs the answer too: what a
purchase line or a receipt should default to is the *effective* rate, not
the legacy ``Product.tax_rate`` column. ``app.pricing.service`` re-exports
both so the pricing formula keeps reading them from its own module.
"""

from __future__ import annotations

from decimal import Decimal

from app.catalog.models import Product


def effective_tax_rate(product: Product) -> Decimal:
    """A product's own `taxes` win if it has any; otherwise its category's;
    otherwise the legacy scalar `Product.tax_rate` — which is what every
    product created before this feature existed, or that has never touched
    the new Tax entities, already carries (keeps the formula correct for
    them without special-casing "the tax system isn't in use here")."""
    if product.taxes:
        return sum((t.rate for t in product.taxes if t.is_active), Decimal(0))
    if product.category is not None and product.category.taxes:
        return sum((t.rate for t in product.category.taxes if t.is_active), Decimal(0))
    return product.tax_rate


def effective_surcharge_rate(product: Product) -> Decimal:
    """The *recargo de equivalencia* that goes with the product's taxes —
    same own-then-category-then-legacy-column priority as
    `effective_tax_rate`, so assigning "IVA 21%" also brings its 5.2%
    surcharge into the price without a second thing to remember.

    Only ever a **cost** input to the pricing formula: it is what the shop
    pays its supplier, never what it charges the customer, so it stays out
    of `SaleLine.tax_rate` and out of the receipt (see `Tax`)."""
    if product.taxes:
        return sum((t.surcharge_rate for t in product.taxes if t.is_active), Decimal(0))
    if product.category is not None and product.category.taxes:
        return sum((t.surcharge_rate for t in product.category.taxes if t.is_active), Decimal(0))
    return product.surcharge_rate
