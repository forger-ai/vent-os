"""Stock router.

Endpoints:
  GET  /api/stock                       — list stock levels (per variant+warehouse) with filters
  GET  /api/stock/by-variant/{vid}      — stock breakdown across warehouses for one variant
  POST /api/stock/adjust                — entrada / salida / ajuste on a (variant, warehouse) tuple,
                                           optionally bound to a batch. Writes a StockMovement and
                                           updates the StockLevel row.
  POST /api/stock/transfer              — atomic move between warehouses (salida + entrada). For
                                           batched products, source batch is required and a
                                           matching destination batch is auto-created if missing.
  POST /api/stock/count                 — batch ajuste de "conteo fisico": recibe lista de
                                           (variant, warehouse, counted_qty) y aplica ajustes
                                           para reconciliar.
  GET  /api/stock/valuation             — valorizacion total al costo o al precio, con desglose
                                           por bodega y categoria.
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


# ── Transfer between warehouses ──────────────────────────────────────────────


class StockTransferInput(BaseModel):
    variant_id: str
    from_warehouse_id: str
    to_warehouse_id: str
    quantity: float = Field(gt=0)
    batch_id: Optional[str] = Field(
        default=None,
        description="Required when the product tracks batches. Source batch id.",
    )
    reason: Optional[str] = None


class TransferResult(BaseModel):
    source: StockLevelRow
    destination: StockLevelRow


@router.post("/transfer", response_model=TransferResult, status_code=201)
def transfer_stock(payload: StockTransferInput) -> TransferResult:
    """Atomic move between two warehouses. Writes two StockMovements (salida +
    entrada) with the same reason text. For batched products, a destination
    batch with the same lot_number / expiry_date is auto-created (or topped up
    if it already exists)."""
    if payload.from_warehouse_id == payload.to_warehouse_id:
        raise HTTPException(status_code=400, detail="Origen y destino son la misma bodega.")

    with Session(engine) as session:
        variant = session.get(ProductVariant, payload.variant_id)
        if variant is None:
            raise HTTPException(status_code=404, detail="Variante no encontrada")
        product = session.get(Product, variant.product_id)
        if product is None:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        if product.product_type.value == "service":
            raise HTTPException(status_code=400, detail="No se puede transferir un servicio.")

        src_wh = session.get(Warehouse, payload.from_warehouse_id)
        dst_wh = session.get(Warehouse, payload.to_warehouse_id)
        if src_wh is None or dst_wh is None:
            raise HTTPException(status_code=404, detail="Bodega no encontrada")

        magnitude = Decimal(str(payload.quantity))

        # Source side -------------------------------------------------------
        src_level = _get_or_create_stock_level(session, variant.id, src_wh.id)
        if src_level.qty < magnitude:
            raise HTTPException(
                status_code=400,
                detail=f"Stock insuficiente en origen: hay {src_level.qty}, intentas mover {magnitude}.",
            )

        src_batch: Optional[Batch] = None
        dst_batch: Optional[Batch] = None
        if product.tracks_batches:
            if payload.batch_id is None:
                raise HTTPException(
                    status_code=400,
                    detail="Este producto maneja lotes; especifica batch_id de origen.",
                )
            src_batch = session.get(Batch, payload.batch_id)
            if src_batch is None:
                raise HTTPException(status_code=404, detail="Lote de origen no encontrado")
            if src_batch.variant_id != variant.id or src_batch.warehouse_id != src_wh.id:
                raise HTTPException(
                    status_code=400, detail="El lote no corresponde al origen indicado."
                )
            if src_batch.qty < magnitude:
                raise HTTPException(
                    status_code=400,
                    detail=f"Stock insuficiente en lote {src_batch.lot_number}: hay {src_batch.qty}.",
                )
            # Find existing dest batch with same lot_number+expiry, else create new.
            dst_batch = session.exec(
                select(Batch)
                .where(Batch.variant_id == variant.id)
                .where(Batch.warehouse_id == dst_wh.id)
                .where(Batch.lot_number == src_batch.lot_number)
            ).first()
            if dst_batch is None:
                dst_batch = Batch(
                    variant_id=variant.id,
                    warehouse_id=dst_wh.id,
                    lot_number=src_batch.lot_number,
                    expiry_date=src_batch.expiry_date,
                    qty=Decimal("0"),
                    notes=f"Transferido desde {src_wh.code}",
                )
                session.add(dst_batch)
                session.flush()

        # Apply source debit ------------------------------------------------
        src_level.qty = src_level.qty - magnitude
        src_level.updated_at = datetime.now(timezone.utc)
        session.add(src_level)
        if src_batch is not None:
            src_batch.qty = src_batch.qty - magnitude
            session.add(src_batch)

        reason_base = (payload.reason or "Transferencia").strip()
        reason_out = f"{reason_base} → {dst_wh.code}"
        reason_in = f"{reason_base} ← {src_wh.code}"

        session.add(
            StockMovement(
                variant_id=variant.id,
                warehouse_id=src_wh.id,
                batch_id=src_batch.id if src_batch else None,
                kind=StockMovementKind.salida,
                quantity=-magnitude,
                qty_after=src_level.qty,
                reason=reason_out,
            )
        )

        # Apply destination credit -----------------------------------------
        dst_level = _get_or_create_stock_level(session, variant.id, dst_wh.id)
        dst_level.qty = dst_level.qty + magnitude
        dst_level.updated_at = datetime.now(timezone.utc)
        session.add(dst_level)
        if dst_batch is not None:
            dst_batch.qty = dst_batch.qty + magnitude
            session.add(dst_batch)

        session.add(
            StockMovement(
                variant_id=variant.id,
                warehouse_id=dst_wh.id,
                batch_id=dst_batch.id if dst_batch else None,
                kind=StockMovementKind.entrada,
                quantity=magnitude,
                qty_after=dst_level.qty,
                reason=reason_in,
            )
        )

        session.commit()
        session.refresh(src_level)
        session.refresh(dst_level)

        def _row(level: StockLevel, wh: Warehouse) -> StockLevelRow:
            return StockLevelRow(
                id=level.id,
                variant_id=variant.id,
                variant_sku=variant.sku,
                variant_display=_variant_display(variant, product),
                product_id=product.id,
                product_name=product.name,
                warehouse_id=wh.id,
                warehouse_code=wh.code,
                warehouse_name=wh.name,
                qty=float(level.qty),
                stock_min=float(variant.stock_min),
                low_stock=level.qty <= variant.stock_min,
                tracks_batches=product.tracks_batches,
            )

        return TransferResult(source=_row(src_level, src_wh), destination=_row(dst_level, dst_wh))


# ── Physical count ────────────────────────────────────────────────────────────


class CountEntry(BaseModel):
    variant_id: str
    counted_qty: float = Field(ge=0)


class StockCountInput(BaseModel):
    warehouse_id: str
    entries: list[CountEntry]
    reason: Optional[str] = None


class CountRowResult(BaseModel):
    variant_id: str
    variant_sku: str
    expected_qty: float
    counted_qty: float
    delta: float
    action: Literal["adjusted", "unchanged", "skipped_batched", "skipped_service", "error"]
    message: Optional[str] = None


class CountReport(BaseModel):
    warehouse_id: str
    warehouse_code: str
    total_entries: int
    adjusted: int
    unchanged: int
    skipped: int
    errors: int
    rows: list[CountRowResult]


@router.post("/count", response_model=CountReport, status_code=201)
def apply_count(payload: StockCountInput) -> CountReport:
    """Aplica un conteo fisico: para cada (variante, qty contada) crea un
    ajuste para igualar el stock al valor contado. Productos con tracks_batches
    no se ajustan asi (necesitan ajuste por lote)."""
    with Session(engine) as session:
        wh = session.get(Warehouse, payload.warehouse_id)
        if wh is None:
            raise HTTPException(status_code=404, detail="Bodega no encontrada")

        results: list[CountRowResult] = []
        counters = {"adjusted": 0, "unchanged": 0, "skipped": 0, "errors": 0}
        reason = (payload.reason or "Conteo fisico").strip()

        for entry in payload.entries:
            try:
                variant = session.get(ProductVariant, entry.variant_id)
                if variant is None:
                    counters["errors"] += 1
                    results.append(
                        CountRowResult(
                            variant_id=entry.variant_id,
                            variant_sku="?",
                            expected_qty=0,
                            counted_qty=entry.counted_qty,
                            delta=0,
                            action="error",
                            message="Variante no encontrada",
                        )
                    )
                    continue
                product = session.get(Product, variant.product_id)
                if product is None:
                    counters["errors"] += 1
                    results.append(
                        CountRowResult(
                            variant_id=entry.variant_id,
                            variant_sku=variant.sku,
                            expected_qty=0,
                            counted_qty=entry.counted_qty,
                            delta=0,
                            action="error",
                            message="Producto no encontrado",
                        )
                    )
                    continue
                if product.product_type.value == "service":
                    counters["skipped"] += 1
                    results.append(
                        CountRowResult(
                            variant_id=variant.id,
                            variant_sku=variant.sku,
                            expected_qty=0,
                            counted_qty=entry.counted_qty,
                            delta=0,
                            action="skipped_service",
                            message="Servicios no manejan stock.",
                        )
                    )
                    continue
                if product.tracks_batches:
                    counters["skipped"] += 1
                    results.append(
                        CountRowResult(
                            variant_id=variant.id,
                            variant_sku=variant.sku,
                            expected_qty=0,
                            counted_qty=entry.counted_qty,
                            delta=0,
                            action="skipped_batched",
                            message="Producto con lotes: ajusta por lote desde la pestana Lotes.",
                        )
                    )
                    continue

                level = _get_or_create_stock_level(session, variant.id, wh.id)
                target = Decimal(str(entry.counted_qty))
                delta = target - level.qty
                expected = float(level.qty)

                if delta == 0:
                    counters["unchanged"] += 1
                    results.append(
                        CountRowResult(
                            variant_id=variant.id,
                            variant_sku=variant.sku,
                            expected_qty=expected,
                            counted_qty=entry.counted_qty,
                            delta=0,
                            action="unchanged",
                        )
                    )
                    continue

                level.qty = target
                level.updated_at = datetime.now(timezone.utc)
                session.add(level)
                session.add(
                    StockMovement(
                        variant_id=variant.id,
                        warehouse_id=wh.id,
                        kind=StockMovementKind.ajuste,
                        quantity=delta,
                        qty_after=target,
                        reason=f"{reason} ({wh.code})",
                    )
                )
                counters["adjusted"] += 1
                results.append(
                    CountRowResult(
                        variant_id=variant.id,
                        variant_sku=variant.sku,
                        expected_qty=expected,
                        counted_qty=entry.counted_qty,
                        delta=float(delta),
                        action="adjusted",
                    )
                )
            except Exception as exc:  # noqa: BLE001
                counters["errors"] += 1
                results.append(
                    CountRowResult(
                        variant_id=entry.variant_id,
                        variant_sku="?",
                        expected_qty=0,
                        counted_qty=entry.counted_qty,
                        delta=0,
                        action="error",
                        message=str(exc),
                    )
                )

        if counters["errors"] == 0:
            session.commit()
        else:
            session.rollback()
            # Reset counters to 0 since nothing was persisted; only errors remain.
            for k in ("adjusted", "unchanged", "skipped"):
                counters[k] = 0

        return CountReport(
            warehouse_id=wh.id,
            warehouse_code=wh.code,
            total_entries=len(payload.entries),
            adjusted=counters["adjusted"],
            unchanged=counters["unchanged"],
            skipped=counters["skipped"],
            errors=counters["errors"],
            rows=results,
        )


# ── Valuation ─────────────────────────────────────────────────────────────────


class ValuationMode(BaseModel):
    pass  # placeholder for documentation


class ValuationBucket(BaseModel):
    label: str
    code: Optional[str] = None
    units: float
    value_clp: float


class ValuationVariantRow(BaseModel):
    variant_id: str
    variant_sku: str
    variant_display: str
    product_id: str
    product_name: str
    category: Optional[str]
    units: float
    unit_value_clp: float
    total_value_clp: float


class ValuationReport(BaseModel):
    mode: Literal["cost", "price"]
    total_units: float
    total_value_clp: float
    total_variants_without_cost: int
    by_warehouse: list[ValuationBucket]
    by_category: list[ValuationBucket]
    top_variants: list[ValuationVariantRow]


@router.get("/valuation", response_model=ValuationReport)
def stock_valuation(
    mode: Literal["cost", "price"] = "cost",
    warehouse_id: Optional[str] = None,
    category: Optional[str] = None,
    brand: Optional[str] = None,
    top_n: int = Query(default=20, ge=1, le=200),
) -> ValuationReport:
    with Session(engine) as session:
        stmt = (
            select(StockLevel, ProductVariant, Product, Warehouse)
            .join(ProductVariant, ProductVariant.id == StockLevel.variant_id)
            .join(Product, Product.id == ProductVariant.product_id)
            .join(Warehouse, Warehouse.id == StockLevel.warehouse_id)
            .where(StockLevel.qty > 0)
            .where(Product.product_type == "product")
            .where(Product.is_active.is_(True))
            .where(ProductVariant.is_active.is_(True))
            .where(Warehouse.is_active.is_(True))
        )
        if warehouse_id:
            stmt = stmt.where(StockLevel.warehouse_id == warehouse_id)
        if category:
            stmt = stmt.where(Product.category == category)
        if brand:
            stmt = stmt.where(Product.brand == brand)

        rows = session.exec(stmt).all()

        total_units = Decimal("0")
        total_value = Decimal("0")
        missing_cost = 0
        by_warehouse_map: dict[str, dict] = {}
        by_category_map: dict[str, dict] = {}
        variant_totals: dict[str, dict] = {}

        for level, variant, product, warehouse in rows:
            qty = level.qty
            if mode == "cost":
                if variant.cost_clp is None:
                    missing_cost += 1
                    continue
                unit_value = variant.cost_clp
            else:
                unit_value = variant.price_clp
            value = qty * unit_value

            total_units += qty
            total_value += value

            wh_key = warehouse.id
            if wh_key not in by_warehouse_map:
                by_warehouse_map[wh_key] = {
                    "label": warehouse.name,
                    "code": warehouse.code,
                    "units": Decimal("0"),
                    "value": Decimal("0"),
                }
            by_warehouse_map[wh_key]["units"] += qty
            by_warehouse_map[wh_key]["value"] += value

            cat_label = product.category or "Sin categoria"
            if cat_label not in by_category_map:
                by_category_map[cat_label] = {
                    "label": cat_label,
                    "code": None,
                    "units": Decimal("0"),
                    "value": Decimal("0"),
                }
            by_category_map[cat_label]["units"] += qty
            by_category_map[cat_label]["value"] += value

            v_key = variant.id
            if v_key not in variant_totals:
                variant_totals[v_key] = {
                    "variant": variant,
                    "product": product,
                    "units": Decimal("0"),
                    "value": Decimal("0"),
                    "unit_value": unit_value,
                }
            variant_totals[v_key]["units"] += qty
            variant_totals[v_key]["value"] += value

        def _to_buckets(d: dict[str, dict]) -> list[ValuationBucket]:
            buckets = [
                ValuationBucket(
                    label=v["label"],
                    code=v["code"],
                    units=float(v["units"]),
                    value_clp=float(v["value"]),
                )
                for v in d.values()
            ]
            buckets.sort(key=lambda b: b.value_clp, reverse=True)
            return buckets

        top_sorted = sorted(
            variant_totals.values(), key=lambda v: v["value"], reverse=True
        )[:top_n]
        top_rows = [
            ValuationVariantRow(
                variant_id=v["variant"].id,
                variant_sku=v["variant"].sku,
                variant_display=_variant_display(v["variant"], v["product"]),
                product_id=v["product"].id,
                product_name=v["product"].name,
                category=v["product"].category,
                units=float(v["units"]),
                unit_value_clp=float(v["unit_value"]),
                total_value_clp=float(v["value"]),
            )
            for v in top_sorted
        ]

        return ValuationReport(
            mode=mode,
            total_units=float(total_units),
            total_value_clp=float(total_value),
            total_variants_without_cost=missing_cost,
            by_warehouse=_to_buckets(by_warehouse_map),
            by_category=_to_buckets(by_category_map),
            top_variants=top_rows,
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
