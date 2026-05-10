"""Stock router.

Endpoints:
  GET  /api/stock                       — list stock levels (per variant+warehouse) with filters
  GET  /api/stock/by-variant/{vid}      — stock breakdown across warehouses for one variant
  POST /api/stock/adjust                — entrada / salida / ajuste on a (variant, warehouse) tuple,
                                           optionally bound to a batch. Writes a StockMovement and
                                           updates the StockLevel row.
  GET  /api/stock/movements             — paginated history with filters

Invariants:
  - When the product has tracks_batches=True, every adjust must specify a batch_id.
    Adjusts that change a batch's qty also update the parent StockLevel atomically.
  - Salida/ajuste-negative cannot drive stock below zero (router rejects).
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, func, select

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


class StockLevelRow(BaseModel):
    id: str
    variant_id: str
    variant_sku: str
    variant_display: str
    product_id: str
    product_name: str
    warehouse_id: str
    warehouse_code: str
    warehouse_name: str
    qty: float
    stock_min: float
    low_stock: bool
    tracks_batches: bool


class StockAdjustInput(BaseModel):
    variant_id: str
    warehouse_id: str
    kind: StockMovementKind
    quantity: float = Field(
        gt=0,
        description="Always positive magnitude. The sign comes from `kind` (entrada=+, salida=-, ajuste set via `target_qty`).",
    )
    target_qty: Optional[float] = Field(
        default=None,
        description="Only for kind=ajuste: the new absolute qty. If provided, `quantity` is ignored.",
    )
    batch_id: Optional[str] = None
    reason: Optional[str] = None


class MovementRow(BaseModel):
    id: str
    occurred_at: datetime
    kind: StockMovementKind
    quantity: float
    qty_after: float
    variant_id: str
    variant_sku: str
    variant_display: str
    warehouse_id: str
    warehouse_code: str
    batch_id: Optional[str]
    lot_number: Optional[str]
    reason: Optional[str]


class MovementPage(BaseModel):
    items: list[MovementRow]
    total: int
    limit: int
    offset: int


# ── Helpers ───────────────────────────────────────────────────────────────────


def _variant_display(variant: ProductVariant, product: Product) -> str:
    if variant.display_name:
        return variant.display_name
    return f"{product.name} ({variant.sku})"


def _get_or_create_stock_level(
    session: Session, variant_id: str, warehouse_id: str
) -> StockLevel:
    existing = session.exec(
        select(StockLevel)
        .where(StockLevel.variant_id == variant_id)
        .where(StockLevel.warehouse_id == warehouse_id)
    ).first()
    if existing:
        return existing
    level = StockLevel(variant_id=variant_id, warehouse_id=warehouse_id, qty=Decimal("0"))
    session.add(level)
    session.flush()
    return level


# ── List stock levels ─────────────────────────────────────────────────────────


@router.get("", response_model=list[StockLevelRow])
def list_stock_levels(
    q: Optional[str] = Query(default=None, description="Busca por SKU, barcode o nombre."),
    warehouse_id: Optional[str] = None,
    product_id: Optional[str] = None,
    low_stock_only: bool = False,
    limit: int = Query(default=200, ge=1, le=1000),
) -> list[StockLevelRow]:
    with Session(engine) as session:
        stmt = (
            select(StockLevel, ProductVariant, Product, Warehouse)
            .join(ProductVariant, ProductVariant.id == StockLevel.variant_id)
            .join(Product, Product.id == ProductVariant.product_id)
            .join(Warehouse, Warehouse.id == StockLevel.warehouse_id)
        )
        if warehouse_id:
            stmt = stmt.where(StockLevel.warehouse_id == warehouse_id)
        if product_id:
            stmt = stmt.where(ProductVariant.product_id == product_id)
        if q:
            like = f"%{q.lower()}%"
            stmt = stmt.where(
                (func.lower(ProductVariant.sku).like(like))
                | (func.lower(ProductVariant.barcode).like(like))
                | (func.lower(Product.name).like(like))
                | (func.lower(ProductVariant.display_name).like(like))
            )
        stmt = stmt.order_by(Product.name.asc(), ProductVariant.sku.asc()).limit(limit)
        rows = session.exec(stmt).all()
        out: list[StockLevelRow] = []
        for level, variant, product, warehouse in rows:
            qty_f = float(level.qty)
            low = (
                product.product_type.value == "product"
                and Decimal(str(qty_f)) <= variant.stock_min
            )
            if low_stock_only and not low:
                continue
            out.append(
                StockLevelRow(
                    id=level.id,
                    variant_id=variant.id,
                    variant_sku=variant.sku,
                    variant_display=_variant_display(variant, product),
                    product_id=product.id,
                    product_name=product.name,
                    warehouse_id=warehouse.id,
                    warehouse_code=warehouse.code,
                    warehouse_name=warehouse.name,
                    qty=qty_f,
                    stock_min=float(variant.stock_min),
                    low_stock=low,
                    tracks_batches=product.tracks_batches,
                )
            )
        return out


# ── By variant (breakdown across warehouses) ─────────────────────────────────


@router.get("/by-variant/{variant_id}", response_model=list[StockLevelRow])
def stock_by_variant(variant_id: str) -> list[StockLevelRow]:
    with Session(engine) as session:
        variant = session.get(ProductVariant, variant_id)
        if variant is None:
            raise HTTPException(status_code=404, detail="Variante no encontrada")
        product = session.get(Product, variant.product_id)
        if product is None:
            raise HTTPException(status_code=404, detail="Producto no encontrado")

        warehouses = session.exec(
            select(Warehouse).where(Warehouse.is_active.is_(True)).order_by(Warehouse.name.asc())
        ).all()

        out: list[StockLevelRow] = []
        for wh in warehouses:
            level = session.exec(
                select(StockLevel)
                .where(StockLevel.variant_id == variant_id)
                .where(StockLevel.warehouse_id == wh.id)
            ).first()
            qty = float(level.qty) if level else 0.0
            low = (
                product.product_type.value == "product"
                and Decimal(str(qty)) <= variant.stock_min
            )
            out.append(
                StockLevelRow(
                    id=level.id if level else f"virtual-{variant_id}-{wh.id}",
                    variant_id=variant.id,
                    variant_sku=variant.sku,
                    variant_display=_variant_display(variant, product),
                    product_id=product.id,
                    product_name=product.name,
                    warehouse_id=wh.id,
                    warehouse_code=wh.code,
                    warehouse_name=wh.name,
                    qty=qty,
                    stock_min=float(variant.stock_min),
                    low_stock=low,
                    tracks_batches=product.tracks_batches,
                )
            )
        return out


# ── Adjust ────────────────────────────────────────────────────────────────────


@router.post("/adjust", response_model=StockLevelRow, status_code=201)
def adjust_stock(payload: StockAdjustInput) -> StockLevelRow:
    with Session(engine) as session:
        variant = session.get(ProductVariant, payload.variant_id)
        if variant is None:
            raise HTTPException(status_code=404, detail="Variante no encontrada")
        product = session.get(Product, variant.product_id)
        if product is None:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        warehouse = session.get(Warehouse, payload.warehouse_id)
        if warehouse is None:
            raise HTTPException(status_code=404, detail="Bodega no encontrada")

        if product.product_type.value == "service":
            raise HTTPException(
                status_code=400,
                detail="No se puede ajustar stock de un servicio.",
            )

        batch: Optional[Batch] = None
        if product.tracks_batches:
            if payload.batch_id is None:
                raise HTTPException(
                    status_code=400,
                    detail="Este producto maneja lotes; especifica batch_id en el ajuste.",
                )
            batch = session.get(Batch, payload.batch_id)
            if batch is None:
                raise HTTPException(status_code=404, detail="Lote no encontrado")
            if batch.variant_id != variant.id or batch.warehouse_id != warehouse.id:
                raise HTTPException(
                    status_code=400,
                    detail="El lote no corresponde a esta variante o bodega.",
                )
        elif payload.batch_id is not None:
            raise HTTPException(
                status_code=400,
                detail="Este producto no maneja lotes; omite batch_id.",
            )

        level = _get_or_create_stock_level(session, variant.id, warehouse.id)
        qty_before = level.qty
        magnitude = Decimal(str(payload.quantity))

        if payload.kind == StockMovementKind.entrada:
            delta = magnitude
        elif payload.kind == StockMovementKind.salida:
            delta = -magnitude
            if level.qty + delta < 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Stock insuficiente: hay {level.qty}, intentas sacar {magnitude}.",
                )
        else:  # ajuste
            if payload.target_qty is None:
                raise HTTPException(
                    status_code=400,
                    detail="Para kind=ajuste se requiere target_qty (cantidad final deseada).",
                )
            target = Decimal(str(payload.target_qty))
            if target < 0:
                raise HTTPException(status_code=400, detail="target_qty no puede ser negativo.")
            delta = target - level.qty

        new_qty = level.qty + delta
        level.qty = new_qty
        level.updated_at = datetime.now(timezone.utc)
        session.add(level)

        if batch is not None:
            if batch.qty + delta < 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Stock insuficiente en lote: hay {batch.qty}, delta {delta}.",
                )
            batch.qty = batch.qty + delta
            session.add(batch)

        movement = StockMovement(
            variant_id=variant.id,
            warehouse_id=warehouse.id,
            batch_id=batch.id if batch else None,
            kind=payload.kind,
            quantity=delta,
            qty_after=new_qty,
            reason=payload.reason.strip() if payload.reason else None,
        )
        session.add(movement)
        session.commit()
        session.refresh(level)

        return StockLevelRow(
            id=level.id,
            variant_id=variant.id,
            variant_sku=variant.sku,
            variant_display=_variant_display(variant, product),
            product_id=product.id,
            product_name=product.name,
            warehouse_id=warehouse.id,
            warehouse_code=warehouse.code,
            warehouse_name=warehouse.name,
            qty=float(level.qty),
            stock_min=float(variant.stock_min),
            low_stock=(
                product.product_type.value == "product"
                and level.qty <= variant.stock_min
            ),
            tracks_batches=product.tracks_batches,
        )


# ── Movements log ─────────────────────────────────────────────────────────────


SortOrder = Literal["asc", "desc"]


@router.get("/movements", response_model=MovementPage)
def list_movements(
    variant_id: Optional[str] = None,
    warehouse_id: Optional[str] = None,
    kind: Optional[StockMovementKind] = None,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    order: SortOrder = "desc",
) -> MovementPage:
    with Session(engine) as session:
        stmt = (
            select(StockMovement, ProductVariant, Product, Warehouse, Batch)
            .join(ProductVariant, ProductVariant.id == StockMovement.variant_id)
            .join(Product, Product.id == ProductVariant.product_id)
            .join(Warehouse, Warehouse.id == StockMovement.warehouse_id)
            .outerjoin(Batch, Batch.id == StockMovement.batch_id)
        )
        if variant_id:
            stmt = stmt.where(StockMovement.variant_id == variant_id)
        if warehouse_id:
            stmt = stmt.where(StockMovement.warehouse_id == warehouse_id)
        if kind:
            stmt = stmt.where(StockMovement.kind == kind)

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total_raw = session.exec(count_stmt).one()
        total = total_raw[0] if isinstance(total_raw, tuple) else int(total_raw)

        stmt = stmt.order_by(
            StockMovement.occurred_at.desc()
            if order == "desc"
            else StockMovement.occurred_at.asc()
        )
        rows = session.exec(stmt.offset(offset).limit(limit)).all()
        items: list[MovementRow] = []
        for mv, variant, product, warehouse, batch in rows:
            items.append(
                MovementRow(
                    id=mv.id,
                    occurred_at=mv.occurred_at,
                    kind=mv.kind,
                    quantity=float(mv.quantity),
                    qty_after=float(mv.qty_after),
                    variant_id=variant.id,
                    variant_sku=variant.sku,
                    variant_display=_variant_display(variant, product),
                    warehouse_id=warehouse.id,
                    warehouse_code=warehouse.code,
                    batch_id=batch.id if batch else None,
                    lot_number=batch.lot_number if batch else None,
                    reason=mv.reason,
                )
            )
        return MovementPage(items=items, total=int(total), limit=limit, offset=offset)
