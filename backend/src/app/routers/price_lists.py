"""Price lists router.

Multiple named price schemes (Minorista, Mayorista, VIP). The default list
uses each variant's `price_clp` directly. Non-default lists may have
per-variant overrides via PriceListEntry; if no entry, the variant base
price is the effective price.

Endpoints:
  GET    /api/price-lists                              — list (filter active)
  POST   /api/price-lists                              — create
  GET    /api/price-lists/{id}                         — detail
  PATCH  /api/price-lists/{id}
  DELETE /api/price-lists/{id}                         — soft delete

  GET    /api/price-lists/{id}/entries                 — list overrides for this list
  PUT    /api/price-lists/{id}/entries/{variant_id}    — set override (body: {price_clp})
  DELETE /api/price-lists/{id}/entries/{variant_id}    — remove override (falls back to base)

  GET    /api/price-lists/resolve?list_id=X&variant_id=Y
                                                       — resolved effective price
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
    PriceList,
    PriceListEntry,
    Product,
    ProductVariant,
)

router = APIRouter()


# ── Shapes ────────────────────────────────────────────────────────────────────


class PriceListRow(BaseModel):
    id: str
    code: str
    name: str
    description: Optional[str]
    is_default: bool
    is_active: bool
    entries_count: int


class PriceListCreate(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    description: Optional[str] = None
    is_default: bool = False
    is_active: bool = True


class PriceListUpdate(BaseModel):
    code: Optional[str] = Field(default=None, min_length=1, max_length=40)
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = None
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None


class PriceListEntryRow(BaseModel):
    variant_id: str
    variant_sku: str
    variant_display: str
    product_id: str
    product_name: str
    base_price_clp: float
    override_price_clp: Optional[float]
    effective_price_clp: float
    source: Literal["list", "base"]


class EntryInput(BaseModel):
    price_clp: float = Field(ge=0)


class ResolvedPrice(BaseModel):
    variant_id: str
    list_id: str
    price_clp: float
    source: Literal["list", "base"]


# ── Helpers ───────────────────────────────────────────────────────────────────


def _normalize_optional_str(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _clear_other_defaults(session: Session, except_id: Optional[str] = None) -> None:
    stmt = select(PriceList).where(PriceList.is_default.is_(True))
    if except_id:
        stmt = stmt.where(PriceList.id != except_id)
    for pl in session.exec(stmt).all():
        pl.is_default = False
        pl.updated_at = datetime.now(timezone.utc)
        session.add(pl)


def _entries_count(session: Session, price_list_id: str) -> int:
    c = session.exec(
        select(func.count())
        .select_from(PriceListEntry)
        .where(PriceListEntry.price_list_id == price_list_id)
    ).first()
    return c[0] if isinstance(c, tuple) else int(c or 0)


def _to_row(session: Session, pl: PriceList) -> PriceListRow:
    return PriceListRow(
        id=pl.id,
        code=pl.code,
        name=pl.name,
        description=pl.description,
        is_default=pl.is_default,
        is_active=pl.is_active,
        entries_count=_entries_count(session, pl.id),
    )


def _variant_display(variant: ProductVariant, product: Product) -> str:
    if variant.display_name:
        return variant.display_name
    return f"{product.name} ({variant.sku})"


# ── List / detail ─────────────────────────────────────────────────────────────


@router.get("", response_model=list[PriceListRow])
def list_price_lists(include_inactive: bool = False) -> list[PriceListRow]:
    with Session(engine) as session:
        stmt = select(PriceList)
        if not include_inactive:
            stmt = stmt.where(PriceList.is_active.is_(True))
        stmt = stmt.order_by(PriceList.is_default.desc(), PriceList.name.asc())
        lists = session.exec(stmt).all()
        return [_to_row(session, p) for p in lists]


# Resolve must be declared BEFORE /{list_id} catch-all.
@router.get("/resolve", response_model=ResolvedPrice)
def resolve_price(
    list_id: str = Query(...),
    variant_id: str = Query(...),
) -> ResolvedPrice:
    with Session(engine) as session:
        pl = session.get(PriceList, list_id)
        if pl is None:
            raise HTTPException(status_code=404, detail="Lista de precios no encontrada")
        variant = session.get(ProductVariant, variant_id)
        if variant is None:
            raise HTTPException(status_code=404, detail="Variante no encontrada")

        if pl.is_default:
            return ResolvedPrice(
                variant_id=variant.id,
                list_id=pl.id,
                price_clp=float(variant.price_clp),
                source="base",
            )

        entry = session.exec(
            select(PriceListEntry)
            .where(PriceListEntry.price_list_id == list_id)
            .where(PriceListEntry.variant_id == variant_id)
        ).first()
        if entry is None:
            return ResolvedPrice(
                variant_id=variant.id,
                list_id=pl.id,
                price_clp=float(variant.price_clp),
                source="base",
            )
        return ResolvedPrice(
            variant_id=variant.id,
            list_id=pl.id,
            price_clp=float(entry.price_clp),
            source="list",
        )


@router.get("/{list_id}", response_model=PriceListRow)
def get_price_list(list_id: str) -> PriceListRow:
    with Session(engine) as session:
        pl = session.get(PriceList, list_id)
        if pl is None:
            raise HTTPException(status_code=404, detail="Lista de precios no encontrada")
        return _to_row(session, pl)


# ── Create / update / delete ─────────────────────────────────────────────────


@router.post("", response_model=PriceListRow, status_code=201)
def create_price_list(payload: PriceListCreate) -> PriceListRow:
    with Session(engine) as session:
        code = payload.code.strip().upper()
        existing = session.exec(select(PriceList).where(PriceList.code == code)).first()
        if existing:
            raise HTTPException(status_code=409, detail=f"Ya existe una lista '{code}'")

        pl = PriceList(
            code=code,
            name=payload.name.strip(),
            description=_normalize_optional_str(payload.description),
            is_default=payload.is_default,
            is_active=payload.is_active,
        )
        session.add(pl)
        session.flush()
        if payload.is_default:
            _clear_other_defaults(session, except_id=pl.id)
        session.commit()
        session.refresh(pl)
        return _to_row(session, pl)


@router.patch("/{list_id}", response_model=PriceListRow)
def update_price_list(list_id: str, payload: PriceListUpdate) -> PriceListRow:
    with Session(engine) as session:
        pl = session.get(PriceList, list_id)
        if pl is None:
            raise HTTPException(status_code=404, detail="Lista de precios no encontrada")

        data = payload.model_dump(exclude_unset=True)

        if "code" in data and data["code"] is not None:
            new_code = data["code"].strip().upper()
            if new_code != pl.code:
                clash = session.exec(
                    select(PriceList)
                    .where(PriceList.code == new_code)
                    .where(PriceList.id != list_id)
                ).first()
                if clash:
                    raise HTTPException(
                        status_code=409, detail=f"Ya existe una lista '{new_code}'"
                    )
            data["code"] = new_code

        if "name" in data and data["name"] is not None:
            data["name"] = data["name"].strip()
            if not data["name"]:
                raise HTTPException(status_code=400, detail="Nombre no puede ser vacio")

        if "description" in data:
            data["description"] = _normalize_optional_str(data["description"])

        for f, v in data.items():
            setattr(pl, f, v)

        pl.updated_at = datetime.now(timezone.utc)
        session.add(pl)
        if data.get("is_default") is True:
            _clear_other_defaults(session, except_id=pl.id)
        session.commit()
        session.refresh(pl)
        return _to_row(session, pl)


@router.delete("/{list_id}", response_model=PriceListRow)
def deactivate_price_list(list_id: str) -> PriceListRow:
    with Session(engine) as session:
        pl = session.get(PriceList, list_id)
        if pl is None:
            raise HTTPException(status_code=404, detail="Lista de precios no encontrada")

        active_count = session.exec(
            select(func.count()).select_from(PriceList).where(PriceList.is_active.is_(True))
        ).first()
        ac = active_count[0] if isinstance(active_count, tuple) else int(active_count or 0)
        if pl.is_active and ac <= 1:
            raise HTTPException(
                status_code=400, detail="No puedes desactivar la unica lista activa."
            )

        pl.is_active = False
        pl.updated_at = datetime.now(timezone.utc)
        if pl.is_default:
            pl.is_default = False
            session.add(pl)
            alt = session.exec(
                select(PriceList)
                .where(PriceList.is_active.is_(True))
                .where(PriceList.id != pl.id)
                .order_by(PriceList.created_at.asc())
            ).first()
            if alt:
                alt.is_default = True
                alt.updated_at = datetime.now(timezone.utc)
                session.add(alt)

        session.add(pl)
        session.commit()
        session.refresh(pl)
        return _to_row(session, pl)


# ── Entries (per-variant overrides) ──────────────────────────────────────────


@router.get("/{list_id}/entries", response_model=list[PriceListEntryRow])
def list_entries(
    list_id: str,
    only_overrides: bool = False,
    q: Optional[str] = None,
) -> list[PriceListEntryRow]:
    """List variants with their effective price under this price list.

    If `only_overrides=True`, returns only variants that have a PriceListEntry
    row (i.e. an explicit override). Otherwise lists ALL active variants, with
    `source` indicating whether the price comes from the list or the base.
    """
    with Session(engine) as session:
        pl = session.get(PriceList, list_id)
        if pl is None:
            raise HTTPException(status_code=404, detail="Lista de precios no encontrada")

        # Build the base query: variants joined with their product.
        stmt = (
            select(ProductVariant, Product)
            .join(Product, Product.id == ProductVariant.product_id)
            .where(ProductVariant.is_active.is_(True))
            .where(Product.is_active.is_(True))
        )
        if q:
            like = f"%{q.lower()}%"
            stmt = stmt.where(
                (func.lower(ProductVariant.sku).like(like))
                | (func.lower(Product.name).like(like))
                | (func.lower(ProductVariant.display_name).like(like))
            )
        stmt = stmt.order_by(Product.name.asc(), ProductVariant.sku.asc())
        rows = session.exec(stmt).all()

        # Pre-fetch overrides for efficiency.
        override_stmt = select(PriceListEntry).where(
            PriceListEntry.price_list_id == list_id
        )
        overrides = {
            e.variant_id: e for e in session.exec(override_stmt).all()
        }

        results: list[PriceListEntryRow] = []
        for variant, product in rows:
            override = overrides.get(variant.id)
            if pl.is_default:
                # Default list never has overrides — always base.
                if only_overrides:
                    continue
                results.append(
                    PriceListEntryRow(
                        variant_id=variant.id,
                        variant_sku=variant.sku,
                        variant_display=_variant_display(variant, product),
                        product_id=product.id,
                        product_name=product.name,
                        base_price_clp=float(variant.price_clp),
                        override_price_clp=None,
                        effective_price_clp=float(variant.price_clp),
                        source="base",
                    )
                )
                continue
            if only_overrides and override is None:
                continue
            effective = (
                float(override.price_clp) if override else float(variant.price_clp)
            )
            results.append(
                PriceListEntryRow(
                    variant_id=variant.id,
                    variant_sku=variant.sku,
                    variant_display=_variant_display(variant, product),
                    product_id=product.id,
                    product_name=product.name,
                    base_price_clp=float(variant.price_clp),
                    override_price_clp=float(override.price_clp) if override else None,
                    effective_price_clp=effective,
                    source="list" if override else "base",
                )
            )
        return results


@router.put("/{list_id}/entries/{variant_id}", response_model=PriceListEntryRow)
def set_entry(list_id: str, variant_id: str, payload: EntryInput) -> PriceListEntryRow:
    with Session(engine) as session:
        pl = session.get(PriceList, list_id)
        if pl is None:
            raise HTTPException(status_code=404, detail="Lista de precios no encontrada")
        if pl.is_default:
            raise HTTPException(
                status_code=400,
                detail="La lista por defecto usa el precio base de cada variante; no admite overrides.",
            )
        variant = session.get(ProductVariant, variant_id)
        if variant is None:
            raise HTTPException(status_code=404, detail="Variante no encontrada")
        product = session.get(Product, variant.product_id)

        entry = session.exec(
            select(PriceListEntry)
            .where(PriceListEntry.price_list_id == list_id)
            .where(PriceListEntry.variant_id == variant_id)
        ).first()
        if entry is None:
            entry = PriceListEntry(
                price_list_id=list_id,
                variant_id=variant_id,
                price_clp=Decimal(str(payload.price_clp)),
            )
        else:
            entry.price_clp = Decimal(str(payload.price_clp))
            entry.updated_at = datetime.now(timezone.utc)
        session.add(entry)
        session.commit()
        session.refresh(entry)

        return PriceListEntryRow(
            variant_id=variant.id,
            variant_sku=variant.sku,
            variant_display=_variant_display(variant, product),
            product_id=product.id,
            product_name=product.name,
            base_price_clp=float(variant.price_clp),
            override_price_clp=float(entry.price_clp),
            effective_price_clp=float(entry.price_clp),
            source="list",
        )


@router.delete("/{list_id}/entries/{variant_id}", status_code=204)
def delete_entry(list_id: str, variant_id: str) -> None:
    with Session(engine) as session:
        entry = session.exec(
            select(PriceListEntry)
            .where(PriceListEntry.price_list_id == list_id)
            .where(PriceListEntry.variant_id == variant_id)
        ).first()
        if entry is None:
            return  # idempotent
        session.delete(entry)
        session.commit()
