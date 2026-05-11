"""Cuentas por cobrar (receivables).

Lista documentos con saldo pendiente (boleta/factura/nota_venta/guia
con payments < total). Endpoint:

  GET /api/receivables       — paginado, filtros por estado/customer/fecha
  GET /api/receivables/stats — resumen para dashboard
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal, Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlmodel import Session, func, select

from app.billing import document_balance
from app.database import engine
from app.models import (
    Customer,
    Document,
    DocumentStatus,
    DocumentType,
    Warehouse,
)

router = APIRouter()


SALES_TYPES = (
    DocumentType.boleta,
    DocumentType.factura,
    DocumentType.nota_venta,
    DocumentType.guia_despacho,
)


PaymentStatus = Literal["pending", "partial", "overdue", "paid"]


class ReceivableRow(BaseModel):
    id: str
    document_type: DocumentType
    folio: int
    issued_at: str
    due_date: Optional[str]
    days_to_due: Optional[int]
    is_overdue: bool
    customer_id: Optional[str]
    customer_name: Optional[str]
    customer_rut: Optional[str]
    warehouse_id: Optional[str]
    warehouse_code: Optional[str]
    total_clp: float
    paid_total_clp: float
    returned_total_clp: float
    balance_due_clp: float
    payment_status: PaymentStatus


class ReceivablePage(BaseModel):
    items: list[ReceivableRow]
    total: int
    limit: int
    offset: int


class ReceivablesStats(BaseModel):
    open_count: int
    total_due_clp: float
    overdue_count: int
    overdue_total_clp: float
    due_within_7_clp: float
    due_within_30_clp: float


def _row_for(session: Session, d: Document, today: date) -> ReceivableRow:
    paid_dec, returned_dec, balance_dec = document_balance(session, d)

    customer_name = None
    customer_rut = None
    if d.customer_id:
        c = session.get(Customer, d.customer_id)
        if c:
            customer_name = c.razon_social
            customer_rut = c.rut
    warehouse_code = None
    if d.warehouse_id:
        wh = session.get(Warehouse, d.warehouse_id)
        if wh:
            warehouse_code = wh.code

    days_to_due = None
    is_overdue = False
    if d.due_date is not None:
        days_to_due = (d.due_date - today).days
        is_overdue = balance_dec > 0 and d.due_date < today

    if balance_dec <= 0:
        status: PaymentStatus = "paid"
    elif paid_dec > 0:
        status = "overdue" if is_overdue else "partial"
    else:
        status = "overdue" if is_overdue else "pending"

    return ReceivableRow(
        id=d.id,
        document_type=d.document_type,
        folio=d.folio,
        issued_at=d.issued_at.isoformat(),
        due_date=d.due_date.isoformat() if d.due_date else None,
        days_to_due=days_to_due,
        is_overdue=is_overdue,
        customer_id=d.customer_id,
        customer_name=customer_name,
        customer_rut=customer_rut,
        warehouse_id=d.warehouse_id,
        warehouse_code=warehouse_code,
        total_clp=float(d.total_clp),
        paid_total_clp=float(paid_dec),
        returned_total_clp=float(returned_dec),
        balance_due_clp=float(balance_dec),
        payment_status=status,
    )


def _open_documents(
    session: Session,
    customer_id: Optional[str],
    warehouse_id: Optional[str],
    document_type: Optional[DocumentType],
) -> list[Document]:
    stmt = (
        select(Document)
        .where(Document.status == DocumentStatus.issued)
        .where(Document.document_type.in_(SALES_TYPES))
    )
    if customer_id:
        stmt = stmt.where(Document.customer_id == customer_id)
    if warehouse_id:
        stmt = stmt.where(Document.warehouse_id == warehouse_id)
    if document_type:
        stmt = stmt.where(Document.document_type == document_type)
    return session.exec(stmt).all()


@router.get("", response_model=ReceivablePage)
def list_receivables(
    status: Optional[PaymentStatus] = None,
    customer_id: Optional[str] = None,
    warehouse_id: Optional[str] = None,
    document_type: Optional[DocumentType] = None,
    due_from: Optional[date] = None,
    due_to: Optional[date] = None,
    only_with_balance: bool = True,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> ReceivablePage:
    with Session(engine) as session:
        docs = _open_documents(session, customer_id, warehouse_id, document_type)
        today = date.today()
        rows = [_row_for(session, d, today) for d in docs]

        if only_with_balance:
            rows = [r for r in rows if r.balance_due_clp > 0]
        if status:
            rows = [r for r in rows if r.payment_status == status]
        if due_from:
            rows = [
                r
                for r in rows
                if r.due_date is not None and date.fromisoformat(r.due_date) >= due_from
            ]
        if due_to:
            rows = [
                r
                for r in rows
                if r.due_date is not None and date.fromisoformat(r.due_date) <= due_to
            ]

        # Sort: overdue first (oldest due_date first), then by due_date asc, then null dues last.
        def _sort_key(r: ReceivableRow):
            return (
                0 if r.is_overdue else 1,
                r.due_date or "9999-12-31",
                r.issued_at,
            )

        rows.sort(key=_sort_key)
        total = len(rows)
        page = rows[offset : offset + limit]
        return ReceivablePage(items=page, total=total, limit=limit, offset=offset)


@router.get("/stats", response_model=ReceivablesStats)
def receivables_stats(
    warehouse_id: Optional[str] = None,
    customer_id: Optional[str] = None,
) -> ReceivablesStats:
    with Session(engine) as session:
        docs = _open_documents(session, customer_id, warehouse_id, None)
        today = date.today()
        open_count = 0
        total_due = Decimal("0")
        overdue_count = 0
        overdue_total = Decimal("0")
        due_within_7 = Decimal("0")
        due_within_30 = Decimal("0")

        for d in docs:
            _, _, balance = document_balance(session, d)
            if balance <= 0:
                continue
            open_count += 1
            total_due += balance
            if d.due_date is not None:
                delta = (d.due_date - today).days
                if delta < 0:
                    overdue_count += 1
                    overdue_total += balance
                if 0 <= delta <= 7:
                    due_within_7 += balance
                if 0 <= delta <= 30:
                    due_within_30 += balance

        return ReceivablesStats(
            open_count=open_count,
            total_due_clp=float(total_due),
            overdue_count=overdue_count,
            overdue_total_clp=float(overdue_total),
            due_within_7_clp=float(due_within_7),
            due_within_30_clp=float(due_within_30),
        )
