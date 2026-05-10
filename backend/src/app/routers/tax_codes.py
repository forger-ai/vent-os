"""Tax codes router.

Additional taxes (ILA, Bebidas azucaradas, Impuesto especifico, etc.) that
apply on top of IVA. A variant can be assigned 0+ tax codes via
ProductVariantTaxCode.

Endpoints:
  GET    /api/tax-codes                                — list (filter active)
  POST   /api/tax-codes                                — create
  GET    /api/tax-codes/{id}                           — detail
  PATCH  /api/tax-codes/{id}
  DELETE /api/tax-codes/{id}                           — soft delete (is_active=false)

  GET    /api/variants/{vid}/tax-codes                 — list codes assigned to variant
  PUT    /api/variants/{vid}/tax-codes                 — replace assignments (body: list[code_id])
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.database import engine
from app.models import ProductVariant, ProductVariantTaxCode, TaxCode

router = APIRouter()


# ── Shapes ────────────────────────────────────────────────────────────────────


class TaxCodeRow(BaseModel):
    id: str
    code: str
    name: str
    description: Optional[str]
    rate: float
    is_active: bool
    variants_count: int


class TaxCodeCreate(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    description: Optional[str] = None
    rate: float = Field(ge=0, description="Fraction. 0.18 means 18%.")
    is_active: bool = True


class TaxCodeUpdate(BaseModel):
    code: Optional[str] = Field(default=None, min_length=1, max_length=40)
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = None
    rate: Optional[float] = Field(default=None, ge=0)
    is_active: Optional[bool] = None


class VariantTaxCodesInput(BaseModel):
    tax_code_ids: list[str]


def _normalize_optional_str(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _to_row(session: Session, code: TaxCode) -> TaxCodeRow:
    from sqlmodel import func

    count = session.exec(
        select(func.count())
        .select_from(ProductVariantTaxCode)
        .where(ProductVariantTaxCode.tax_code_id == code.id)
    ).first()
    count_val = count[0] if isinstance(count, tuple) else int(count or 0)
    return TaxCodeRow(
        id=code.id,
        code=code.code,
        name=code.name,
        description=code.description,
        rate=float(code.rate),
        is_active=code.is_active,
        variants_count=int(count_val),
    )


# ── List / detail ─────────────────────────────────────────────────────────────


@router.get("", response_model=list[TaxCodeRow])
def list_tax_codes(include_inactive: bool = False) -> list[TaxCodeRow]:
    with Session(engine) as session:
        stmt = select(TaxCode)
        if not include_inactive:
            stmt = stmt.where(TaxCode.is_active.is_(True))
        stmt = stmt.order_by(TaxCode.name.asc())
        codes = session.exec(stmt).all()
        return [_to_row(session, c) for c in codes]


@router.get("/{code_id}", response_model=TaxCodeRow)
def get_tax_code(code_id: str) -> TaxCodeRow:
    with Session(engine) as session:
        code = session.get(TaxCode, code_id)
        if code is None:
            raise HTTPException(status_code=404, detail="Codigo de impuesto no encontrado")
        return _to_row(session, code)


# ── Create / update / delete ─────────────────────────────────────────────────


@router.post("", response_model=TaxCodeRow, status_code=201)
def create_tax_code(payload: TaxCodeCreate) -> TaxCodeRow:
    with Session(engine) as session:
        code = payload.code.strip().upper()
        existing = session.exec(select(TaxCode).where(TaxCode.code == code)).first()
        if existing:
            raise HTTPException(
                status_code=409, detail=f"Ya existe un codigo de impuesto '{code}'"
            )
        tax = TaxCode(
            code=code,
            name=payload.name.strip(),
            description=_normalize_optional_str(payload.description),
            rate=Decimal(str(payload.rate)),
            is_active=payload.is_active,
        )
        session.add(tax)
        session.commit()
        session.refresh(tax)
        return _to_row(session, tax)


@router.patch("/{code_id}", response_model=TaxCodeRow)
def update_tax_code(code_id: str, payload: TaxCodeUpdate) -> TaxCodeRow:
    with Session(engine) as session:
        tax = session.get(TaxCode, code_id)
        if tax is None:
            raise HTTPException(status_code=404, detail="Codigo de impuesto no encontrado")

        data = payload.model_dump(exclude_unset=True)

        if "code" in data and data["code"] is not None:
            new_code = data["code"].strip().upper()
            if new_code != tax.code:
                clash = session.exec(
                    select(TaxCode).where(TaxCode.code == new_code).where(TaxCode.id != code_id)
                ).first()
                if clash:
                    raise HTTPException(
                        status_code=409, detail=f"Ya existe un codigo '{new_code}'"
                    )
            data["code"] = new_code

        if "name" in data and data["name"] is not None:
            data["name"] = data["name"].strip()
            if not data["name"]:
                raise HTTPException(status_code=400, detail="Nombre no puede ser vacio")

        if "description" in data:
            data["description"] = _normalize_optional_str(data["description"])

        if "rate" in data and data["rate"] is not None:
            data["rate"] = Decimal(str(data["rate"]))

        for f, v in data.items():
            setattr(tax, f, v)

        tax.updated_at = datetime.now(timezone.utc)
        session.add(tax)
        session.commit()
        session.refresh(tax)
        return _to_row(session, tax)


@router.delete("/{code_id}", response_model=TaxCodeRow)
def deactivate_tax_code(code_id: str) -> TaxCodeRow:
    with Session(engine) as session:
        tax = session.get(TaxCode, code_id)
        if tax is None:
            raise HTTPException(status_code=404, detail="Codigo de impuesto no encontrado")
        tax.is_active = False
        tax.updated_at = datetime.now(timezone.utc)
        session.add(tax)
        session.commit()
        session.refresh(tax)
        return _to_row(session, tax)


# ── Variant <-> tax code assignment ──────────────────────────────────────────


@router.get("/variants/{variant_id}", response_model=list[TaxCodeRow])
def list_variant_tax_codes(variant_id: str) -> list[TaxCodeRow]:
    """Codes assigned to the given variant. Mounted at /api/tax-codes/variants/{id}."""
    with Session(engine) as session:
        variant = session.get(ProductVariant, variant_id)
        if variant is None:
            raise HTTPException(status_code=404, detail="Variante no encontrada")
        ids = session.exec(
            select(ProductVariantTaxCode.tax_code_id).where(
                ProductVariantTaxCode.variant_id == variant_id
            )
        ).all()
        if not ids:
            return []
        codes = session.exec(select(TaxCode).where(TaxCode.id.in_(list(ids)))).all()
        return [_to_row(session, c) for c in codes]


@router.put("/variants/{variant_id}", response_model=list[TaxCodeRow])
def replace_variant_tax_codes(
    variant_id: str, payload: VariantTaxCodesInput
) -> list[TaxCodeRow]:
    """Replace the entire set of tax codes for a variant."""
    with Session(engine) as session:
        variant = session.get(ProductVariant, variant_id)
        if variant is None:
            raise HTTPException(status_code=404, detail="Variante no encontrada")

        # Validate all ids exist.
        unique_ids = list(dict.fromkeys(payload.tax_code_ids))
        if unique_ids:
            existing_codes = session.exec(
                select(TaxCode).where(TaxCode.id.in_(unique_ids))
            ).all()
            existing_ids = {c.id for c in existing_codes}
            missing = [i for i in unique_ids if i not in existing_ids]
            if missing:
                raise HTTPException(
                    status_code=400,
                    detail=f"Codigos de impuesto inexistentes: {', '.join(missing)}",
                )

        session.exec(
            ProductVariantTaxCode.__table__.delete().where(
                ProductVariantTaxCode.__table__.c.variant_id == variant_id
            )
        )
        for code_id in unique_ids:
            session.add(
                ProductVariantTaxCode(variant_id=variant_id, tax_code_id=code_id)
            )
        session.commit()

        # Return the new assignment.
        return list_variant_tax_codes(variant_id)
