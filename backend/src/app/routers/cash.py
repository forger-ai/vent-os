"""Cash sessions router — apertura, cierre, sesion actual e historial.

Una sesion de caja pertenece a una bodega. Solo puede haber UNA sesion abierta
por bodega a la vez. Al cerrar:
  - `expected_amount_clp = opening + sum(documents emitidos en esta sesion)`
  - `difference_clp = closing - expected`  (positivo = sobrante; negativo =
    faltante)

Nota: hasta v0.8 todas las ventas se asumen efectivo. Cuando v0.9 introduzca
metodos de pago, `expected` filtrara solo los pagos en efectivo.
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
    CashSession,
    CashSessionStatus,
    Document,
    DocumentPayment,
    DocumentStatus,
    PaymentMethod,
    Warehouse,
)

router = APIRouter()


# ── Shapes ────────────────────────────────────────────────────────────────────


class PaymentBreakdownItem(BaseModel):
    payment_method_id: str
    code: str
    name: str
    is_cash: bool
    amount_clp: float


class SessionSummary(BaseModel):
    documents_count: int
    sales_total_clp: float
    cash_total_clp: float
    non_cash_total_clp: float
    cancelled_count: int
    payments_by_method: list[PaymentBreakdownItem]


class CashSessionRow(BaseModel):
    id: str
    warehouse_id: Optional[str]
    warehouse_code: Optional[str]
    warehouse_name: Optional[str]
    opened_by: Optional[str]
    opened_at: datetime
    closed_at: Optional[datetime]
    opening_amount_clp: float
    closing_amount_clp: Optional[float]
    expected_amount_clp: Optional[float]
    difference_clp: Optional[float]
    status: CashSessionStatus
    notes: Optional[str]
    summary: SessionSummary


class CashSessionPage(BaseModel):
    items: list[CashSessionRow]
    total: int
    limit: int
    offset: int


class OpenSessionInput(BaseModel):
    warehouse_id: str
    opening_amount_clp: float = Field(default=0, ge=0)
    opened_by: Optional[str] = None
    notes: Optional[str] = None


class CloseSessionInput(BaseModel):
    closing_amount_clp: float = Field(ge=0)
    notes: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────


def _normalize_optional_str(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _session_summary(session: Session, cash_session_id: str) -> SessionSummary:
    docs = session.exec(
        select(Document).where(Document.cash_session_id == cash_session_id)
    ).all()
    count = 0
    total = Decimal("0")
    cancelled = 0
    issued_ids: list[str] = []
    for d in docs:
        if d.status == DocumentStatus.issued:
            count += 1
            total += d.total_clp
            issued_ids.append(d.id)
        elif d.status == DocumentStatus.cancelled:
            cancelled += 1

    cash_total = Decimal("0")
    non_cash_total = Decimal("0")
    breakdown: dict[str, dict] = {}
    if issued_ids:
        payments = session.exec(
            select(DocumentPayment, PaymentMethod)
            .join(PaymentMethod, PaymentMethod.id == DocumentPayment.payment_method_id)
            .where(DocumentPayment.document_id.in_(issued_ids))
        ).all()
        for p, pm in payments:
            if pm.is_cash:
                cash_total += p.amount_clp
            else:
                non_cash_total += p.amount_clp
            entry = breakdown.setdefault(
                pm.id,
                {
                    "payment_method_id": pm.id,
                    "code": pm.code,
                    "name": pm.name,
                    "is_cash": pm.is_cash,
                    "amount": Decimal("0"),
                },
            )
            entry["amount"] += p.amount_clp

    items = sorted(
        (
            PaymentBreakdownItem(
                payment_method_id=v["payment_method_id"],
                code=v["code"],
                name=v["name"],
                is_cash=v["is_cash"],
                amount_clp=float(v["amount"]),
            )
            for v in breakdown.values()
        ),
        key=lambda b: -b.amount_clp,
    )

    return SessionSummary(
        documents_count=count,
        sales_total_clp=float(total),
        cash_total_clp=float(cash_total),
        non_cash_total_clp=float(non_cash_total),
        cancelled_count=cancelled,
        payments_by_method=list(items),
    )


def _to_row(session: Session, cs: CashSession) -> CashSessionRow:
    wh_code = None
    wh_name = None
    if cs.warehouse_id:
        wh = session.get(Warehouse, cs.warehouse_id)
        if wh:
            wh_code = wh.code
            wh_name = wh.name

    return CashSessionRow(
        id=cs.id,
        warehouse_id=cs.warehouse_id,
        warehouse_code=wh_code,
        warehouse_name=wh_name,
        opened_by=cs.opened_by,
        opened_at=cs.opened_at,
        closed_at=cs.closed_at,
        opening_amount_clp=float(cs.opening_amount_clp),
        closing_amount_clp=(
            float(cs.closing_amount_clp) if cs.closing_amount_clp is not None else None
        ),
        expected_amount_clp=(
            float(cs.expected_amount_clp) if cs.expected_amount_clp is not None else None
        ),
        difference_clp=(
            float(cs.difference_clp) if cs.difference_clp is not None else None
        ),
        status=cs.status,
        notes=cs.notes,
        summary=_session_summary(session, cs.id),
    )


def _find_open_for_warehouse(
    session: Session, warehouse_id: str
) -> Optional[CashSession]:
    return session.exec(
        select(CashSession)
        .where(CashSession.warehouse_id == warehouse_id)
        .where(CashSession.status == CashSessionStatus.open)
    ).first()


# ── List ──────────────────────────────────────────────────────────────────────


SortOrder = Literal["asc", "desc"]


@router.get("/sessions", response_model=CashSessionPage)
def list_sessions(
    warehouse_id: Optional[str] = None,
    status: Optional[CashSessionStatus] = None,
    order: SortOrder = "desc",
    limit: int = Query(default=25, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> CashSessionPage:
    with Session(engine) as session:
        stmt = select(CashSession)
        if warehouse_id:
            stmt = stmt.where(CashSession.warehouse_id == warehouse_id)
        if status:
            stmt = stmt.where(CashSession.status == status)
        stmt = stmt.order_by(
            CashSession.opened_at.desc() if order == "desc" else CashSession.opened_at.asc()
        )

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total_raw = session.exec(count_stmt).one()
        total = total_raw[0] if isinstance(total_raw, tuple) else int(total_raw)

        rows = session.exec(stmt.offset(offset).limit(limit)).all()
        return CashSessionPage(
            items=[_to_row(session, c) for c in rows],
            total=int(total),
            limit=limit,
            offset=offset,
        )


# ── Current open session (per warehouse) ─────────────────────────────────────


@router.get("/current", response_model=Optional[CashSessionRow])
def current_session(warehouse_id: str = Query(...)) -> Optional[CashSessionRow]:
    with Session(engine) as session:
        wh = session.get(Warehouse, warehouse_id)
        if wh is None:
            raise HTTPException(status_code=404, detail="Bodega no encontrada")
        cs = _find_open_for_warehouse(session, warehouse_id)
        if cs is None:
            return None
        return _to_row(session, cs)


@router.get("/sessions/{session_id}", response_model=CashSessionRow)
def get_session(session_id: str) -> CashSessionRow:
    with Session(engine) as session:
        cs = session.get(CashSession, session_id)
        if cs is None:
            raise HTTPException(status_code=404, detail="Sesion de caja no encontrada")
        return _to_row(session, cs)


# ── Open ──────────────────────────────────────────────────────────────────────


@router.post("/open", response_model=CashSessionRow, status_code=201)
def open_session(payload: OpenSessionInput) -> CashSessionRow:
    with Session(engine) as session:
        wh = session.get(Warehouse, payload.warehouse_id)
        if wh is None or not wh.is_active:
            raise HTTPException(status_code=404, detail="Bodega no encontrada o inactiva")

        existing = _find_open_for_warehouse(session, payload.warehouse_id)
        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail=f"Ya hay una sesion abierta en {wh.code} desde {existing.opened_at}. Cierrala antes de abrir otra.",
            )

        cs = CashSession(
            warehouse_id=payload.warehouse_id,
            opened_by=_normalize_optional_str(payload.opened_by),
            opening_amount_clp=Decimal(str(payload.opening_amount_clp)),
            notes=_normalize_optional_str(payload.notes),
            status=CashSessionStatus.open,
        )
        session.add(cs)
        session.commit()
        session.refresh(cs)
        return _to_row(session, cs)


# ── Close ─────────────────────────────────────────────────────────────────────


@router.post("/sessions/{session_id}/close", response_model=CashSessionRow)
def close_session(session_id: str, payload: CloseSessionInput) -> CashSessionRow:
    with Session(engine) as session:
        cs = session.get(CashSession, session_id)
        if cs is None:
            raise HTTPException(status_code=404, detail="Sesion de caja no encontrada")
        if cs.status != CashSessionStatus.open:
            raise HTTPException(status_code=400, detail="La sesion ya esta cerrada.")

        summary = _session_summary(session, session_id)
        # Expected uses ONLY cash payments (since v0.9): non-cash payments do
        # not affect the till. Plus opening float.
        expected = cs.opening_amount_clp + Decimal(str(summary.cash_total_clp))
        closing = Decimal(str(payload.closing_amount_clp))
        difference = closing - expected

        cs.closing_amount_clp = closing
        cs.expected_amount_clp = expected
        cs.difference_clp = difference
        cs.closed_at = datetime.now(timezone.utc)
        cs.status = CashSessionStatus.closed
        if payload.notes:
            extra = (payload.notes or "").strip()
            if extra:
                cs.notes = (cs.notes + "\n" if cs.notes else "") + extra

        session.add(cs)
        session.commit()
        session.refresh(cs)
        return _to_row(session, cs)
