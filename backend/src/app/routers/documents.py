"""Documents router — list, detail, cancel.

POS is the only emission path (POST /api/pos/checkout). This router handles
queries and cancellation (which reverses stock movements).
"""

from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, func, select

from app.billing import cancel_document
from app.database import engine
from app.models import (
    Customer,
    Document,
    DocumentStatus,
    DocumentType,
    Warehouse,
)
from app.routers.pos import DocumentOut, _document_to_out

router = APIRouter()


# ── Shapes ────────────────────────────────────────────────────────────────────


class DocumentRow(BaseModel):
    id: str
    document_type: DocumentType
    folio: int
    issued_at: str
    status: DocumentStatus
    customer_id: Optional[str]
    customer_name: Optional[str]
    warehouse_id: Optional[str]
    warehouse_code: Optional[str]
    total_clp: float
    items_count: int


class DocumentPage(BaseModel):
    items: list[DocumentRow]
    total: int
    limit: int
    offset: int


SortOrder = Literal["asc", "desc"]


def _items_count(session: Session, document_id: str) -> int:
    from app.models import DocumentItem

    raw = session.exec(
        select(func.count())
        .select_from(DocumentItem)
        .where(DocumentItem.document_id == document_id)
    ).first()
    return raw[0] if isinstance(raw, tuple) else int(raw or 0)


def _to_row(session: Session, document: Document) -> DocumentRow:
    customer_name = None
    if document.customer_id:
        c = session.get(Customer, document.customer_id)
        if c:
            customer_name = c.razon_social

    warehouse_code = None
    if document.warehouse_id:
        wh = session.get(Warehouse, document.warehouse_id)
        if wh:
            warehouse_code = wh.code

    return DocumentRow(
        id=document.id,
        document_type=document.document_type,
        folio=document.folio,
        issued_at=document.issued_at.isoformat(),
        status=document.status,
        customer_id=document.customer_id,
        customer_name=customer_name,
        warehouse_id=document.warehouse_id,
        warehouse_code=warehouse_code,
        total_clp=float(document.total_clp),
        items_count=_items_count(session, document.id),
    )


# ── List ──────────────────────────────────────────────────────────────────────


@router.get("", response_model=DocumentPage)
def list_documents(
    document_type: Optional[DocumentType] = None,
    status: Optional[DocumentStatus] = None,
    customer_id: Optional[str] = None,
    warehouse_id: Optional[str] = None,
    issued_from: Optional[date] = None,
    issued_to: Optional[date] = None,
    q: Optional[str] = Query(default=None, description="Busca por folio, razon social, RUT, motivo."),
    order: SortOrder = "desc",
    limit: int = Query(default=25, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> DocumentPage:
    with Session(engine) as session:
        stmt = select(Document)

        if document_type:
            stmt = stmt.where(Document.document_type == document_type)
        if status:
            stmt = stmt.where(Document.status == status)
        if customer_id:
            stmt = stmt.where(Document.customer_id == customer_id)
        if warehouse_id:
            stmt = stmt.where(Document.warehouse_id == warehouse_id)
        if issued_from:
            stmt = stmt.where(Document.issued_at >= issued_from)
        if issued_to:
            stmt = stmt.where(Document.issued_at <= issued_to)
        if q:
            like = f"%{q.lower()}%"
            customer_match = (
                select(Customer.id).where(
                    func.lower(Customer.razon_social).like(like)
                    | func.lower(Customer.rut).like(like)
                )
            )
            try:
                folio_int = int(q.strip())
                stmt = stmt.where(
                    (Document.folio == folio_int)
                    | (Document.customer_id.in_(customer_match))
                    | (func.lower(Document.notes).like(like))
                )
            except ValueError:
                stmt = stmt.where(
                    Document.customer_id.in_(customer_match)
                    | (func.lower(Document.notes).like(like))
                )

        stmt = stmt.order_by(
            Document.issued_at.desc() if order == "desc" else Document.issued_at.asc(),
            Document.folio.desc() if order == "desc" else Document.folio.asc(),
        )

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total_raw = session.exec(count_stmt).one()
        total = total_raw[0] if isinstance(total_raw, tuple) else int(total_raw)

        rows = session.exec(stmt.offset(offset).limit(limit)).all()
        return DocumentPage(
            items=[_to_row(session, d) for d in rows],
            total=int(total),
            limit=limit,
            offset=offset,
        )


# ── Detail / cancel ──────────────────────────────────────────────────────────


@router.get("/{document_id}", response_model=DocumentOut)
def get_document(document_id: str) -> DocumentOut:
    with Session(engine) as session:
        d = session.get(Document, document_id)
        if d is None:
            raise HTTPException(status_code=404, detail="Documento no encontrado")
        return _document_to_out(session, d)


@router.post("/{document_id}/cancel", response_model=DocumentOut)
def cancel_doc(document_id: str) -> DocumentOut:
    """Anula el documento y revierte el stock asociado."""
    with Session(engine) as session:
        d = session.get(Document, document_id)
        if d is None:
            raise HTTPException(status_code=404, detail="Documento no encontrado")
        cancel_document(session, d)
        session.commit()
        session.refresh(d)
        return _document_to_out(session, d)
