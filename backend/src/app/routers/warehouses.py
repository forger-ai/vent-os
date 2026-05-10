"""Warehouses router.

Multiple warehouses (sucursales / bodegas) hold stock independently. Exactly
one warehouse should be marked as default at any time; the migration ensures
one exists, and this router maintains the invariant.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, func, select

from app.database import engine
from app.models import StockLevel, Warehouse

router = APIRouter()


# ── Shapes ────────────────────────────────────────────────────────────────────


class WarehouseRow(BaseModel):
    id: str
    code: str
    name: str
    address: Optional[str]
    is_default: bool
    is_active: bool
    notes: Optional[str]
    variants_with_stock: int


class WarehouseCreate(BaseModel):
    code: str = Field(min_length=1, max_length=16)
    name: str = Field(min_length=1, max_length=120)
    address: Optional[str] = None
    is_default: bool = False
    is_active: bool = True
    notes: Optional[str] = None


class WarehouseUpdate(BaseModel):
    code: Optional[str] = Field(default=None, min_length=1, max_length=16)
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    address: Optional[str] = None
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────


def _normalize_optional_str(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _variants_with_stock(session: Session, warehouse_id: str) -> int:
    count = session.exec(
        select(func.count())
        .select_from(StockLevel)
        .where(StockLevel.warehouse_id == warehouse_id)
        .where(StockLevel.qty != 0)
    ).first()
    if count is None:
        return 0
    return int(count[0]) if isinstance(count, tuple) else int(count)


def _to_row(session: Session, warehouse: Warehouse) -> WarehouseRow:
    return WarehouseRow(
        id=warehouse.id,
        code=warehouse.code,
        name=warehouse.name,
        address=warehouse.address,
        is_default=warehouse.is_default,
        is_active=warehouse.is_active,
        notes=warehouse.notes,
        variants_with_stock=_variants_with_stock(session, warehouse.id),
    )


def _clear_other_defaults(session: Session, except_id: Optional[str] = None) -> None:
    stmt = select(Warehouse).where(Warehouse.is_default.is_(True))
    if except_id:
        stmt = stmt.where(Warehouse.id != except_id)
    for wh in session.exec(stmt).all():
        wh.is_default = False
        wh.updated_at = datetime.now(timezone.utc)
        session.add(wh)


# ── List / detail ─────────────────────────────────────────────────────────────


@router.get("", response_model=list[WarehouseRow])
def list_warehouses(include_inactive: bool = False) -> list[WarehouseRow]:
    with Session(engine) as session:
        stmt = select(Warehouse)
        if not include_inactive:
            stmt = stmt.where(Warehouse.is_active.is_(True))
        stmt = stmt.order_by(Warehouse.is_default.desc(), Warehouse.name.asc())
        warehouses = session.exec(stmt).all()
        return [_to_row(session, w) for w in warehouses]


@router.get("/{warehouse_id}", response_model=WarehouseRow)
def get_warehouse(warehouse_id: str) -> WarehouseRow:
    with Session(engine) as session:
        wh = session.get(Warehouse, warehouse_id)
        if wh is None:
            raise HTTPException(status_code=404, detail="Bodega no encontrada")
        return _to_row(session, wh)


# ── Create ────────────────────────────────────────────────────────────────────


@router.post("", response_model=WarehouseRow, status_code=201)
def create_warehouse(payload: WarehouseCreate) -> WarehouseRow:
    with Session(engine) as session:
        code = payload.code.strip().upper()
        existing = session.exec(select(Warehouse).where(Warehouse.code == code)).first()
        if existing:
            raise HTTPException(
                status_code=409, detail=f"Ya existe una bodega con codigo '{code}'"
            )

        wh = Warehouse(
            code=code,
            name=payload.name.strip(),
            address=_normalize_optional_str(payload.address),
            is_default=payload.is_default,
            is_active=payload.is_active,
            notes=_normalize_optional_str(payload.notes),
        )
        session.add(wh)
        session.flush()
        if payload.is_default:
            _clear_other_defaults(session, except_id=wh.id)
        session.commit()
        session.refresh(wh)
        return _to_row(session, wh)


# ── Update ────────────────────────────────────────────────────────────────────


@router.patch("/{warehouse_id}", response_model=WarehouseRow)
def update_warehouse(warehouse_id: str, payload: WarehouseUpdate) -> WarehouseRow:
    with Session(engine) as session:
        wh = session.get(Warehouse, warehouse_id)
        if wh is None:
            raise HTTPException(status_code=404, detail="Bodega no encontrada")

        data = payload.model_dump(exclude_unset=True)

        if "code" in data and data["code"] is not None:
            new_code = data["code"].strip().upper()
            if new_code != wh.code:
                clash = session.exec(
                    select(Warehouse)
                    .where(Warehouse.code == new_code)
                    .where(Warehouse.id != warehouse_id)
                ).first()
                if clash:
                    raise HTTPException(
                        status_code=409, detail=f"Ya existe una bodega con codigo '{new_code}'"
                    )
            data["code"] = new_code

        if "name" in data and data["name"] is not None:
            data["name"] = data["name"].strip()
            if not data["name"]:
                raise HTTPException(status_code=400, detail="Nombre no puede ser vacio")

        for f in ("address", "notes"):
            if f in data:
                data[f] = _normalize_optional_str(data[f])

        for f, value in data.items():
            setattr(wh, f, value)

        wh.updated_at = datetime.now(timezone.utc)
        session.add(wh)

        if data.get("is_default") is True:
            _clear_other_defaults(session, except_id=wh.id)

        # Deactivating the default: promote another active warehouse to default.
        if data.get("is_active") is False and wh.is_default:
            wh.is_default = False
            session.add(wh)
            alt = session.exec(
                select(Warehouse)
                .where(Warehouse.is_active.is_(True))
                .where(Warehouse.id != wh.id)
                .order_by(Warehouse.created_at.asc())
            ).first()
            if alt is not None:
                alt.is_default = True
                alt.updated_at = datetime.now(timezone.utc)
                session.add(alt)

        session.commit()
        session.refresh(wh)
        return _to_row(session, wh)


# ── Soft delete ───────────────────────────────────────────────────────────────


@router.delete("/{warehouse_id}", response_model=WarehouseRow)
def deactivate_warehouse(warehouse_id: str) -> WarehouseRow:
    with Session(engine) as session:
        wh = session.get(Warehouse, warehouse_id)
        if wh is None:
            raise HTTPException(status_code=404, detail="Bodega no encontrada")

        # Prevent deactivating the only active warehouse.
        active_count = session.exec(
            select(func.count())
            .select_from(Warehouse)
            .where(Warehouse.is_active.is_(True))
        ).first()
        active_count_val = (
            active_count[0] if isinstance(active_count, tuple) else int(active_count or 0)
        )
        if wh.is_active and active_count_val <= 1:
            raise HTTPException(
                status_code=400,
                detail="No puedes desactivar la unica bodega activa.",
            )

        wh.is_active = False
        wh.updated_at = datetime.now(timezone.utc)

        if wh.is_default:
            wh.is_default = False
            session.add(wh)
            alt = session.exec(
                select(Warehouse)
                .where(Warehouse.is_active.is_(True))
                .where(Warehouse.id != wh.id)
                .order_by(Warehouse.created_at.asc())
            ).first()
            if alt is not None:
                alt.is_default = True
                alt.updated_at = datetime.now(timezone.utc)
                session.add(alt)

        session.add(wh)
        session.commit()
        session.refresh(wh)
        return _to_row(session, wh)
