"""Point of sale router.

Endpoints:
  GET  /api/pos/search?q=...&warehouse_id&price_list_id
        — fuzzy product search returning variants with price+stock for the
          given warehouse (live cart picker).
  GET  /api/pos/lookup/{code}?warehouse_id&price_list_id
        — barcode/SKU exact lookup.
  POST /api/pos/checkout
        — atomic emission: creates Document + items + decrements stock.

Pricing is gross (incluye IVA). Calculation is delegated to app.billing.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, func, or_, select

from app.billing import (
    CheckoutInput,
    CheckoutItem,
    CheckoutPayment,
    emit_document,
    resolve_unit_price,
)
from app.database import engine
from app.models import (
    Document,
    DocumentType,
    PriceList,
    Product,
    ProductVariant,
    StockLevel,
    TaxCode,
    ProductVariantTaxCode,
    Warehouse,
)

router = APIRouter()


# ── Search / lookup shapes ────────────────────────────────────────────────────


class TaxCodeBrief(BaseModel):
    id: str
    code: str
    name: str
    rate: float


class CartProduct(BaseModel):
    variant_id: str
    sku: str
    barcode: Optional[str]
    display_name: str
    product_id: str
    product_name: str
    unit: str
    iva_affected: bool
    tracks_batches: bool
    base_price_clp: float
    effective_price_clp: float
    price_source: str
    stock_qty: float
    tax_codes: list[TaxCodeBrief]


def _variant_display(variant: ProductVariant, product: Product) -> str:
    if variant.display_name:
        return variant.display_name
    return f"{product.name} ({variant.sku})"


def _variant_to_cart(
    session: Session,
    variant: ProductVariant,
    product: Product,
    warehouse_id: str,
    price_list: Optional[PriceList],
) -> CartProduct:
    base_price = float(variant.price_clp)
    effective_price = float(resolve_unit_price(session, variant, price_list.id if price_list else None))
    source = "base"
    if price_list and not price_list.is_default and effective_price != base_price:
        source = "list"

    level = session.exec(
        select(StockLevel.qty)
        .where(StockLevel.variant_id == variant.id)
        .where(StockLevel.warehouse_id == warehouse_id)
    ).first()
    stock_qty = float(level or 0)

    tax_rows = session.exec(
        select(TaxCode)
        .join(ProductVariantTaxCode, ProductVariantTaxCode.tax_code_id == TaxCode.id)
        .where(ProductVariantTaxCode.variant_id == variant.id)
        .where(TaxCode.is_active.is_(True))
    ).all()

    return CartProduct(
        variant_id=variant.id,
        sku=variant.sku,
        barcode=variant.barcode,
        display_name=_variant_display(variant, product),
        product_id=product.id,
        product_name=product.name,
        unit=product.unit.value,
        iva_affected=product.iva_affected,
        tracks_batches=product.tracks_batches,
        base_price_clp=base_price,
        effective_price_clp=effective_price,
        price_source=source,
        stock_qty=stock_qty,
        tax_codes=[
            TaxCodeBrief(id=tc.id, code=tc.code, name=tc.name, rate=float(tc.rate))
            for tc in tax_rows
        ],
    )


def _resolve_price_list(session: Session, price_list_id: Optional[str]) -> Optional[PriceList]:
    if not price_list_id:
        return None
    pl = session.get(PriceList, price_list_id)
    if pl is None:
        raise HTTPException(status_code=404, detail="Lista de precios no encontrada")
    return pl


# ── Search ────────────────────────────────────────────────────────────────────


@router.get("/search", response_model=list[CartProduct])
def search_products(
    q: str = Query(..., min_length=1),
    warehouse_id: str = Query(...),
    price_list_id: Optional[str] = None,
    limit: int = Query(default=20, ge=1, le=100),
) -> list[CartProduct]:
    with Session(engine) as session:
        wh = session.get(Warehouse, warehouse_id)
        if wh is None or not wh.is_active:
            raise HTTPException(status_code=404, detail="Bodega no encontrada")
        pl = _resolve_price_list(session, price_list_id)

        like = f"%{q.lower()}%"
        stmt = (
            select(ProductVariant, Product)
            .join(Product, Product.id == ProductVariant.product_id)
            .where(ProductVariant.is_active.is_(True))
            .where(Product.is_active.is_(True))
            .where(
                or_(
                    func.lower(ProductVariant.sku).like(like),
                    func.lower(ProductVariant.barcode).like(like),
                    func.lower(Product.name).like(like),
                    func.lower(ProductVariant.display_name).like(like),
                )
            )
            .order_by(Product.name.asc(), ProductVariant.sku.asc())
            .limit(limit)
        )
        rows = session.exec(stmt).all()
        return [_variant_to_cart(session, v, p, warehouse_id, pl) for v, p in rows]


@router.get("/lookup/{code}", response_model=CartProduct)
def lookup_product(
    code: str,
    warehouse_id: str = Query(...),
    price_list_id: Optional[str] = None,
) -> CartProduct:
    """Exact match by SKU or barcode (case-insensitive). 404 if not found."""
    with Session(engine) as session:
        wh = session.get(Warehouse, warehouse_id)
        if wh is None or not wh.is_active:
            raise HTTPException(status_code=404, detail="Bodega no encontrada")
        pl = _resolve_price_list(session, price_list_id)

        code_lc = code.strip().lower()
        if not code_lc:
            raise HTTPException(status_code=400, detail="Codigo vacio.")
        stmt = (
            select(ProductVariant, Product)
            .join(Product, Product.id == ProductVariant.product_id)
            .where(ProductVariant.is_active.is_(True))
            .where(Product.is_active.is_(True))
            .where(
                or_(
                    func.lower(ProductVariant.sku) == code_lc,
                    func.lower(ProductVariant.barcode) == code_lc,
                )
            )
            .limit(1)
        )
        row = session.exec(stmt).first()
        if row is None:
            raise HTTPException(status_code=404, detail=f"No se encontro variante con codigo '{code}'")
        v, p = row
        return _variant_to_cart(session, v, p, warehouse_id, pl)


# ── Checkout ─────────────────────────────────────────────────────────────────


class CheckoutItemInput(BaseModel):
    variant_id: str
    quantity: float = Field(gt=0)
    unit_price_clp: Optional[float] = Field(default=None, ge=0)
    line_discount_clp: float = Field(default=0, ge=0)


class CheckoutPaymentInput(BaseModel):
    payment_method_id: str
    amount_clp: float = Field(gt=0)
    reference: Optional[str] = None


class CheckoutInputModel(BaseModel):
    document_type: DocumentType
    warehouse_id: str
    customer_id: Optional[str] = None
    price_list_id: Optional[str] = None
    cash_session_id: Optional[str] = None
    global_discount_clp: float = Field(default=0, ge=0)
    notes: Optional[str] = None
    items: list[CheckoutItemInput]
    payments: list[CheckoutPaymentInput] = Field(default_factory=list)


class DocumentItemOut(BaseModel):
    id: str
    variant_id: Optional[str]
    sku_snapshot: Optional[str]
    name_snapshot: str
    quantity: float
    unit_price_clp: float
    iva_affected: bool
    discount_clp: float
    line_total_clp: float


class DocumentPaymentOut(BaseModel):
    id: str
    payment_method_id: str
    code: str
    name: str
    is_cash: bool
    amount_clp: float
    reference: Optional[str]


class DocumentOut(BaseModel):
    id: str
    document_type: DocumentType
    folio: int
    issued_at: str
    status: str
    customer_id: Optional[str]
    customer_name: Optional[str]
    customer_rut: Optional[str]
    warehouse_id: Optional[str]
    warehouse_code: Optional[str]
    parent_document_id: Optional[str]
    parent_folio: Optional[int]
    parent_document_type: Optional[DocumentType]
    returned_total_clp: float
    effective_total_clp: float
    subtotal_clp: float
    iva_clp: float
    total_clp: float
    notes: Optional[str]
    items: list[DocumentItemOut]
    payments: list[DocumentPaymentOut]


def _document_to_out(session: Session, document: Document) -> DocumentOut:
    from app.models import (
        Customer,
        DocumentItem,
        DocumentPayment,
        DocumentStatus as _DS,
        DocumentType as _DT,
        PaymentMethod,
    )

    items = session.exec(
        select(DocumentItem).where(DocumentItem.document_id == document.id)
    ).all()

    parent_folio = None
    parent_type = None
    if document.parent_document_id:
        parent = session.get(Document, document.parent_document_id)
        if parent:
            parent_folio = parent.folio
            parent_type = parent.document_type

    returned_total = 0.0
    if document.document_type != _DT.nota_credito:
        ncs = session.exec(
            select(Document)
            .where(Document.parent_document_id == document.id)
            .where(Document.document_type == _DT.nota_credito)
            .where(Document.status == _DS.issued)
        ).all()
        returned_total = float(sum((nc.total_clp for nc in ncs), Decimal("0")))

    payment_rows = session.exec(
        select(DocumentPayment, PaymentMethod)
        .join(PaymentMethod, PaymentMethod.id == DocumentPayment.payment_method_id)
        .where(DocumentPayment.document_id == document.id)
    ).all()

    customer_name = None
    customer_rut = None
    if document.customer_id:
        c = session.get(Customer, document.customer_id)
        if c:
            customer_name = c.razon_social
            customer_rut = c.rut

    warehouse_code = None
    if document.warehouse_id:
        wh = session.get(Warehouse, document.warehouse_id)
        if wh:
            warehouse_code = wh.code

    return DocumentOut(
        id=document.id,
        document_type=document.document_type,
        folio=document.folio,
        issued_at=document.issued_at.isoformat(),
        status=document.status.value,
        customer_id=document.customer_id,
        customer_name=customer_name,
        customer_rut=customer_rut,
        warehouse_id=document.warehouse_id,
        warehouse_code=warehouse_code,
        parent_document_id=document.parent_document_id,
        parent_folio=parent_folio,
        parent_document_type=parent_type,
        returned_total_clp=returned_total,
        effective_total_clp=float(document.total_clp) - returned_total,
        subtotal_clp=float(document.subtotal_clp),
        iva_clp=float(document.iva_clp),
        total_clp=float(document.total_clp),
        notes=document.notes,
        items=[
            DocumentItemOut(
                id=i.id,
                variant_id=i.variant_id,
                sku_snapshot=i.sku_snapshot,
                name_snapshot=i.name_snapshot,
                quantity=float(i.quantity),
                unit_price_clp=float(i.unit_price_clp),
                iva_affected=i.iva_affected,
                discount_clp=float(i.discount_clp),
                line_total_clp=float(i.line_total_clp),
            )
            for i in items
        ],
        payments=[
            DocumentPaymentOut(
                id=p.id,
                payment_method_id=pm.id,
                code=pm.code,
                name=pm.name,
                is_cash=pm.is_cash,
                amount_clp=float(p.amount_clp),
                reference=p.reference,
            )
            for p, pm in payment_rows
        ],
    )


@router.post("/checkout", response_model=DocumentOut, status_code=201)
def checkout(payload: CheckoutInputModel) -> DocumentOut:
    with Session(engine) as session:
        ci = CheckoutInput(
            document_type=payload.document_type,
            warehouse_id=payload.warehouse_id,
            customer_id=payload.customer_id,
            price_list_id=payload.price_list_id,
            cash_session_id=payload.cash_session_id,
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
            payments=[
                CheckoutPayment(
                    payment_method_id=p.payment_method_id,
                    amount_clp=Decimal(str(p.amount_clp)),
                    reference=p.reference,
                )
                for p in payload.payments
            ],
        )
        document = emit_document(session, ci)
        session.commit()
        session.refresh(document)
        return _document_to_out(session, document)
