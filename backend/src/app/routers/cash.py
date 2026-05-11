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
    DocumentType,
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
    """Compute summary for a cash session.

    Sales documents (boleta/factura/nota_venta) SUMAN their totals. Credit
    notes (nota_credito) emitted in the same session RESTAN — they refund
    cash that has to come out of the till. Cancelled documents are excluded
    entirely.
    """
    docs = session.exec(
        select(Document).where(Document.cash_session_id == cash_session_id)
    ).all()
    sales_count = 0
    nc_count = 0
    sales_total = Decimal("0")
    nc_total = Decimal("0")
    cancelled = 0
    sales_ids: list[str] = []
    nc_ids: list[str] = []
    for d in docs:
        if d.status == DocumentStatus.cancelled:
            cancelled += 1
            continue
        if d.status != DocumentStatus.issued:
            continue
        if d.document_type == DocumentType.nota_credito:
            nc_count += 1
            nc_total += d.total_clp
            nc_ids.append(d.id)
        else:
            sales_count += 1
            sales_total += d.total_clp
            sales_ids.append(d.id)

    cash_total = Decimal("0")
    non_cash_total = Decimal("0")
    breakdown: dict[str, dict] = {}

    def _accumulate(doc_ids: list[str], sign: Decimal) -> None:
        if not doc_ids:
            return
        payments = session.exec(
            select(DocumentPayment, PaymentMethod)
            .join(PaymentMethod, PaymentMethod.id == DocumentPayment.payment_method_id)
            .where(DocumentPayment.document_id.in_(doc_ids))
        ).all()
        nonlocal cash_total, non_cash_total
        for p, pm in payments:
            amount = p.amount_clp * sign
            if pm.is_cash:
                cash_total += amount
            else:
                non_cash_total += amount
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
            entry["amount"] += amount

    _accumulate(sales_ids, Decimal("1"))
    # NCs without explicit payments: assume refunded in cash (fallback).
    # If a NC has explicit payments (future feature), they would offset by method.
    for nc_id in nc_ids:
        nc_doc = next(d for d in docs if d.id == nc_id)
        nc_payments = session.exec(
            select(DocumentPayment, PaymentMethod)
            .join(PaymentMethod, PaymentMethod.id == DocumentPayment.payment_method_id)
            .where(DocumentPayment.document_id == nc_id)
        ).all()
        if nc_payments:
            _accumulate([nc_id], Decimal("-1"))
        else:
            # No payments recorded on the NC: subtract from cash (default refund).
            cash_total -= nc_doc.total_clp
            cash_pm = session.exec(
                select(PaymentMethod)
                .where(PaymentMethod.is_cash.is_(True))
                .where(PaymentMethod.is_active.is_(True))
                .order_by(PaymentMethod.sort_order.asc())
            ).first()
            if cash_pm is not None:
                entry = breakdown.setdefault(
                    cash_pm.id,
                    {
                        "payment_method_id": cash_pm.id,
                        "code": cash_pm.code,
                        "name": cash_pm.name,
                        "is_cash": True,
                        "amount": Decimal("0"),
                    },
                )
                entry["amount"] -= nc_doc.total_clp

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
        documents_count=sales_count + nc_count,
        sales_total_clp=float(sales_total - nc_total),
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
