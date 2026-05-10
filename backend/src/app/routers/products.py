"""Product templates router.

v0.3.0: a Product is a template that owns one or more ProductVariants.
SKU, barcode, price, cost, and stock_min live on the variant. This router
manages template-level fields (name, category, brand, type, etc.) and the
listing / aggregation across variants.

Create endpoint requires an `initial_variant` payload so a product always
has at least one variant after creation.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlmodel import Session, func, select

from app.database import engine
from app.models import (
    Product,
    ProductType,
    ProductUnit,
    ProductVariant,
    StockLevel,
)

router = APIRouter()


# ── Shapes ────────────────────────────────────────────────────────────────────


class ProductRow(BaseModel):
    id: str
    name: str
    category: Optional[str]
    brand: Optional[str]
    product_type: ProductType
    unit: ProductUnit
    iva_affected: bool
    tracks_batches: bool
    is_active: bool
    variant_count: int
    min_price_clp: Optional[float]
    max_price_clp: Optional[float]
    total_stock_qty: float
    low_stock: bool


class ProductPage(BaseModel):
    items: list[ProductRow]
    total: int
    limit: int
    offset: int


class InitialVariantInput(BaseModel):
    """Required when creating a product. Acts as its first variant."""

    sku: str = Field(min_length=1, max_length=64)
    barcode: Optional[str] = Field(default=None, max_length=64)
    display_name: Optional[str] = Field(default=None, max_length=200)
    price_clp: float = 0
    cost_clp: Optional[float] = None
    stock_min: float = 0
    attributes: list["VariantAttributeInput"] = Field(default_factory=list)


class VariantAttributeInput(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    value: str = Field(min_length=1, max_length=120)


class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    category: Optional[str] = Field(default=None, max_length=80)
    brand: Optional[str] = Field(default=None, max_length=80)
    product_type: ProductType = ProductType.product
    unit: ProductUnit = ProductUnit.unit
    iva_affected: bool = True
    tracks_batches: bool = False
    is_active: bool = True
    notes: Optional[str] = None
    initial_variant: InitialVariantInput


class ProductUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    category: Optional[str] = Field(default=None, max_length=80)
    brand: Optional[str] = Field(default=None, max_length=80)
    product_type: Optional[ProductType] = None
    unit: Optional[ProductUnit] = None
    iva_affected: Optional[bool] = None
    tracks_batches: Optional[bool] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class ProductDetail(BaseModel):
    id: str
    name: str
    description: Optional[str]
    category: Optional[str]
    brand: Optional[str]
    product_type: ProductType
    unit: ProductUnit
    iva_affected: bool
    tracks_batches: bool
    is_active: bool
    notes: Optional[str]
    variant_count: int
    min_price_clp: Optional[float]
    max_price_clp: Optional[float]
    total_stock_qty: float
    low_stock: bool


# ── Helpers ───────────────────────────────────────────────────────────────────


SortColumn = Literal["name", "category", "brand", "price", "stock", "updated_at"]
SortOrder = Literal["asc", "desc"]


def _normalize_optional_str(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _aggregate(session: Session, product_id: str, is_service: bool) -> dict:
    """Compute variant count, price range, and total stock for a product."""
    variants = session.exec(
        select(ProductVariant).where(ProductVariant.product_id == product_id)
    ).all()
    variant_count = len(variants)
    if variant_count == 0:
        return {
            "variant_count": 0,
            "min_price_clp": None,
            "max_price_clp": None,
            "total_stock_qty": 0.0,
            "low_stock": False,
        }

    prices = [float(v.price_clp) for v in variants if v.is_active]
    min_price = min(prices) if prices else None
    max_price = max(prices) if prices else None

    if is_service:
        return {
            "variant_count": variant_count,
            "min_price_clp": min_price,
            "max_price_clp": max_price,
            "total_stock_qty": 0.0,
            "low_stock": False,
        }

    variant_ids = [v.id for v in variants]
    if not variant_ids:
        total_stock = 0.0
    else:
        stock_rows = session.exec(
            select(StockLevel.qty).where(StockLevel.variant_id.in_(variant_ids))
        ).all()
        total_stock = float(sum((qty for qty in stock_rows), Decimal(0)))

    # low_stock = any variant whose total stock across warehouses <= its stock_min
    low_stock = False
    for v in variants:
        if not v.is_active:
            continue
        per_variant = session.exec(
            select(func.sum(StockLevel.qty)).where(StockLevel.variant_id == v.id)
        ).first()
        per_variant_qty = Decimal(str(per_variant or 0))
        if per_variant_qty <= v.stock_min:
            low_stock = True
            break

    return {
        "variant_count": variant_count,
        "min_price_clp": min_price,
        "max_price_clp": max_price,
        "total_stock_qty": float(total_stock),
        "low_stock": low_stock,
    }


def _to_row(session: Session, product: Product) -> ProductRow:
    agg = _aggregate(session, product.id, product.product_type == ProductType.service)
    return ProductRow(
        id=product.id,
        name=product.name,
        category=product.category,
        brand=product.brand,
        product_type=product.product_type,
        unit=product.unit,
        iva_affected=product.iva_affected,
        tracks_batches=product.tracks_batches,
        is_active=product.is_active,
        **agg,
    )


def _to_detail(session: Session, product: Product) -> ProductDetail:
    agg = _aggregate(session, product.id, product.product_type == ProductType.service)
    return ProductDetail(
        id=product.id,
        name=product.name,
        description=product.description,
        category=product.category,
        brand=product.brand,
        product_type=product.product_type,
        unit=product.unit,
        iva_affected=product.iva_affected,
        tracks_batches=product.tracks_batches,
        is_active=product.is_active,
        notes=product.notes,
        **agg,
    )


# ── List ──────────────────────────────────────────────────────────────────────


@router.get("", response_model=ProductPage)
def list_products(
    q: Optional[str] = Query(
        default=None,
        description="Busca en nombre, descripcion, SKU y barcode (via variantes).",
    ),
    category: Optional[str] = None,
    brand: Optional[str] = None,
    product_type: Optional[ProductType] = None,
    is_active: Optional[bool] = None,
    low_stock_only: bool = False,
    sort: SortColumn = "name",
    order: SortOrder = "asc",
    limit: int = Query(default=25, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> ProductPage:
    with Session(engine) as session:
        stmt = select(Product)

        if q:
            like = f"%{q.lower()}%"
            # Subquery: products whose any variant matches the search.
            matching_variant_pids = (
                select(ProductVariant.product_id)
                .where(
                    or_(
                        func.lower(ProductVariant.sku).like(like),
                        func.lower(ProductVariant.barcode).like(like),
                    )
                )
                .distinct()
            )
            stmt = stmt.where(
                or_(
                    func.lower(Product.name).like(like),
                    func.lower(Product.description).like(like),
                    Product.id.in_(matching_variant_pids),
                )
            )
        if category:
            stmt = stmt.where(Product.category == category)
        if brand:
            stmt = stmt.where(Product.brand == brand)
        if product_type:
            stmt = stmt.where(Product.product_type == product_type)
        if is_active is not None:
            stmt = stmt.where(Product.is_active == is_active)

        sort_map = {
            "name": Product.name,
            "category": Product.category,
            "brand": Product.brand,
            "price": Product.name,  # price sort fallback to name (price is per-variant)
            "stock": Product.name,  # stock sort fallback to name
            "updated_at": Product.updated_at,
        }
        sort_col = sort_map[sort]
        stmt = stmt.order_by(sort_col.desc() if order == "desc" else sort_col.asc())

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total_raw = session.exec(count_stmt).one()
        total = total_raw[0] if isinstance(total_raw, tuple) else int(total_raw)

        products = session.exec(stmt.offset(offset).limit(limit)).all()
        rows = [_to_row(session, p) for p in products]

        if low_stock_only:
            rows = [r for r in rows if r.low_stock]
            total = len(rows)

        return ProductPage(items=rows, total=int(total), limit=limit, offset=offset)


# ── Distinct lists for filter UI ─────────────────────────────────────────────


@router.get("/categories", response_model=list[str])
def list_categories() -> list[str]:
    with Session(engine) as session:
        rows = session.exec(
            select(Product.category)
            .where(Product.category.is_not(None))
            .distinct()
            .order_by(Product.category.asc())
        ).all()
        return [r for r in rows if r]


@router.get("/brands", response_model=list[str])
def list_brands() -> list[str]:
    with Session(engine) as session:
        rows = session.exec(
            select(Product.brand)
            .where(Product.brand.is_not(None))
            .distinct()
            .order_by(Product.brand.asc())
        ).all()
        return [r for r in rows if r]


# ── Detail ────────────────────────────────────────────────────────────────────


@router.get("/{product_id}", response_model=ProductDetail)
def get_product(product_id: str) -> ProductDetail:
    with Session(engine) as session:
        product = session.get(Product, product_id)
        if product is None:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        return _to_detail(session, product)


# ── Create ────────────────────────────────────────────────────────────────────


@router.post("", response_model=ProductDetail, status_code=201)
def create_product(payload: ProductCreate) -> ProductDetail:
    from app.models import VariantAttribute  # local import to avoid cycle in tests

    with Session(engine) as session:
        sku = payload.initial_variant.sku.strip()
        if not sku:
            raise HTTPException(status_code=400, detail="SKU es obligatorio en la variante inicial")
        existing = session.exec(select(ProductVariant).where(ProductVariant.sku == sku)).first()
        if existing:
            raise HTTPException(
                status_code=409, detail=f"Ya existe una variante con SKU '{sku}'"
            )

        product = Product(
            name=payload.name.strip(),
            description=_normalize_optional_str(payload.description),
            category=_normalize_optional_str(payload.category),
            brand=_normalize_optional_str(payload.brand),
            product_type=payload.product_type,
            unit=payload.unit,
            iva_affected=payload.iva_affected,
            tracks_batches=payload.tracks_batches,
            is_active=payload.is_active,
            notes=_normalize_optional_str(payload.notes),
        )
        session.add(product)
        session.flush()

        variant = ProductVariant(
            product_id=product.id,
            sku=sku,
            barcode=_normalize_optional_str(payload.initial_variant.barcode),
            display_name=_normalize_optional_str(payload.initial_variant.display_name),
            price_clp=Decimal(str(payload.initial_variant.price_clp)),
            cost_clp=(
                Decimal(str(payload.initial_variant.cost_clp))
                if payload.initial_variant.cost_clp is not None
                else None
            ),
            stock_min=Decimal(str(payload.initial_variant.stock_min)),
            is_active=True,
        )
        session.add(variant)
        session.flush()

        for attr in payload.initial_variant.attributes:
            session.add(
                VariantAttribute(
                    variant_id=variant.id,
                    name=attr.name.strip(),
                    value=attr.value.strip(),
                )
            )

        session.commit()
        session.refresh(product)
        return _to_detail(session, product)


# ── Update ────────────────────────────────────────────────────────────────────


@router.patch("/{product_id}", response_model=ProductDetail)
def update_product(product_id: str, payload: ProductUpdate) -> ProductDetail:
    with Session(engine) as session:
        product = session.get(Product, product_id)
        if product is None:
            raise HTTPException(status_code=404, detail="Producto no encontrado")

        data = payload.model_dump(exclude_unset=True)

        if "name" in data and data["name"] is not None:
            data["name"] = data["name"].strip()
            if not data["name"]:
                raise HTTPException(status_code=400, detail="Nombre no puede ser vacio")

        for field_name in ("description", "category", "brand", "notes"):
            if field_name in data:
                data[field_name] = _normalize_optional_str(data[field_name])

        for field_name, value in data.items():
            setattr(product, field_name, value)

        product.updated_at = datetime.now(timezone.utc)
        session.add(product)
        session.commit()
        session.refresh(product)
        return _to_detail(session, product)


# ── Soft delete ───────────────────────────────────────────────────────────────


@router.delete("/{product_id}", response_model=ProductDetail)
def deactivate_product(product_id: str) -> ProductDetail:
    """Soft delete: marks the product and all its variants inactive."""
    with Session(engine) as session:
        product = session.get(Product, product_id)
        if product is None:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        product.is_active = False
        product.updated_at = datetime.now(timezone.utc)
        session.add(product)

        variants = session.exec(
            select(ProductVariant).where(ProductVariant.product_id == product_id)
        ).all()
        for v in variants:
            v.is_active = False
            v.updated_at = product.updated_at
            session.add(v)

        session.commit()
        session.refresh(product)
        return _to_detail(session, product)
