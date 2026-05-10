"""Batches router.

Only meaningful for products with tracks_batches=True. Endpoints:
  GET    /api/variants/{vid}/batches              — list batches for variant
  POST   /api/variants/{vid}/batches              — create batch (initial qty syncs stock)
  GET    /api/batches/{id}                        — detail
  PATCH  /api/batches/{id}                        — update lot_number/expiry/notes (qty via stock adjust)
  DELETE /api/batches/{id}                        — only if qty == 0
  GET    /api/batches/expiring?within_days=30     — batches expiring soon
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.database import engine
from app.models import (
    Batch,
    Product,
    ProductVariant,
    StockLevel,
    StockMovement,
    StockMovementKind,
    Warehouse,
)

router = APIRouter()


# ── Shapes ────────────────────────────────────────────────────────────────────


class BatchRow(BaseModel):
    id: str
    variant_id: str
    variant_sku: str
    product_id: str
    product_name: str
    warehouse_id: str
    warehouse_code: str
    lot_number: str
    expiry_date: Optional[date]
    qty: float
    received_at: datetime
    notes: Optional[str]
    days_to_expiry: Optional[int]
    is_expired: bool


class BatchCreate(BaseModel):
    warehouse_id: str
    lot_number: str = Field(min_length=1, max_length=80)
    expiry_date: Optional[date] = None
    qty: float = Field(default=0, ge=0)
    notes: Optional[str] = None


class BatchUpdate(BaseModel):
    lot_number: Optional[str] = Field(default=None, min_length=1, max_length=80)
    expiry_date: Optional[date] = None
    notes: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────


def _to_row(
    batch: Batch, variant: ProductVariant, product: Product, warehouse: Warehouse
) -> BatchRow:
    today = datetime.now(timezone.utc).date()
    days_to_expiry: Optional[int] = None
    is_expired = False
    if batch.expiry_date is not None:
        days_to_expiry = (batch.expiry_date - today).days
        is_expired = batch.expiry_date < today
    return BatchRow(
        id=batch.id,
        variant_id=variant.id,
        variant_sku=variant.sku,
        product_id=product.id,
        product_name=product.name,
        warehouse_id=warehouse.id,
        warehouse_code=warehouse.code,
        lot_number=batch.lot_number,
        expiry_date=batch.expiry_date,
        qty=float(batch.qty),
        received_at=batch.received_at,
        notes=batch.notes,
        days_to_expiry=days_to_expiry,
        is_expired=is_expired,
    )


def _load_row_context(session: Session, batch: Batch) -> BatchRow:
    variant = session.get(ProductVariant, batch.variant_id)
    product = session.get(Product, variant.product_id) if variant else None
    warehouse = session.get(Warehouse, batch.warehouse_id)
    if not (variant and product and warehouse):
        raise HTTPException(status_code=500, detail="Datos relacionados al lote no encontrados.")
    return _to_row(batch, variant, product, warehouse)


def _normalize_optional_str(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _bump_stock_level(
    session: Session, variant_id: str, warehouse_id: str, delta: Decimal
) -> StockLevel:
    level = session.exec(
        select(StockLevel)
        .where(StockLevel.variant_id == variant_id)
        .where(StockLevel.warehouse_id == warehouse_id)
    ).first()
    if level is None:
        level = StockLevel(
            variant_id=variant_id, warehouse_id=warehouse_id, qty=Decimal("0")
        )
        session.add(level)
        session.flush()
    level.qty = level.qty + delta
    level.updated_at = datetime.now(timezone.utc)
    session.add(level)
    return level


# ── List for variant ──────────────────────────────────────────────────────────


@router.get("/variants/{variant_id}/batches", response_model=list[BatchRow])
def list_variant_batches(variant_id: str) -> list[BatchRow]:
    with Session(engine) as session:
        variant = session.get(ProductVariant, variant_id)
        if variant is None:
            raise HTTPException(status_code=404, detail="Variante no encontrada")
        product = session.get(Product, variant.product_id)
        if product is None:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        if not product.tracks_batches:
            return []
        rows = session.exec(
            select(Batch, Warehouse)
            .join(Warehouse, Warehouse.id == Batch.warehouse_id)
            .where(Batch.variant_id == variant_id)
            .order_by(Batch.expiry_date.is_(None), Batch.expiry_date.asc())
        ).all()
        return [_to_row(b, variant, product, wh) for b, wh in rows]


# ── Create ────────────────────────────────────────────────────────────────────


@router.post(
    "/variants/{variant_id}/batches",
    response_model=BatchRow,
    status_code=201,
)
def create_batch(variant_id: str, payload: BatchCreate) -> BatchRow:
    with Session(engine) as session:
        variant = session.get(ProductVariant, variant_id)
        if variant is None:
            raise HTTPException(status_code=404, detail="Variante no encontrada")
        product = session.get(Product, variant.product_id)
        if product is None:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        if not product.tracks_batches:
            raise HTTPException(
                status_code=400,
                detail="Este producto no maneja lotes (tracks_batches=False).",
            )
        warehouse = session.get(Warehouse, payload.warehouse_id)
        if warehouse is None:
            raise HTTPException(status_code=404, detail="Bodega no encontrada")

        lot = payload.lot_number.strip()
        clash = session.exec(
            select(Batch)
            .where(Batch.variant_id == variant_id)
            .where(Batch.warehouse_id == payload.warehouse_id)
            .where(Batch.lot_number == lot)
        ).first()
        if clash:
            raise HTTPException(
                status_code=409,
                detail=f"Ya existe el lote '{lot}' en esa bodega para esta variante.",
            )

        qty = Decimal(str(payload.qty))
        batch = Batch(
            id=str(uuid4()),
            variant_id=variant_id,
            warehouse_id=payload.warehouse_id,
            lot_number=lot,
            expiry_date=payload.expiry_date,
            qty=qty,
            notes=_normalize_optional_str(payload.notes),
        )
        session.add(batch)
        session.flush()

        if qty > 0:
            level = _bump_stock_level(session, variant_id, payload.warehouse_id, qty)
            session.add(
                StockMovement(
                    variant_id=variant_id,
                    warehouse_id=payload.warehouse_id,
                    batch_id=batch.id,
                    kind=StockMovementKind.entrada,
                    quantity=qty,
                    qty_after=level.qty,
                    reason=f"Recepcion lote {lot}",
                )
            )

        session.commit()
        session.refresh(batch)
        return _load_row_context(session, batch)


# ── Expiring soon (must be declared BEFORE the /{batch_id} routes) ───────────


@router.get("/batches/expiring", response_model=list[BatchRow])
def list_expiring_batches(
    within_days: int = Query(default=30, ge=0, le=365),
    warehouse_id: Optional[str] = None,
) -> list[BatchRow]:
    """Returns batches whose expiry_date is within `within_days` from today,
    including already-expired batches with qty > 0."""
    today = datetime.now(timezone.utc).date()
    cutoff = today + timedelta(days=within_days)

    with Session(engine) as session:
        stmt = (
            select(Batch, ProductVariant, Product, Warehouse)
            .join(ProductVariant, ProductVariant.id == Batch.variant_id)
            .join(Product, Product.id == ProductVariant.product_id)
            .join(Warehouse, Warehouse.id == Batch.warehouse_id)
            .where(Batch.expiry_date.is_not(None))
            .where(Batch.expiry_date <= cutoff)
            .where(Batch.qty > 0)
        )
        if warehouse_id:
            stmt = stmt.where(Batch.warehouse_id == warehouse_id)
        stmt = stmt.order_by(Batch.expiry_date.asc())
        rows = session.exec(stmt).all()
        return [_to_row(b, v, p, w) for b, v, p, w in rows]


# ── Detail / update / delete ──────────────────────────────────────────────────


@router.get("/batches/{batch_id}", response_model=BatchRow)
def get_batch(batch_id: str) -> BatchRow:
    with Session(engine) as session:
        batch = session.get(Batch, batch_id)
        if batch is None:
            raise HTTPException(status_code=404, detail="Lote no encontrado")
        return _load_row_context(session, batch)


@router.patch("/batches/{batch_id}", response_model=BatchRow)
def update_batch(batch_id: str, payload: BatchUpdate) -> BatchRow:
    with Session(engine) as session:
        batch = session.get(Batch, batch_id)
        if batch is None:
            raise HTTPException(status_code=404, detail="Lote no encontrado")

        data = payload.model_dump(exclude_unset=True)

        if "lot_number" in data and data["lot_number"] is not None:
            new_lot = data["lot_number"].strip()
            if new_lot != batch.lot_number:
                clash = session.exec(
                    select(Batch)
                    .where(Batch.variant_id == batch.variant_id)
                    .where(Batch.warehouse_id == batch.warehouse_id)
                    .where(Batch.lot_number == new_lot)
                    .where(Batch.id != batch_id)
                ).first()
                if clash:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Ya existe el lote '{new_lot}' en esa bodega.",
                    )
            data["lot_number"] = new_lot

        if "notes" in data:
            data["notes"] = _normalize_optional_str(data["notes"])

        for field_name, value in data.items():
            setattr(batch, field_name, value)

        session.add(batch)
        session.commit()
        session.refresh(batch)
        return _load_row_context(session, batch)


@router.delete("/batches/{batch_id}", status_code=204)
def delete_batch(batch_id: str) -> None:
    with Session(engine) as session:
        batch = session.get(Batch, batch_id)
        if batch is None:
            raise HTTPException(status_code=404, detail="Lote no encontrado")
        if batch.qty != 0:
            raise HTTPException(
                status_code=400,
                detail=f"No se puede eliminar un lote con stock (qty={batch.qty}). Ajusta a 0 primero.",
            )
        session.delete(batch)
        session.commit()


