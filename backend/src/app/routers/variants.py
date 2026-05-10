"""Variants router.

Variants live under a Product. SKU is globally unique. Attributes are
free-form (Talla/Color/Material/...) and stored as key-value rows.

Endpoints are mounted with prefix /api so paths read naturally:
  GET    /api/products/{product_id}/variants
  POST   /api/products/{product_id}/variants
  GET    /api/variants/{variant_id}
  PATCH  /api/variants/{variant_id}
  DELETE /api/variants/{variant_id}
  GET    /api/variants/attribute-names
  GET    /api/variants/attribute-values?name=Talla
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, func, select

from app.database import engine
from app.models import (
    Product,
    ProductVariant,
    StockLevel,
    VariantAttribute,
)

router = APIRouter()


# ── Shapes ────────────────────────────────────────────────────────────────────


class AttributeOut(BaseModel):
    name: str
    value: str


class VariantRow(BaseModel):
    id: str
    product_id: str
    sku: str
    barcode: Optional[str]
    display_name: Optional[str]
    price_clp: float
    cost_clp: Optional[float]
    stock_min: float
    is_active: bool
    attributes: list[AttributeOut]
    total_stock_qty: float
    low_stock: bool


class AttributeInput(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    value: str = Field(min_length=1, max_length=120)


class VariantCreate(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    barcode: Optional[str] = Field(default=None, max_length=64)
    display_name: Optional[str] = Field(default=None, max_length=200)
    price_clp: float = 0
    cost_clp: Optional[float] = None
    stock_min: float = 0
    is_active: bool = True
    attributes: list[AttributeInput] = []


class VariantUpdate(BaseModel):
    sku: Optional[str] = Field(default=None, min_length=1, max_length=64)
    barcode: Optional[str] = Field(default=None, max_length=64)
    display_name: Optional[str] = Field(default=None, max_length=200)
    price_clp: Optional[float] = None
    cost_clp: Optional[float] = None
    stock_min: Optional[float] = None
    is_active: Optional[bool] = None
    attributes: Optional[list[AttributeInput]] = None


# ── Helpers ───────────────────────────────────────────────────────────────────


def _normalize_optional_str(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _variant_total_stock(session: Session, variant_id: str) -> float:
    total = session.exec(
        select(func.sum(StockLevel.qty)).where(StockLevel.variant_id == variant_id)
    ).first()
    return float(total or 0)


def _variant_attributes(session: Session, variant_id: str) -> list[AttributeOut]:
    rows = session.exec(
        select(VariantAttribute)
        .where(VariantAttribute.variant_id == variant_id)
        .order_by(VariantAttribute.name.asc())
    ).all()
    return [AttributeOut(name=r.name, value=r.value) for r in rows]


def _to_row(session: Session, variant: ProductVariant) -> VariantRow:
    total_stock = _variant_total_stock(session, variant.id)
    return VariantRow(
        id=variant.id,
        product_id=variant.product_id,
        sku=variant.sku,
        barcode=variant.barcode,
        display_name=variant.display_name,
        price_clp=float(variant.price_clp),
        cost_clp=float(variant.cost_clp) if variant.cost_clp is not None else None,
        stock_min=float(variant.stock_min),
        is_active=variant.is_active,
        attributes=_variant_attributes(session, variant.id),
        total_stock_qty=total_stock,
        low_stock=Decimal(str(total_stock)) <= variant.stock_min,
    )


def _replace_attributes(
    session: Session, variant_id: str, attributes: list[AttributeInput]
) -> None:
    session.exec(
        VariantAttribute.__table__.delete().where(
            VariantAttribute.__table__.c.variant_id == variant_id
        )
    )
    for attr in attributes:
        session.add(
            VariantAttribute(
                variant_id=variant_id,
                name=attr.name.strip(),
                value=attr.value.strip(),
            )
        )


# ── List per product ──────────────────────────────────────────────────────────


@router.get("/products/{product_id}/variants", response_model=list[VariantRow])
def list_variants(product_id: str, include_inactive: bool = False) -> list[VariantRow]:
    with Session(engine) as session:
        product = session.get(Product, product_id)
        if product is None:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        stmt = select(ProductVariant).where(ProductVariant.product_id == product_id)
        if not include_inactive:
            stmt = stmt.where(ProductVariant.is_active.is_(True))
        stmt = stmt.order_by(ProductVariant.created_at.asc())
        variants = session.exec(stmt).all()
        return [_to_row(session, v) for v in variants]


# ── Create variant ────────────────────────────────────────────────────────────


@router.post(
    "/products/{product_id}/variants",
    response_model=VariantRow,
    status_code=201,
)
def create_variant(product_id: str, payload: VariantCreate) -> VariantRow:
    with Session(engine) as session:
        product = session.get(Product, product_id)
        if product is None:
            raise HTTPException(status_code=404, detail="Producto no encontrado")

        sku = payload.sku.strip()
        existing = session.exec(select(ProductVariant).where(ProductVariant.sku == sku)).first()
        if existing:
            raise HTTPException(
                status_code=409, detail=f"Ya existe una variante con SKU '{sku}'"
            )

        variant = ProductVariant(
            product_id=product_id,
            sku=sku,
            barcode=_normalize_optional_str(payload.barcode),
            display_name=_normalize_optional_str(payload.display_name),
            price_clp=Decimal(str(payload.price_clp)),
            cost_clp=Decimal(str(payload.cost_clp)) if payload.cost_clp is not None else None,
            stock_min=Decimal(str(payload.stock_min)),
            is_active=payload.is_active,
        )
        session.add(variant)
        session.flush()

        for attr in payload.attributes:
            session.add(
                VariantAttribute(
                    variant_id=variant.id,
                    name=attr.name.strip(),
                    value=attr.value.strip(),
                )
            )

        session.commit()
        session.refresh(variant)
        return _to_row(session, variant)


# ── Detail / update / delete by variant id ───────────────────────────────────


@router.get("/variants/{variant_id}", response_model=VariantRow)
def get_variant(variant_id: str) -> VariantRow:
    with Session(engine) as session:
        variant = session.get(ProductVariant, variant_id)
        if variant is None:
            raise HTTPException(status_code=404, detail="Variante no encontrada")
        return _to_row(session, variant)


@router.patch("/variants/{variant_id}", response_model=VariantRow)
def update_variant(variant_id: str, payload: VariantUpdate) -> VariantRow:
    with Session(engine) as session:
        variant = session.get(ProductVariant, variant_id)
        if variant is None:
            raise HTTPException(status_code=404, detail="Variante no encontrada")

        data = payload.model_dump(exclude_unset=True)

        if "sku" in data:
            new_sku = data["sku"].strip()
            if not new_sku:
                raise HTTPException(status_code=400, detail="SKU no puede ser vacio")
            if new_sku != variant.sku:
                clash = session.exec(
                    select(ProductVariant)
                    .where(ProductVariant.sku == new_sku)
                    .where(ProductVariant.id != variant_id)
                ).first()
                if clash:
                    raise HTTPException(
                        status_code=409, detail=f"Ya existe una variante con SKU '{new_sku}'"
                    )
            data["sku"] = new_sku

        for field_name in ("barcode", "display_name"):
            if field_name in data:
                data[field_name] = _normalize_optional_str(data[field_name])

        for field_name in ("price_clp", "stock_min"):
            if field_name in data and data[field_name] is not None:
                data[field_name] = Decimal(str(data[field_name]))

        if "cost_clp" in data:
            data["cost_clp"] = (
                Decimal(str(data["cost_clp"])) if data["cost_clp"] is not None else None
            )

        attributes = data.pop("attributes", None)

        for field_name, value in data.items():
            setattr(variant, field_name, value)

        variant.updated_at = datetime.now(timezone.utc)
        session.add(variant)

        if attributes is not None:
            _replace_attributes(session, variant_id, attributes)

        session.commit()
        session.refresh(variant)
        return _to_row(session, variant)


@router.delete("/variants/{variant_id}", response_model=VariantRow)
def deactivate_variant(variant_id: str) -> VariantRow:
    """Soft delete a variant. The product is unchanged; if this is the only
    active variant the caller should follow up by deactivating the product."""
    with Session(engine) as session:
        variant = session.get(ProductVariant, variant_id)
        if variant is None:
            raise HTTPException(status_code=404, detail="Variante no encontrada")
        variant.is_active = False
        variant.updated_at = datetime.now(timezone.utc)
        session.add(variant)
        session.commit()
        session.refresh(variant)
        return _to_row(session, variant)


# ── Attribute autocomplete ────────────────────────────────────────────────────


@router.get("/variants/attribute-names", response_model=list[str])
def list_attribute_names() -> list[str]:
    with Session(engine) as session:
        rows = session.exec(
            select(VariantAttribute.name).distinct().order_by(VariantAttribute.name.asc())
        ).all()
        return list(rows)


@router.get("/variants/attribute-values", response_model=list[str])
def list_attribute_values(name: str = Query(..., min_length=1)) -> list[str]:
    with Session(engine) as session:
        rows = session.exec(
            select(VariantAttribute.value)
            .where(VariantAttribute.name == name)
            .distinct()
            .order_by(VariantAttribute.value.asc())
        ).all()
        return list(rows)
