"""Documents router — list, detail, cancel.

POS is the only emission path (POST /api/pos/checkout). This router handles
queries and cancellation (which reverses stock movements).
"""

from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, func, select

from decimal import Decimal

from app.billing import (
    AddPaymentInput,
    CheckoutPayment,
    ConvertQuoteInput,
    CreditNoteInput,
    CreditNoteItem,
    add_payment,
    cancel_document,
    convert_to_sales_document,
    emit_credit_note,
)
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


class CreditNoteItemInput(BaseModel):
    original_item_id: str
    quantity: float


class CreditNoteInputModel(BaseModel):
    items: list[CreditNoteItemInput]
    reason: str
    notes: Optional[str] = None


@router.post("/{document_id}/credit-note", response_model=DocumentOut, status_code=201)
def create_credit_note(document_id: str, payload: CreditNoteInputModel) -> DocumentOut:
    """Emite una nota de credito parcial o total sobre el documento dado.

    - El doc original queda emitido; la NC se crea con su propio folio.
    - Stock se revierte por las cantidades devueltas.
    - La sesion de caja abierta (si existe) absorbe la NC, restandola del cash_total.
    """
    with Session(engine) as session:
        ci = CreditNoteInput(
            original_document_id=document_id,
            items=[
                CreditNoteItem(
                    original_item_id=it.original_item_id,
                    quantity=Decimal(str(it.quantity)),
                )
                for it in payload.items
            ],
            reason=payload.reason,
            notes=payload.notes,
        )
        nc = emit_credit_note(session, ci)
        session.commit()
        session.refresh(nc)
        return _document_to_out(session, nc)


@router.get("/{document_id}/credit-notes", response_model=list[DocumentRow])
def list_credit_notes_for(document_id: str) -> list[DocumentRow]:
    with Session(engine) as session:
        d = session.get(Document, document_id)
        if d is None:
            raise HTTPException(status_code=404, detail="Documento no encontrado")
        ncs = session.exec(
            select(Document)
            .where(Document.parent_document_id == document_id)
            .where(Document.document_type == DocumentType.nota_credito)
            .order_by(Document.issued_at.desc(), Document.folio.desc())
        ).all()
        return [_to_row(session, n) for n in ncs]


# ── Convert (guia o cotizacion -> venta) ─────────────────────────────────────


class ConvertInputModel(BaseModel):
    document_type: DocumentType
    cash_session_id: Optional[str] = None
    payments: list[dict] = []
    notes: Optional[str] = None


class AddPaymentItemInput(BaseModel):
    payment_method_id: str
    amount_clp: float = Field(gt=0)
    reference: Optional[str] = None


class AddPaymentInputModel(BaseModel):
    payments: list[AddPaymentItemInput]


@router.post("/{document_id}/payments", response_model=DocumentOut, status_code=201)
def add_document_payment(document_id: str, payload: AddPaymentInputModel) -> DocumentOut:
    """Registra un abono sobre un documento con saldo pendiente."""
    from decimal import Decimal as _Decimal

    with Session(engine) as session:
        d = session.get(Document, document_id)
        if d is None:
            raise HTTPException(status_code=404, detail="Documento no encontrado")
        api = AddPaymentInput(
            payments=[
                CheckoutPayment(
                    payment_method_id=p.payment_method_id,
                    amount_clp=_Decimal(str(p.amount_clp)),
                    reference=p.reference,
                )
                for p in payload.payments
            ],
        )
        add_payment(session, d, api)
        session.commit()
        session.refresh(d)
        return _document_to_out(session, d)


@router.post("/{document_id}/convert", response_model=DocumentOut, status_code=201)
def convert_to_invoice(document_id: str, payload: ConvertInputModel) -> DocumentOut:
    """Convierte una guia de despacho o una cotizacion en boleta/factura/nota_venta."""
    from decimal import Decimal as _Decimal

    with Session(engine) as session:
        d = session.get(Document, document_id)
        if d is None:
            raise HTTPException(status_code=404, detail="Documento no encontrado")
        ci = ConvertQuoteInput(
            document_type=payload.document_type,
            cash_session_id=payload.cash_session_id,
            payments=[
                CheckoutPayment(
                    payment_method_id=p["payment_method_id"],
                    amount_clp=_Decimal(str(p["amount_clp"])),
                    reference=p.get("reference"),
                )
                for p in payload.payments
            ],
            notes=payload.notes,
        )
        new_doc = convert_to_sales_document(session, d, ci)
        session.commit()
        session.refresh(new_doc)
        return _document_to_out(session, new_doc)
