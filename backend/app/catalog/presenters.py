"""ORM -> response-schema conversion shared by ``app.catalog.router`` and
``app.pricing.router`` (which also returns a full ``ProductRead`` after
every price change)."""

from __future__ import annotations

from app.catalog import stock, taxes
from app.catalog.models import Product, ProductCategory, ProductPackage
from app.catalog.schemas import (
    BarcodeRead,
    PackageRead,
    ProductCategoryRead,
    ProductRead,
    ProductTaxRead,
)


def category_to_read(category: ProductCategory) -> ProductCategoryRead:
    return ProductCategoryRead(
        id=category.id,
        name=category.name,
        is_active=category.is_active,
        margin_rate=category.margin_rate,
        tracks_stock=category.tracks_stock,
        taxes=[ProductTaxRead(id=t.id, name=t.name, rate=t.rate) for t in category.taxes],
    )


def package_to_read(package: ProductPackage) -> PackageRead:
    return PackageRead(
        id=package.id,
        name=package.name,
        factor=package.factor,
        is_base=package.is_base,
        barcodes=[BarcodeRead(id=b.id, barcode=b.barcode) for b in package.barcodes],
    )


def product_to_read(product: Product) -> ProductRead:
    return ProductRead(
        id=product.id,
        sku=product.sku,
        name=product.name,
        description=product.description,
        category_id=product.category_id,
        category_name=product.category.name if product.category else None,
        pos_category_id=product.pos_category_id,
        pos_category_name=product.pos_category.name if product.pos_category else None,
        pos_display_order=product.pos_display_order,
        base_unit_name=product.base_unit_name,
        cost=product.cost,
        list_price=product.list_price,
        tax_rate=product.tax_rate,
        surcharge_rate=product.surcharge_rate,
        effective_tax_rate=taxes.effective_tax_rate(product),
        margin_rate=product.margin_rate,
        taxes=[ProductTaxRead(id=t.id, name=t.name, rate=t.rate) for t in product.taxes],
        price_formula=product.price_formula,
        min_stock=product.min_stock,
        track_lots=product.track_lots,
        track_expiration=product.track_expiration,
        tracks_stock=product.tracks_stock,
        effective_tracks_stock=stock.tracks_stock(product),
        is_active=product.is_active,
        packages=[package_to_read(p) for p in product.packages],
    )
