"""Cotizaciones (quotes) router.

Una cotizacion es un documento pre-venta: NO mueve stock, NO requiere
pagos, NO se asocia a caja. Una vez aceptada se "convierte" en un
documento de venta (boleta / factura / nota_venta), que ahi si decrementa
stock y captura pagos.

Endpoints:
  POST   /api/quotes                            — crear cotizacion
  GET    /api/quotes                            — listar (filtro estado, vencidas)
  GET    /api/quotes/{id}                       — detalle (alias del documento)
  POST   /api/quotes/{id}/convert               — convertir a venta
  POST   /api/quotes/{id}/cancel                — descartar (status=cancelled)
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, func, select

from app.billing import (
    CheckoutItem,
    CheckoutPayment,
    ConvertQuoteInput,
    QuoteInput,
    convert_quote_to_sale,
    emit_quote,
)
from app.database import engine
from app.models import (
    Document,
    DocumentStatus,
    DocumentType,
)
from app.routers.pos import DocumentOut, _document_to_out

router = APIRouter()


# ── Shapes ────────────────────────────────────────────────────────────────────


class QuoteItemInput(BaseModel):
    variant_id: str
    quantity: float = Field(gt=0)
    unit_price_clp: Optional[float] = Field(default=None, ge=0)
    line_discount_clp: float = Field(default=0, ge=0)


class QuoteCreateInput(BaseModel):
    warehouse_id: str
    customer_id: Optional[str] = None
    price_list_id: Optional[str] = None
    valid_until: Optional[date] = None
    global_discount_clp: float = Field(default=0, ge=0)
    notes: Optional[str] = None
    items: list[QuoteItemInput]


class ConvertQuoteInputModel(BaseModel):
    document_type: DocumentType
    cash_session_id: Optional[str] = None
    payments: list[dict] = Field(default_factory=list)  # passthrough; validated by billing
    notes: Optional[str] = None


# ── Create ────────────────────────────────────────────────────────────────────


@router.post("", response_model=DocumentOut, status_code=201)
def create_quote(payload: QuoteCreateInput) -> DocumentOut:
    with Session(engine) as session:
        qi = QuoteInput(
            warehouse_id=payload.warehouse_id,
            customer_id=payload.customer_id,
            price_list_id=payload.price_list_id,
            valid_until=payload.valid_until,
            global_discount_clp=Decimal(str(payload.global_discount_clp)),
            notes=payload.notes,
            items=[
                CheckoutItem(
                    variant_id=it.variant_id,
                    quantity=Decimal(str(it.quantity)),
                    unit_price_override_clp=(
                        Decimal(str(it.unit_price_clp))
                        if it.unit_price_clp is not None
                        else None
                    ),
                    line_discount_clp=Decimal(str(it.line_discount_clp)),
                )
                for it in payload.items
            ],
        )
        quote = emit_quote(session, qi)
        session.commit()
        session.refresh(quote)
        return _document_to_out(session, quote)


# ── List ──────────────────────────────────────────────────────────────────────


class QuoteRow(BaseModel):
    id: str
    folio: int
    issued_at: str
    status: DocumentStatus
    customer_id: Optional[str]
    customer_name: Optional[str]
    warehouse_id: Optional[str]
    warehouse_code: Optional[str]
    total_clp: float
    items_count: int
    valid_until: Optional[str]
    is_expired: bool
    converted_to_document_id: Optional[str]
    converted_to_folio: Optional[int]
    converted_to_type: Optional[DocumentType]


class QuotePage(BaseModel):
    items: list[QuoteRow]
    total: int
    limit: int
    offset: int


def _to_row(session: Session, q: Document) -> QuoteRow:
    from app.models import Customer, DocumentItem, Warehouse

    items_count_raw = session.exec(
        select(func.count())
        .select_from(DocumentItem)
        .where(DocumentItem.document_id == q.id)
    ).first()
    items_count = items_count_raw[0] if isinstance(items_count_raw, tuple) else int(items_count_raw or 0)

    customer_name = None
    if q.customer_id:
        c = session.get(Customer, q.customer_id)
        if c:
            customer_name = c.razon_social

    warehouse_code = None
    if q.warehouse_id:
        wh = session.get(Warehouse, q.warehouse_id)
        if wh:
            warehouse_code = wh.code

    converted_folio = None
    converted_type = None
    if q.converted_to_document_id:
        target = session.get(Document, q.converted_to_document_id)
        if target:
            converted_folio = target.folio
            converted_type = target.document_type

    is_expired = False
    if q.valid_until and q.status == DocumentStatus.issued and q.converted_to_document_id is None:
        is_expired = q.valid_until < date.today()

    return QuoteRow(
        id=q.id,
        folio=q.folio,
        issued_at=q.issued_at.isoformat(),
        status=q.status,
        customer_id=q.customer_id,
        customer_name=customer_name,
        warehouse_id=q.warehouse_id,
        warehouse_code=warehouse_code,
        total_clp=float(q.total_clp),
        items_count=int(items_count),
        valid_until=q.valid_until.isoformat() if q.valid_until else None,
        is_expired=is_expired,
        converted_to_document_id=q.converted_to_document_id,
        converted_to_folio=converted_folio,
        converted_to_type=converted_type,
    )


SortOrder = Literal["asc", "desc"]


@router.get("", response_model=QuotePage)
def list_quotes(
    status: Optional[DocumentStatus] = None,
    only_active: bool = False,
    only_expired: bool = False,
    only_converted: bool = False,
    order: SortOrder = "desc",
    limit: int = Query(default=25, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> QuotePage:
    with Session(engine) as session:
        stmt = select(Document).where(Document.document_type == DocumentType.cotizacion)
        if status:
            stmt = stmt.where(Document.status == status)
        if only_active:
            stmt = stmt.where(Document.status == DocumentStatus.issued).where(
                Document.converted_to_document_id.is_(None)
            )
        if only_converted:
            stmt = stmt.where(Document.converted_to_document_id.is_not(None))
        if only_expired:
            stmt = stmt.where(Document.valid_until < date.today()).where(
                Document.status == DocumentStatus.issued
            ).where(Document.converted_to_document_id.is_(None))

        stmt = stmt.order_by(
            Document.issued_at.desc() if order == "desc" else Document.issued_at.asc(),
            Document.folio.desc() if order == "desc" else Document.folio.asc(),
        )

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total_raw = session.exec(count_stmt).one()
        total = total_raw[0] if isinstance(total_raw, tuple) else int(total_raw)

        rows = session.exec(stmt.offset(offset).limit(limit)).all()
        return QuotePage(
            items=[_to_row(session, q) for q in rows],
            total=int(total),
            limit=limit,
            offset=offset,
        )


# ── Detail ────────────────────────────────────────────────────────────────────


@router.get("/{quote_id}", response_model=DocumentOut)
def get_quote(quote_id: str) -> DocumentOut:
    with Session(engine) as session:
        q = session.get(Document, quote_id)
        if q is None or q.document_type != DocumentType.cotizacion:
            raise HTTPException(status_code=404, detail="Cotizacion no encontrada")
        return _document_to_out(session, q)


# ── Convert ──────────────────────────────────────────────────────────────────


@router.post("/{quote_id}/convert", response_model=DocumentOut, status_code=201)
def convert_quote(quote_id: str, payload: ConvertQuoteInputModel) -> DocumentOut:
    with Session(engine) as session:
        q = session.get(Document, quote_id)
        if q is None or q.document_type != DocumentType.cotizacion:
            raise HTTPException(status_code=404, detail="Cotizacion no encontrada")

        ci = ConvertQuoteInput(
            document_type=payload.document_type,
            cash_session_id=payload.cash_session_id,
            payments=[
                CheckoutPayment(
                    payment_method_id=p["payment_method_id"],
                    amount_clp=Decimal(str(p["amount_clp"])),
                    reference=p.get("reference"),
                )
                for p in payload.payments
            ],
            notes=payload.notes,
        )
        new_doc = convert_quote_to_sale(session, q, ci)
        session.commit()
        session.refresh(new_doc)
        return _document_to_out(session, new_doc)


# ── Cancel (descartar) ───────────────────────────────────────────────────────


@router.post("/{quote_id}/cancel", response_model=DocumentOut)
def cancel_quote(quote_id: str) -> DocumentOut:
    with Session(engine) as session:
        q = session.get(Document, quote_id)
        if q is None or q.document_type != DocumentType.cotizacion:
            raise HTTPException(status_code=404, detail="Cotizacion no encontrada")
        if q.converted_to_document_id is not None:
            raise HTTPException(
                status_code=400,
                detail="No se puede descartar una cotizacion ya convertida.",
            )
        q.status = DocumentStatus.cancelled
        session.add(q)
        session.commit()
        session.refresh(q)
        return _document_to_out(session, q)
