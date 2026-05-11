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
        fulfill_line(session, line, warehouse, document)

    # Persist payments. If none provided, default to the cash method for the
    # entire total (backward-compatible).
    payments = list(payload.payments) if payload.payments else []
    if not payments:
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

    # Allow at most $1 rounding tolerance.
    if abs(total_paid - totals.total_clp) > Decimal("1"):
        raise HTTPException(
            status_code=400,
            detail=f"La suma de pagos ({total_paid}) no cuadra con el total del documento ({totals.total_clp}).",
        )

    return document


# ── Cancel ────────────────────────────────────────────────────────────────────


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
