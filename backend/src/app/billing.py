"""Billing / sales emission helpers.

Centralizes:
  - Per-line and document-level total calculation (net, IVA, additional taxes)
  - Folio assignment per document_type
  - Document emission with atomic stock decrement (FIFO batch consumption for
    products with tracks_batches)
  - Stock reversal when a document is cancelled

This is shared between the POS checkout endpoint and the (optional) manual
document-creation endpoint. The IVA rate is fixed at 19% (Chile) for v0.x.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models import (
    Batch,
    Customer,
    Document,
    DocumentItem,
    DocumentPayment,
    DocumentStatus,
    DocumentType,
    PaymentMethod,
    PriceList,
    PriceListEntry,
    Product,
    ProductVariant,
    ProductVariantTaxCode,
    StockLevel,
    StockMovement,
    StockMovementKind,
    TaxCode,
    Warehouse,
)

IVA_RATE = Decimal("0.19")
DEC_ZERO = Decimal("0")


def _round_clp(value: Decimal) -> Decimal:
    """Round to integer pesos."""
    return value.quantize(Decimal("1"), rounding=ROUND_HALF_UP)


# ── Input shapes ──────────────────────────────────────────────────────────────


@dataclass
class CheckoutItem:
    variant_id: str
    quantity: Decimal
    unit_price_override_clp: Optional[Decimal]  # if None, resolve from price list
    line_discount_clp: Decimal


@dataclass
class CheckoutPayment:
    payment_method_id: str
    amount_clp: Decimal
    reference: Optional[str]


@dataclass
class CheckoutInput:
    document_type: DocumentType
    warehouse_id: str
    customer_id: Optional[str]
    price_list_id: Optional[str]
    cash_session_id: Optional[str]
    global_discount_clp: Decimal
    notes: Optional[str]
    items: list[CheckoutItem]
    payments: list[CheckoutPayment]
    shipping_address: Optional[str] = None
    shipping_notes: Optional[str] = None
    carrier_name: Optional[str] = None
    due_date: Optional[date] = None
    # Internal flag set during guia_despacho -> invoice conversion: stock
    # already left when the guia was emitted, so we don't decrement again.
    skip_stock: bool = False


@dataclass
class LineCalc:
    variant: ProductVariant
    product: Product
    quantity: Decimal
    unit_price_clp: Decimal        # gross (incl. IVA)
    line_gross_clp: Decimal        # unit_price * qty - line_discount
    line_net_clp: Decimal          # gross / 1.19 if iva_affected else gross
    line_iva_clp: Decimal
    line_additional_tax_clp: Decimal
    line_discount_clp: Decimal
    tax_codes: list[TaxCode]


@dataclass
class DocumentTotals:
    subtotal_clp: Decimal       # sum of net (without IVA, without additional)
    iva_clp: Decimal
    additional_tax_clp: Decimal
    global_discount_clp: Decimal
    total_clp: Decimal          # subtotal + iva + additional - global_discount


# ── Price resolution ─────────────────────────────────────────────────────────


def resolve_unit_price(
    session: Session,
    variant: ProductVariant,
    price_list_id: Optional[str],
) -> Decimal:
    """Find the effective gross unit price for the variant under the given
    price list. Default list (or no list) uses the variant base price."""
    if not price_list_id:
        return variant.price_clp
    pl = session.get(PriceList, price_list_id)
    if pl is None:
        raise HTTPException(status_code=404, detail="Lista de precios no encontrada")
    if pl.is_default:
        return variant.price_clp
    entry = session.exec(
        select(PriceListEntry)
        .where(PriceListEntry.price_list_id == price_list_id)
        .where(PriceListEntry.variant_id == variant.id)
    ).first()
    return entry.price_clp if entry else variant.price_clp


def _variant_tax_codes(session: Session, variant_id: str) -> list[TaxCode]:
    rows = session.exec(
        select(TaxCode)
        .join(ProductVariantTaxCode, ProductVariantTaxCode.tax_code_id == TaxCode.id)
        .where(ProductVariantTaxCode.variant_id == variant_id)
        .where(TaxCode.is_active.is_(True))
    ).all()
    return list(rows)


# ── Line / document totals ───────────────────────────────────────────────────


def _calc_line(
    session: Session,
    item: CheckoutItem,
    price_list_id: Optional[str],
) -> LineCalc:
    variant = session.get(ProductVariant, item.variant_id)
    if variant is None or not variant.is_active:
        raise HTTPException(
            status_code=400, detail=f"Variante {item.variant_id} no existe o esta inactiva."
        )
    product = session.get(Product, variant.product_id)
    if product is None or not product.is_active:
        raise HTTPException(
            status_code=400,
            detail=f"Producto de la variante {variant.sku} no existe o esta inactivo.",
        )

    unit_price = (
        item.unit_price_override_clp
        if item.unit_price_override_clp is not None
        else resolve_unit_price(session, variant, price_list_id)
    )
    unit_price = Decimal(unit_price)
    qty = Decimal(item.quantity)
    line_discount = Decimal(item.line_discount_clp or 0)

    line_gross = (unit_price * qty) - line_discount
    if line_gross < 0:
        raise HTTPException(
            status_code=400,
            detail=f"Descuento de linea excede el monto en {variant.sku}",
        )

    if product.iva_affected:
        line_net = line_gross / (Decimal("1") + IVA_RATE)
        line_iva = line_gross - line_net
    else:
        line_net = line_gross
        line_iva = DEC_ZERO

    tax_codes = _variant_tax_codes(session, variant.id)
    additional = DEC_ZERO
    for tc in tax_codes:
        additional += line_net * tc.rate

    return LineCalc(
        variant=variant,
        product=product,
        quantity=qty,
        unit_price_clp=unit_price,
        line_gross_clp=line_gross,
        line_net_clp=line_net,
        line_iva_clp=line_iva,
        line_additional_tax_clp=additional,
        line_discount_clp=line_discount,
        tax_codes=tax_codes,
    )


def compute_totals(
    session: Session, payload: CheckoutInput
) -> tuple[list[LineCalc], DocumentTotals]:
    if not payload.items:
        raise HTTPException(status_code=400, detail="El documento no tiene items.")

    lines = [_calc_line(session, it, payload.price_list_id) for it in payload.items]

    subtotal = sum((line.line_net_clp for line in lines), DEC_ZERO)
    iva = sum((line.line_iva_clp for line in lines), DEC_ZERO)
    additional = sum((line.line_additional_tax_clp for line in lines), DEC_ZERO)
    global_discount = Decimal(payload.global_discount_clp or 0)

    total = subtotal + iva + additional - global_discount
    if total < 0:
        raise HTTPException(status_code=400, detail="Descuento global excede el total.")

    totals = DocumentTotals(
        subtotal_clp=_round_clp(subtotal),
        iva_clp=_round_clp(iva),
        additional_tax_clp=_round_clp(additional),
        global_discount_clp=_round_clp(global_discount),
        total_clp=_round_clp(total),
    )
    return lines, totals


# ── Folio assignment ─────────────────────────────────────────────────────────


def next_folio(session: Session, document_type: DocumentType) -> int:
    """Return MAX(folio)+1 per document_type, starting at 1."""
    from sqlmodel import func

    raw = session.exec(
        select(func.max(Document.folio)).where(Document.document_type == document_type)
    ).first()
    current = raw[0] if isinstance(raw, tuple) else raw
    return int(current or 0) + 1


# ── Customer validation per document type ───────────────────────────────────


def validate_customer_for_type(
    customer: Optional[Customer], document_type: DocumentType
) -> None:
    if document_type == DocumentType.factura:
        if customer is None:
            raise HTTPException(
                status_code=400,
                detail="Factura requiere un cliente con RUT.",
            )
        if not customer.rut or not customer.rut.strip():
            raise HTTPException(
                status_code=400,
                detail=f"El cliente '{customer.razon_social}' no tiene RUT.",
            )


# ── Stock fulfillment (with FIFO batches when applicable) ───────────────────


def _fifo_batches_for(
    session: Session, variant_id: str, warehouse_id: str
) -> list[Batch]:
    """Return active batches in the warehouse with qty>0, sorted FIFO:
    expired last? No — FIFO by expiry ascending puts the closest-to-expire first
    which is the right behaviour (consume what expires sooner). NULL expiry
    sorts last (long-lived stock)."""
    rows = session.exec(
        select(Batch)
        .where(Batch.variant_id == variant_id)
        .where(Batch.warehouse_id == warehouse_id)
        .where(Batch.qty > 0)
        .order_by(Batch.expiry_date.is_(None), Batch.expiry_date.asc())
    ).all()
    return list(rows)


def fulfill_line(
    session: Session,
    line: LineCalc,
    warehouse: Warehouse,
    document: Document,
) -> None:
    """Decrement stock for the line; write StockMovement(s). Handles both
    batched and non-batched products. Caller must commit."""
    if line.product.product_type.value == "service":
        return  # services don't move stock

    qty_needed = line.quantity

    level = session.exec(
        select(StockLevel)
        .where(StockLevel.variant_id == line.variant.id)
        .where(StockLevel.warehouse_id == warehouse.id)
    ).first()
    if level is None or level.qty < qty_needed:
        available = level.qty if level else DEC_ZERO
        raise HTTPException(
            status_code=400,
            detail=f"Stock insuficiente para {line.variant.sku} en {warehouse.code}: "
                   f"hay {available}, requeridos {qty_needed}.",
        )

    if line.product.tracks_batches:
        batches = _fifo_batches_for(session, line.variant.id, warehouse.id)
        total_in_batches = sum((b.qty for b in batches), DEC_ZERO)
        if total_in_batches < qty_needed:
            raise HTTPException(
                status_code=400,
                detail=f"Lotes insuficientes para {line.variant.sku} en {warehouse.code}: "
                       f"suman {total_in_batches}, requeridos {qty_needed}.",
            )
        remaining = qty_needed
        for batch in batches:
            if remaining <= 0:
                break
            take = min(batch.qty, remaining)
            batch.qty -= take
            session.add(batch)
            level.qty -= take
            session.add(level)
            session.add(
                StockMovement(
                    variant_id=line.variant.id,
                    warehouse_id=warehouse.id,
                    batch_id=batch.id,
                    kind=StockMovementKind.salida,
                    quantity=-take,
                    qty_after=level.qty,
                    reason=f"Venta {document.document_type.value} #{document.folio} (lote {batch.lot_number})",
                    document_id=document.id,
                )
            )
            remaining -= take
    else:
        level.qty -= qty_needed
        session.add(level)
        session.add(
            StockMovement(
                variant_id=line.variant.id,
                warehouse_id=warehouse.id,
                kind=StockMovementKind.salida,
                quantity=-qty_needed,
                qty_after=level.qty,
                reason=f"Venta {document.document_type.value} #{document.folio}",
                document_id=document.id,
            )
        )


# ── Emit ──────────────────────────────────────────────────────────────────────


def emit_document(session: Session, payload: CheckoutInput) -> Document:
    """Atomic document emission. Validates inputs, computes totals, assigns
    folio, persists Document + items + stock decrements + movements.
    Caller commits."""
    warehouse = session.get(Warehouse, payload.warehouse_id)
    if warehouse is None or not warehouse.is_active:
        raise HTTPException(status_code=404, detail="Bodega no encontrada o inactiva.")

    customer: Optional[Customer] = None
    if payload.customer_id:
        customer = session.get(Customer, payload.customer_id)
        if customer is None:
            raise HTTPException(status_code=404, detail="Cliente no encontrado.")
    validate_customer_for_type(customer, payload.document_type)

    from app.models import CashSession, CashSessionStatus

    resolved_session_id: Optional[str] = None
    if payload.cash_session_id:
        cs = session.get(CashSession, payload.cash_session_id)
        if cs is None:
            raise HTTPException(status_code=404, detail="Sesion de caja no encontrada.")
        if cs.status != CashSessionStatus.open:
            raise HTTPException(status_code=400, detail="La sesion de caja no esta abierta.")
        resolved_session_id = cs.id
    else:
        # Auto-link to the warehouse's open session if any.
        auto = session.exec(
            select(CashSession)
            .where(CashSession.warehouse_id == warehouse.id)
            .where(CashSession.status == CashSessionStatus.open)
        ).first()
        if auto is not None:
            resolved_session_id = auto.id

    lines, totals = compute_totals(session, payload)

    document = Document(
        document_type=payload.document_type,
        folio=next_folio(session, payload.document_type),
        customer_id=customer.id if customer else None,
        warehouse_id=warehouse.id,
        status=DocumentStatus.issued,
        subtotal_clp=totals.subtotal_clp,
        iva_clp=totals.iva_clp,
        total_clp=totals.total_clp,
        notes=(payload.notes or None),
        cash_session_id=resolved_session_id,
        shipping_address=(payload.shipping_address or None),
        shipping_notes=(payload.shipping_notes or None),
        carrier_name=(payload.carrier_name or None),
        due_date=payload.due_date,
    )
    session.add(document)
    session.flush()

    for line in lines:
        session.add(
            DocumentItem(
                document_id=document.id,
                variant_id=line.variant.id,
                sku_snapshot=line.variant.sku,
                name_snapshot=line.product.name,
                quantity=line.quantity,
                unit_price_clp=line.unit_price_clp,
                iva_affected=line.product.iva_affected,
                discount_clp=line.line_discount_clp,
                line_total_clp=_round_clp(line.line_gross_clp),
            )
        )
        if not payload.skip_stock:
            fulfill_line(session, line, warehouse, document)

    # Persist payments.
    #
    # Boleta: must be paid in full at emission. If no payments are provided,
    #         default to a single cash payment for the total.
    # Factura / nota_venta: may be emitted with partial payment or none, and
    #         the remaining balance becomes a receivable. Set due_date when
    #         leaving an open balance.
    # Guia de despacho: emitted without payments — bill comes later.
    payments = list(payload.payments) if payload.payments else []

    if (
        not payments
        and payload.document_type == DocumentType.boleta
    ):
        cash_pm = session.exec(
            select(PaymentMethod)
            .where(PaymentMethod.is_cash.is_(True))
            .where(PaymentMethod.is_active.is_(True))
            .order_by(PaymentMethod.sort_order.asc())
        ).first()
        if cash_pm is None:
            raise HTTPException(
                status_code=400,
                detail="No hay metodos de pago en efectivo configurados.",
            )
        payments = [
            CheckoutPayment(
                payment_method_id=cash_pm.id,
                amount_clp=totals.total_clp,
                reference=None,
            )
        ]

    total_paid = DEC_ZERO
    for p in payments:
        pm = session.get(PaymentMethod, p.payment_method_id)
        if pm is None or not pm.is_active:
            raise HTTPException(
                status_code=400,
                detail=f"Metodo de pago invalido: {p.payment_method_id}",
            )
        amount = Decimal(p.amount_clp)
        if amount <= 0:
            raise HTTPException(status_code=400, detail="El monto del pago debe ser mayor a 0.")
        total_paid += amount
        session.add(
            DocumentPayment(
                document_id=document.id,
                payment_method_id=pm.id,
                amount_clp=amount,
                reference=(p.reference or None),
            )
        )

    # Boleta cuadre exacto. Factura / nota_venta / guia: solo verificar que no
    # se exceda el total (puede quedar saldo pendiente).
    if payments:
        if payload.document_type == DocumentType.boleta:
            if abs(total_paid - totals.total_clp) > Decimal("1"):
                raise HTTPException(
                    status_code=400,
                    detail=f"En boleta los pagos deben cuadrar con el total. Pagado {total_paid}, total {totals.total_clp}.",
                )
        else:
            if total_paid - totals.total_clp > Decimal("1"):
                raise HTTPException(
                    status_code=400,
                    detail=f"Los pagos ({total_paid}) exceden el total del documento ({totals.total_clp}).",
                )

    return document


# ── Receivables: add payment to existing doc ─────────────────────────────────


@dataclass
class AddPaymentInput:
    payments: list[CheckoutPayment]
    occurred_at: Optional[datetime] = None


def document_balance(session: Session, document: Document) -> tuple[Decimal, Decimal, Decimal]:
    """Returns (paid_total, returned_total, balance_due).

    balance_due = total_clp - returned_total - paid_total (clamped to 0).
    """
    if document.document_type not in (
        DocumentType.boleta,
        DocumentType.factura,
        DocumentType.nota_venta,
        DocumentType.guia_despacho,
    ):
        return DEC_ZERO, DEC_ZERO, DEC_ZERO

    paid = session.exec(
        select(DocumentPayment).where(DocumentPayment.document_id == document.id)
    ).all()
    paid_total = sum((p.amount_clp for p in paid), DEC_ZERO)

    ncs = session.exec(
        select(Document)
        .where(Document.parent_document_id == document.id)
        .where(Document.document_type == DocumentType.nota_credito)
        .where(Document.status == DocumentStatus.issued)
    ).all()
    returned_total = sum((nc.total_clp for nc in ncs), DEC_ZERO)

    balance = document.total_clp - returned_total - paid_total
    if balance < DEC_ZERO:
        balance = DEC_ZERO
    return paid_total, returned_total, balance


def add_payment(session: Session, document: Document, payload: AddPaymentInput) -> Document:
    """Register additional payment(s) against a document. Used for collecting
    receivables on already-emitted documents (factura/nota_venta with balance
    due, or paying off a guia_despacho that wasn't billed yet)."""
    if document.status != DocumentStatus.issued:
        raise HTTPException(
            status_code=400,
            detail=f"El documento no esta emitido (estado: {document.status.value}).",
        )
    if document.document_type not in (
        DocumentType.boleta,
        DocumentType.factura,
        DocumentType.nota_venta,
        DocumentType.guia_despacho,
    ):
        raise HTTPException(
            status_code=400,
            detail="Solo se pueden registrar pagos sobre boletas, facturas, notas de venta o guias.",
        )
    if not payload.payments:
        raise HTTPException(status_code=400, detail="No se incluyeron pagos.")

    _, _, balance = document_balance(session, document)
    if balance <= 0:
        raise HTTPException(
            status_code=400,
            detail="El documento ya esta totalmente pagado o no tiene saldo pendiente.",
        )

    # Auto-link payments to the open cash session of the document's warehouse.
    from app.models import CashSession, CashSessionStatus

    resolved_session_id: Optional[str] = document.cash_session_id
    if resolved_session_id is None and document.warehouse_id:
        auto = session.exec(
            select(CashSession)
            .where(CashSession.warehouse_id == document.warehouse_id)
            .where(CashSession.status == CashSessionStatus.open)
        ).first()
        if auto is not None:
            resolved_session_id = auto.id
            document.cash_session_id = auto.id
            session.add(document)

    total_new = DEC_ZERO
    for p in payload.payments:
        pm = session.get(PaymentMethod, p.payment_method_id)
        if pm is None or not pm.is_active:
            raise HTTPException(
                status_code=400,
                detail=f"Metodo de pago invalido: {p.payment_method_id}",
            )
        amount = Decimal(p.amount_clp)
        if amount <= 0:
            raise HTTPException(status_code=400, detail="El monto del pago debe ser mayor a 0.")
        total_new += amount
        session.add(
            DocumentPayment(
                document_id=document.id,
                payment_method_id=pm.id,
                amount_clp=amount,
                reference=(p.reference or None),
                occurred_at=payload.occurred_at or datetime.now(timezone.utc),
            )
        )

    if total_new - balance > Decimal("1"):
        raise HTTPException(
            status_code=400,
            detail=f"El abono ({total_new}) excede el saldo pendiente ({balance}).",
        )

    return document


# ── Cancel ────────────────────────────────────────────────────────────────────


# ── Cotizacion (quote) ───────────────────────────────────────────────────────


@dataclass
class QuoteInput:
    warehouse_id: str
    customer_id: Optional[str]
    price_list_id: Optional[str]
    valid_until: Optional[date]
    global_discount_clp: Decimal
    notes: Optional[str]
    items: list[CheckoutItem]


def emit_quote(session: Session, payload: QuoteInput) -> Document:
    """Crea una cotizacion. NO mueve stock, NO requiere pagos, NO asocia caja.

    Reusa la calculadora de totales: para los items pasados resuelve precios
    (override / lista / base) y computa neto + IVA + impuestos adicionales
    como en una venta normal.
    """
    warehouse = session.get(Warehouse, payload.warehouse_id)
    if warehouse is None or not warehouse.is_active:
        raise HTTPException(status_code=404, detail="Bodega no encontrada o inactiva.")

    customer: Optional[Customer] = None
    if payload.customer_id:
        customer = session.get(Customer, payload.customer_id)
        if customer is None:
            raise HTTPException(status_code=404, detail="Cliente no encontrado.")

    # Reuse compute_totals via a synthetic CheckoutInput.
    ci = CheckoutInput(
        document_type=DocumentType.cotizacion,
        warehouse_id=warehouse.id,
        customer_id=customer.id if customer else None,
        price_list_id=payload.price_list_id,
        cash_session_id=None,
        global_discount_clp=payload.global_discount_clp,
        notes=payload.notes,
        items=payload.items,
        payments=[],
    )
    lines, totals = compute_totals(session, ci)

    quote = Document(
        document_type=DocumentType.cotizacion,
        folio=next_folio(session, DocumentType.cotizacion),
        customer_id=customer.id if customer else None,
        warehouse_id=warehouse.id,
        status=DocumentStatus.issued,
        subtotal_clp=totals.subtotal_clp,
        iva_clp=totals.iva_clp,
        total_clp=totals.total_clp,
        notes=(payload.notes or None),
        cash_session_id=None,
        valid_until=payload.valid_until,
    )
    session.add(quote)
    session.flush()

    for line in lines:
        session.add(
            DocumentItem(
                document_id=quote.id,
                variant_id=line.variant.id,
                sku_snapshot=line.variant.sku,
                name_snapshot=line.product.name,
                quantity=line.quantity,
                unit_price_clp=line.unit_price_clp,
                iva_affected=line.product.iva_affected,
                discount_clp=line.line_discount_clp,
                line_total_clp=_round_clp(line.line_gross_clp),
            )
        )

    return quote


@dataclass
class ConvertQuoteInput:
    document_type: DocumentType  # boleta / factura / nota_venta
    cash_session_id: Optional[str]
    payments: list[CheckoutPayment]
    notes: Optional[str]


CONVERTIBLE_SOURCES = (DocumentType.cotizacion, DocumentType.guia_despacho)


def convert_to_sales_document(
    session: Session, source: Document, payload: ConvertQuoteInput
) -> Document:
    """Convierte una cotizacion o guia de despacho en un documento de venta
    fiscal (boleta/factura/nota_venta).

    - Si source es cotizacion: stock se decrementa en la conversion (en la
      cotizacion no se movio).
    - Si source es guia_despacho: stock ya salio al emitir la guia, asi que
      la conversion NO decrementa stock (skip_stock=True).

    En ambos casos:
    - Captura pagos en el nuevo documento (si los hay).
    - Vincula source.converted_to_document_id al nuevo documento.
    """
    if source.document_type not in CONVERTIBLE_SOURCES:
        raise HTTPException(
            status_code=400,
            detail="Solo se pueden convertir cotizaciones o guias de despacho.",
        )
    label = "cotizacion" if source.document_type == DocumentType.cotizacion else "guia"
    if source.status != DocumentStatus.issued:
        raise HTTPException(
            status_code=400,
            detail=f"La {label} no esta abierta (estado: {source.status.value}).",
        )
    if source.converted_to_document_id is not None:
        raise HTTPException(
            status_code=400,
            detail=f"La {label} ya fue convertida.",
        )
    if payload.document_type not in (
        DocumentType.boleta,
        DocumentType.factura,
        DocumentType.nota_venta,
    ):
        raise HTTPException(
            status_code=400,
            detail="El tipo de destino debe ser boleta, factura o nota_venta.",
        )

    source_items = session.exec(
        select(DocumentItem).where(DocumentItem.document_id == source.id)
    ).all()
    if not source_items:
        raise HTTPException(status_code=400, detail=f"La {label} no tiene items.")

    skip_stock = source.document_type == DocumentType.guia_despacho
    default_note = f"Convertido desde {label} #{source.folio}"

    checkout = CheckoutInput(
        document_type=payload.document_type,
        warehouse_id=source.warehouse_id or "",
        customer_id=source.customer_id,
        price_list_id=None,
        cash_session_id=payload.cash_session_id,
        global_discount_clp=DEC_ZERO,
        notes=(payload.notes or default_note),
        items=[
            CheckoutItem(
                variant_id=it.variant_id or "",
                quantity=it.quantity,
                unit_price_override_clp=it.unit_price_clp,
                line_discount_clp=it.discount_clp,
            )
            for it in source_items
            if it.variant_id
        ],
        payments=payload.payments,
        skip_stock=skip_stock,
    )
    new_doc = emit_document(session, checkout)

    source.converted_to_document_id = new_doc.id
    source.updated_at = datetime.now(timezone.utc)
    session.add(source)

    return new_doc


# Backwards-compat alias for the quotes router.
convert_quote_to_sale = convert_to_sales_document


# ── Credit note (nota de credito) ────────────────────────────────────────────


@dataclass
class CreditNoteItem:
    """Linea a devolver: referencia al item original + cantidad a refundir."""

    original_item_id: str
    quantity: Decimal


@dataclass
class CreditNoteInput:
    original_document_id: str
    items: list[CreditNoteItem]
    reason: str
    notes: Optional[str]


def _already_credited_qty(
    session: Session, parent_doc_id: str, original_item_sku: Optional[str]
) -> Decimal:
    """Sum of quantities already credited for a given (parent doc, item).

    Match items by sku_snapshot since NC items reference the variant but not
    the original DocumentItem.id. If sku is None we fall back to 0 (cannot
    track partial returns for items without sku).
    """
    if original_item_sku is None:
        return DEC_ZERO

    rows = session.exec(
        select(DocumentItem)
        .join(Document, Document.id == DocumentItem.document_id)
        .where(Document.parent_document_id == parent_doc_id)
        .where(Document.document_type == DocumentType.nota_credito)
        .where(Document.status == DocumentStatus.issued)
        .where(DocumentItem.sku_snapshot == original_item_sku)
    ).all()
    return sum((r.quantity for r in rows), DEC_ZERO)


def emit_credit_note(session: Session, payload: CreditNoteInput) -> Document:
    """Emite una NC parcial o total sobre un documento existente.

    - El documento padre debe ser issued y de tipo boleta/factura/nota_venta.
    - Cada item devuelto referencia un DocumentItem original. La cantidad a
      devolver no puede exceder la vendida menos lo ya devuelto.
    - Calcula proporcionalmente subtotal, IVA y total. Stock se incrementa
      por las cantidades devueltas.
    - El total de la NC se suma como pago "negativo" implicito: la sesion de
      caja resta su monto.
    """
    if not payload.items:
        raise HTTPException(status_code=400, detail="La nota de credito no tiene items.")
    if not payload.reason or not payload.reason.strip():
        raise HTTPException(status_code=400, detail="El motivo de la NC es obligatorio.")

    original = session.get(Document, payload.original_document_id)
    if original is None:
        raise HTTPException(status_code=404, detail="Documento original no encontrado.")
    if original.status != DocumentStatus.issued:
        raise HTTPException(
            status_code=400,
            detail=f"Solo se puede emitir NC sobre documentos emitidos (estado actual: {original.status.value}).",
        )
    if original.document_type == DocumentType.nota_credito:
        raise HTTPException(
            status_code=400, detail="No se puede emitir una NC sobre otra NC."
        )

    warehouse = session.get(Warehouse, original.warehouse_id) if original.warehouse_id else None
    if warehouse is None:
        raise HTTPException(status_code=400, detail="El documento original no tiene bodega.")

    # Validate and prep each refund line.
    original_items: dict[str, DocumentItem] = {}
    for item in session.exec(
        select(DocumentItem).where(DocumentItem.document_id == original.id)
    ).all():
        original_items[item.id] = item

    nc_lines: list[tuple[DocumentItem, Decimal, Decimal, Decimal, Decimal]] = []
    # (original_item, refund_qty, refund_gross, refund_net, refund_iva)

    additional_total = DEC_ZERO

    for refund in payload.items:
        original_item = original_items.get(refund.original_item_id)
        if original_item is None:
            raise HTTPException(
                status_code=400,
                detail=f"Item original {refund.original_item_id} no pertenece al documento.",
            )
        refund_qty = Decimal(refund.quantity)
        if refund_qty <= 0:
            continue

        already_returned = _already_credited_qty(session, original.id, original_item.sku_snapshot)
        max_return = original_item.quantity - already_returned
        if refund_qty > max_return:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Item {original_item.sku_snapshot or original_item.name_snapshot}: "
                    f"vendido {original_item.quantity}, ya devuelto {already_returned}, "
                    f"intentas devolver {refund_qty}."
                ),
            )

        # Compute proportional gross/net/iva for this refund.
        # Original line: line_total_clp = unit_price * orig_qty - discount
        # We refund proportional to qty share.
        share = refund_qty / original_item.quantity
        refund_gross = original_item.line_total_clp * share
        if original_item.iva_affected:
            refund_net = refund_gross / (Decimal("1") + IVA_RATE)
            refund_iva = refund_gross - refund_net
        else:
            refund_net = refund_gross
            refund_iva = DEC_ZERO

        # Additional taxes (if variant still exists and has tax codes).
        if original_item.variant_id is not None:
            tax_codes = _variant_tax_codes(session, original_item.variant_id)
            for tc in tax_codes:
                additional_total += refund_net * tc.rate

        nc_lines.append((original_item, refund_qty, refund_gross, refund_net, refund_iva))

    if not nc_lines:
        raise HTTPException(status_code=400, detail="No hay cantidades positivas a devolver.")

    subtotal = sum((line[3] for line in nc_lines), DEC_ZERO)
    iva = sum((line[4] for line in nc_lines), DEC_ZERO)
    total = subtotal + iva + additional_total

    # Auto-link to open cash session for the warehouse, like emit_document.
    from app.models import CashSession, CashSessionStatus

    auto_session = session.exec(
        select(CashSession)
        .where(CashSession.warehouse_id == warehouse.id)
        .where(CashSession.status == CashSessionStatus.open)
    ).first()

    nc = Document(
        document_type=DocumentType.nota_credito,
        folio=next_folio(session, DocumentType.nota_credito),
        customer_id=original.customer_id,
        warehouse_id=warehouse.id,
        parent_document_id=original.id,
        status=DocumentStatus.issued,
        subtotal_clp=_round_clp(subtotal),
        iva_clp=_round_clp(iva),
        total_clp=_round_clp(total),
        notes=(payload.reason.strip() + (f"\n{payload.notes.strip()}" if payload.notes else "")),
        cash_session_id=auto_session.id if auto_session else None,
    )
    session.add(nc)
    session.flush()

    for original_item, refund_qty, refund_gross, _, _ in nc_lines:
        session.add(
            DocumentItem(
                document_id=nc.id,
                variant_id=original_item.variant_id,
                sku_snapshot=original_item.sku_snapshot,
                name_snapshot=original_item.name_snapshot,
                quantity=refund_qty,
                unit_price_clp=original_item.unit_price_clp,
                iva_affected=original_item.iva_affected,
                discount_clp=DEC_ZERO,
                line_total_clp=_round_clp(refund_gross),
            )
        )

        # Restore stock for products. Services don't move stock.
        if original_item.variant_id is None:
            continue
        variant = session.get(ProductVariant, original_item.variant_id)
        if variant is None:
            continue
        product = session.get(Product, variant.product_id)
        if product is None or product.product_type.value == "service":
            continue

        level = session.exec(
            select(StockLevel)
            .where(StockLevel.variant_id == variant.id)
            .where(StockLevel.warehouse_id == warehouse.id)
        ).first()
        if level is None:
            level = StockLevel(
                variant_id=variant.id,
                warehouse_id=warehouse.id,
                qty=DEC_ZERO,
            )
            session.add(level)
            session.flush()
        level.qty += refund_qty
        level.updated_at = datetime.now(timezone.utc)
        session.add(level)

        session.add(
            StockMovement(
                variant_id=variant.id,
                warehouse_id=warehouse.id,
                kind=StockMovementKind.entrada,
                quantity=refund_qty,
                qty_after=level.qty,
                reason=f"NC #{nc.folio} {payload.reason.strip()}",
                document_id=nc.id,
            )
        )

    return nc


