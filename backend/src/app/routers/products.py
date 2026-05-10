"""Products router — catalog CRUD.

Listado paginado con búsqueda + filtros, detalle, create/update/soft-delete,
y listas distinct para categorias y marcas.
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
from app.models import Product, ProductType, ProductUnit

router = APIRouter()


# ── Shapes ────────────────────────────────────────────────────────────────────


class ProductRow(BaseModel):
    id: str
    sku: str
    barcode: Optional[str]
    name: str
    category: Optional[str]
    brand: Optional[str]
    product_type: ProductType
    unit: ProductUnit
    price_clp: float
    cost_clp: Optional[float]
    iva_affected: bool
    stock_qty: float
    stock_min: float
    is_active: bool
    low_stock: bool


class ProductDetail(ProductRow):
    description: Optional[str]
    notes: Optional[str]


class ProductPage(BaseModel):
    items: list[ProductRow]
    total: int
    limit: int
    offset: int


class ProductCreate(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    barcode: Optional[str] = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    category: Optional[str] = Field(default=None, max_length=80)
    brand: Optional[str] = Field(default=None, max_length=80)
    product_type: ProductType = ProductType.product
    unit: ProductUnit = ProductUnit.unit
    price_clp: float = 0
    cost_clp: Optional[float] = None
    iva_affected: bool = True
    stock_qty: float = 0
    stock_min: float = 0
    is_active: bool = True
    notes: Optional[str] = None


class ProductUpdate(BaseModel):
    sku: Optional[str] = Field(default=None, min_length=1, max_length=64)
    barcode: Optional[str] = Field(default=None, max_length=64)
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    category: Optional[str] = Field(default=None, max_length=80)
    brand: Optional[str] = Field(default=None, max_length=80)
    product_type: Optional[ProductType] = None
    unit: Optional[ProductUnit] = None
    price_clp: Optional[float] = None
    cost_clp: Optional[float] = None
    iva_affected: Optional[bool] = None
    stock_qty: Optional[float] = None
    stock_min: Optional[float] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────


SortColumn = Literal["sku", "name", "category", "brand", "price", "stock", "updated_at"]
SortOrder = Literal["asc", "desc"]


def _to_row(product: Product) -> ProductRow:
    return ProductRow(
        id=product.id,
        sku=product.sku,
        barcode=product.barcode,
        name=product.name,
        category=product.category,
        brand=product.brand,
        product_type=product.product_type,
        unit=product.unit,
        price_clp=float(product.price_clp),
        cost_clp=float(product.cost_clp) if product.cost_clp is not None else None,
        iva_affected=product.iva_affected,
        stock_qty=float(product.stock_qty),
        stock_min=float(product.stock_min),
        is_active=product.is_active,
        low_stock=(
            product.product_type == ProductType.product
            and product.stock_qty <= product.stock_min
        ),
    )


def _to_detail(product: Product) -> ProductDetail:
    base = _to_row(product)
    return ProductDetail(
        **base.model_dump(),
        description=product.description,
        notes=product.notes,
    )


# ── List ──────────────────────────────────────────────────────────────────────


@router.get("", response_model=ProductPage)
def list_products(
    q: Optional[str] = Query(
        default=None,
        description="Busca en SKU, nombre y barcode (case-insensitive).",
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
            stmt = stmt.where(
                or_(
                    func.lower(Product.sku).like(like),
                    func.lower(Product.name).like(like),
                    func.lower(Product.barcode).like(like),
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
        if low_stock_only:
            stmt = stmt.where(Product.product_type == ProductType.product).where(
                Product.stock_qty <= Product.stock_min
            )

        sort_columns = {
            "sku": Product.sku,
            "name": Product.name,
            "category": Product.category,
            "brand": Product.brand,
            "price": Product.price_clp,
            "stock": Product.stock_qty,
            "updated_at": Product.updated_at,
        }
        sort_col = sort_columns[sort]
        stmt = stmt.order_by(sort_col.desc() if order == "desc" else sort_col.asc())

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total_raw = session.exec(count_stmt).one()
        total = total_raw[0] if isinstance(total_raw, tuple) else int(total_raw)

        rows = session.exec(stmt.offset(offset).limit(limit)).all()
        return ProductPage(
            items=[_to_row(p) for p in rows],
            total=int(total),
            limit=limit,
            offset=offset,
        )


# ── Distinct lists for filters ───────────────────────────────────────────────


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
        return _to_detail(product)


# ── Create ────────────────────────────────────────────────────────────────────


def _normalize_optional_str(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


@router.post("", response_model=ProductDetail, status_code=201)
def create_product(payload: ProductCreate) -> ProductDetail:
    with Session(engine) as session:
        sku = payload.sku.strip()
        if not sku:
            raise HTTPException(status_code=400, detail="SKU es obligatorio")

        existing = session.exec(select(Product).where(Product.sku == sku)).first()
        if existing:
            raise HTTPException(status_code=409, detail=f"Ya existe un producto con SKU '{sku}'")

        product = Product(
            sku=sku,
            barcode=_normalize_optional_str(payload.barcode),
            name=payload.name.strip(),
            description=_normalize_optional_str(payload.description),
            category=_normalize_optional_str(payload.category),
            brand=_normalize_optional_str(payload.brand),
            product_type=payload.product_type,
            unit=payload.unit,
            price_clp=Decimal(str(payload.price_clp)),
            cost_clp=Decimal(str(payload.cost_clp)) if payload.cost_clp is not None else None,
            iva_affected=payload.iva_affected,
            stock_qty=Decimal(str(payload.stock_qty)),
            stock_min=Decimal(str(payload.stock_min)),
            is_active=payload.is_active,
            notes=_normalize_optional_str(payload.notes),
        )
        session.add(product)
        session.commit()
        session.refresh(product)
        return _to_detail(product)


# ── Update ────────────────────────────────────────────────────────────────────


@router.patch("/{product_id}", response_model=ProductDetail)
def update_product(product_id: str, payload: ProductUpdate) -> ProductDetail:
    with Session(engine) as session:
        product = session.get(Product, product_id)
        if product is None:
            raise HTTPException(status_code=404, detail="Producto no encontrado")

        data = payload.model_dump(exclude_unset=True)

        if "sku" in data:
            new_sku = data["sku"].strip()
            if not new_sku:
                raise HTTPException(status_code=400, detail="SKU no puede ser vacio")
            if new_sku != product.sku:
                clash = session.exec(
                    select(Product).where(Product.sku == new_sku).where(Product.id != product_id)
                ).first()
                if clash:
                    raise HTTPException(status_code=409, detail=f"Ya existe un producto con SKU '{new_sku}'")
            data["sku"] = new_sku

        if "name" in data and data["name"] is not None:
            data["name"] = data["name"].strip()
            if not data["name"]:
                raise HTTPException(status_code=400, detail="Nombre no puede ser vacio")

        for field in ("barcode", "description", "category", "brand", "notes"):
            if field in data:
                data[field] = _normalize_optional_str(data[field])

        for field in ("price_clp", "stock_qty", "stock_min"):
            if field in data and data[field] is not None:
                data[field] = Decimal(str(data[field]))

        if "cost_clp" in data:
            data["cost_clp"] = (
                Decimal(str(data["cost_clp"])) if data["cost_clp"] is not None else None
            )

        for field, value in data.items():
            setattr(product, field, value)

        product.updated_at = datetime.now(timezone.utc)
        session.add(product)
        session.commit()
        session.refresh(product)
        return _to_detail(product)


# ── Soft delete ───────────────────────────────────────────────────────────────


@router.delete("/{product_id}", response_model=ProductDetail)
def deactivate_product(product_id: str) -> ProductDetail:
    """Soft delete: marks the product inactive. Does not remove the row so
    references from past documents remain valid."""
    with Session(engine) as session:
        product = session.get(Product, product_id)
        if product is None:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        product.is_active = False
        product.updated_at = datetime.now(timezone.utc)
        session.add(product)
        session.commit()
        session.refresh(product)
        return _to_detail(product)
