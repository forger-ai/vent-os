"""Payment methods router.

CRUD basico. Los metodos por defecto (EFECTIVO, DEBITO, CREDITO, TRANSFERENCIA,
OTRO) se siembran en la migracion. El usuario puede agregar custom y editar
flag `is_cash` para integrarlos al cierre de caja.

Endpoints:
  GET    /api/payment-methods
  POST   /api/payment-methods
  GET    /api/payment-methods/{id}
  PATCH  /api/payment-methods/{id}
  DELETE /api/payment-methods/{id}      — soft delete (is_active=false)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.database import engine
from app.models import PaymentMethod

router = APIRouter()


class PaymentMethodRow(BaseModel):
    id: str
    code: str
    name: str
    is_cash: bool
    is_active: bool
    sort_order: int


class PaymentMethodCreate(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    is_cash: bool = False
    is_active: bool = True
    sort_order: int = 100


class PaymentMethodUpdate(BaseModel):
    code: Optional[str] = Field(default=None, min_length=1, max_length=40)
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    is_cash: Optional[bool] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


def _to_row(pm: PaymentMethod) -> PaymentMethodRow:
    return PaymentMethodRow(
        id=pm.id,
        code=pm.code,
        name=pm.name,
        is_cash=pm.is_cash,
        is_active=pm.is_active,
        sort_order=pm.sort_order,
    )


@router.get("", response_model=list[PaymentMethodRow])
def list_payment_methods(include_inactive: bool = False) -> list[PaymentMethodRow]:
    with Session(engine) as session:
        stmt = select(PaymentMethod)
        if not include_inactive:
            stmt = stmt.where(PaymentMethod.is_active.is_(True))
        stmt = stmt.order_by(PaymentMethod.sort_order.asc(), PaymentMethod.name.asc())
        return [_to_row(p) for p in session.exec(stmt).all()]


@router.get("/{pm_id}", response_model=PaymentMethodRow)
def get_payment_method(pm_id: str) -> PaymentMethodRow:
    with Session(engine) as session:
        pm = session.get(PaymentMethod, pm_id)
        if pm is None:
            raise HTTPException(status_code=404, detail="Metodo de pago no encontrado")
        return _to_row(pm)


@router.post("", response_model=PaymentMethodRow, status_code=201)
def create_payment_method(payload: PaymentMethodCreate) -> PaymentMethodRow:
    with Session(engine) as session:
        code = payload.code.strip().upper()
        existing = session.exec(
            select(PaymentMethod).where(PaymentMethod.code == code)
        ).first()
        if existing:
            raise HTTPException(
                status_code=409, detail=f"Ya existe un metodo con codigo '{code}'"
            )
        pm = PaymentMethod(
            code=code,
            name=payload.name.strip(),
            is_cash=payload.is_cash,
            is_active=payload.is_active,
            sort_order=payload.sort_order,
        )
        session.add(pm)
        session.commit()
        session.refresh(pm)
        return _to_row(pm)


@router.patch("/{pm_id}", response_model=PaymentMethodRow)
def update_payment_method(pm_id: str, payload: PaymentMethodUpdate) -> PaymentMethodRow:
    with Session(engine) as session:
        pm = session.get(PaymentMethod, pm_id)
        if pm is None:
            raise HTTPException(status_code=404, detail="Metodo de pago no encontrado")

        data = payload.model_dump(exclude_unset=True)

        if "code" in data and data["code"] is not None:
            new_code = data["code"].strip().upper()
            if new_code != pm.code:
                clash = session.exec(
                    select(PaymentMethod)
                    .where(PaymentMethod.code == new_code)
                    .where(PaymentMethod.id != pm_id)
                ).first()
                if clash:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Ya existe un metodo con codigo '{new_code}'",
                    )
            data["code"] = new_code

        if "name" in data and data["name"] is not None:
            data["name"] = data["name"].strip()
            if not data["name"]:
                raise HTTPException(status_code=400, detail="Nombre no puede ser vacio")

        for f, v in data.items():
            setattr(pm, f, v)

        pm.updated_at = datetime.now(timezone.utc)
        session.add(pm)
        session.commit()
        session.refresh(pm)
        return _to_row(pm)


@router.delete("/{pm_id}", response_model=PaymentMethodRow)
def deactivate_payment_method(pm_id: str) -> PaymentMethodRow:
    with Session(engine) as session:
        pm = session.get(PaymentMethod, pm_id)
        if pm is None:
            raise HTTPException(status_code=404, detail="Metodo de pago no encontrado")
        pm.is_active = False
        pm.updated_at = datetime.now(timezone.utc)
        session.add(pm)
        session.commit()
        session.refresh(pm)
        return _to_row(pm)