def cancel_document(session: Session, document: Document) -> None:
    """Reverse stock movements and mark document cancelled. Caller commits."""
    if document.status == DocumentStatus.cancelled:
        raise HTTPException(status_code=400, detail="El documento ya esta anulado.")

    # Find each salida movement belonging to this document and create a
    # compensating entrada. Restore StockLevel and Batch qty.
    movements = session.exec(
        select(StockMovement).where(StockMovement.document_id == document.id)
    ).all()

    for mv in movements:
        if mv.kind != StockMovementKind.salida:
            # we only reverse salidas; entradas (if any) would have been
            # produced by an already-issued cancel — defensive
            continue
        delta = -mv.quantity  # mv.quantity is negative for salida; delta becomes positive
        # Restore StockLevel
        level = session.exec(
            select(StockLevel)
            .where(StockLevel.variant_id == mv.variant_id)
            .where(StockLevel.warehouse_id == mv.warehouse_id)
        ).first()
        if level is None:
            level = StockLevel(
                variant_id=mv.variant_id,
                warehouse_id=mv.warehouse_id,
                qty=DEC_ZERO,
            )
            session.add(level)
            session.flush()
        level.qty += delta
        session.add(level)

        # Restore batch if applicable
        if mv.batch_id:
            batch = session.get(Batch, mv.batch_id)
            if batch is not None:
                batch.qty += delta
                session.add(batch)

        # Compensating movement
        session.add(
            StockMovement(
                variant_id=mv.variant_id,
                warehouse_id=mv.warehouse_id,
                batch_id=mv.batch_id,
                kind=StockMovementKind.entrada,
                quantity=delta,
                qty_after=level.qty,
                reason=f"Anulacion {document.document_type.value} #{document.folio}",
                document_id=document.id,
            )
        )

    document.status = DocumentStatus.cancelled
    session.add(document)
