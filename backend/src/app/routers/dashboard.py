"""Dashboard / Home KPIs.

Un solo endpoint GET /api/dashboard/summary que computa todo en una request:
  - Ventas hoy / esta semana / este mes (boletas+facturas+nota_venta - NCs)
  - Documentos por tipo del periodo
  - Cotizaciones activas y vencidas
  - Guias sin facturar
  - Productos con stock bajo
  - Lotes vencidos y por vencer (proximos 30 dias)
  - Top productos vendidos del mes
  - Pagos por metodo del mes
  - Sesiones de caja abiertas

Filtro opcional por bodega.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlmodel import Session, func, select

from app.database import engine
from app.models import (
    Batch,
    CashSession,
    CashSessionStatus,
    Document,
    DocumentItem,
    DocumentPayment,
    DocumentStatus,
    DocumentType,
    PaymentMethod,
    Product,
    ProductType,
    ProductVariant,
    StockLevel,
    Warehouse,
)

router = APIRouter()


SALES_TYPES = (
    DocumentType.boleta,
    DocumentType.factura,
    DocumentType.nota_venta,
)


# ── Shapes ────────────────────────────────────────────────────────────────────


class PeriodKpis(BaseModel):
    label: str
    documents_count: int
    sales_total_clp: float
    credits_total_clp: float
    net_total_clp: float


class TopProduct(BaseModel):
    variant_id: str
    sku: str
    name: str
    qty: float
    total_clp: float


class PaymentBreakdownItem(BaseModel):
    payment_method_id: str
    code: str
    name: str
    is_cash: bool
    amount_clp: float


class CashSessionBrief(BaseModel):
    id: str
    warehouse_code: str
    warehouse_name: str
    opening_amount_clp: float
    cash_total_clp: float
    non_cash_total_clp: float
    expected_clp: float
    documents_count: int


class ExpiringBatchBrief(BaseModel):
    id: str
    product_name: str
    variant_sku: str
    warehouse_code: str
    lot_number: str
    expiry_date: str
    qty: float
    days_to_expiry: int


class LowStockBrief(BaseModel):
    variant_id: str
    sku: str
    display_name: str
    product_name: str
    stock_qty: float
    stock_min: float


class DashboardSummary(BaseModel):
    today: PeriodKpis
    this_week: PeriodKpis
    this_month: PeriodKpis
    quotes_active: int
    quotes_expired: int
    guias_unbilled: int
    low_stock: list[LowStockBrief]
    expiring_batches: list[ExpiringBatchBrief]
    expired_batches_count: int
    top_products_this_month: list[TopProduct]
    payments_this_month: list[PaymentBreakdownItem]
    cash_sessions_open: list[CashSessionBrief]


# ── Helpers ───────────────────────────────────────────────────────────────────


def _period(session: Session, label: str, since: date, today: date, warehouse_id: Optional[str]) -> PeriodKpis:
    stmt = (
        select(Document)
        .where(Document.issued_at >= since)
        .where(Document.issued_at <= today)
        .where(Document.status == DocumentStatus.issued)
    )
    if warehouse_id:
        stmt = stmt.where(Document.warehouse_id == warehouse_id)
    docs = session.exec(stmt).all()

    sales = Decimal("0")
    credits = Decimal("0")
    count = 0
    for d in docs:
        if d.document_type in SALES_TYPES:
            sales += d.total_clp
            count += 1
        elif d.document_type == DocumentType.nota_credito:
            credits += d.total_clp
            count += 1

    return PeriodKpis(
        label=label,
        documents_count=count,
        sales_total_clp=float(sales),
        credits_total_clp=float(credits),
        net_total_clp=float(sales - credits),
    )


def _low_stock(session: Session, warehouse_id: Optional[str], limit: int = 12) -> list[LowStockBrief]:
    stmt = (
        select(ProductVariant, Product, func.coalesce(func.sum(StockLevel.qty), 0).label("total_qty"))
        .join(Product, Product.id == ProductVariant.product_id)
        .join(StockLevel, StockLevel.variant_id == ProductVariant.id, isouter=True)
        .where(ProductVariant.is_active.is_(True))
        .where(Product.is_active.is_(True))
        .where(Product.product_type == ProductType.product)
        .group_by(ProductVariant.id, Product.id)
        .having(func.coalesce(func.sum(StockLevel.qty), 0) <= ProductVariant.stock_min)
    )
    if warehouse_id:
        # restrict the per-warehouse stock filter
        stmt = (
            select(ProductVariant, Product, func.coalesce(func.sum(StockLevel.qty), 0).label("total_qty"))
            .join(Product, Product.id == ProductVariant.product_id)
            .join(StockLevel, StockLevel.variant_id == ProductVariant.id, isouter=True)
            .where(ProductVariant.is_active.is_(True))
            .where(Product.is_active.is_(True))
            .where(Product.product_type == ProductType.product)
            .where((StockLevel.warehouse_id == warehouse_id) | (StockLevel.id.is_(None)))
            .group_by(ProductVariant.id, Product.id)
            .having(func.coalesce(func.sum(StockLevel.qty), 0) <= ProductVariant.stock_min)
        )
    stmt = stmt.limit(limit)
    rows = session.exec(stmt).all()
    out: list[LowStockBrief] = []
    for row in rows:
        v, p, total_qty = row
        display = v.display_name or f"{p.name} ({v.sku})"
        out.append(
            LowStockBrief(
                variant_id=v.id,
                sku=v.sku,
                display_name=display,
                product_name=p.name,
                stock_qty=float(total_qty or 0),
                stock_min=float(v.stock_min),
            )
        )
    return out


def _expiring_batches(session: Session, warehouse_id: Optional[str], within_days: int = 30, limit: int = 12) -> tuple[list[ExpiringBatchBrief], int]:
    today = date.today()
    cutoff = today + timedelta(days=within_days)

    stmt = (
        select(Batch, ProductVariant, Product, Warehouse)
        .join(ProductVariant, ProductVariant.id == Batch.variant_id)
        .join(Product, Product.id == ProductVariant.product_id)
        .join(Warehouse, Warehouse.id == Batch.warehouse_id)
        .where(Batch.expiry_date.is_not(None))
        .where(Batch.expiry_date <= cutoff)
        .where(Batch.qty > 0)
    )
    if warehouse_id:
        stmt = stmt.where(Batch.warehouse_id == warehouse_id)
    stmt = stmt.order_by(Batch.expiry_date.asc())

    rows = session.exec(stmt).all()
    items: list[ExpiringBatchBrief] = []
    expired_count = 0
    for b, v, p, w in rows:
        delta = (b.expiry_date - today).days if b.expiry_date else 0
        if delta < 0:
            expired_count += 1
        if len(items) < limit:
            items.append(
                ExpiringBatchBrief(
                    id=b.id,
                    product_name=p.name,
                    variant_sku=v.sku,
                    warehouse_code=w.code,
                    lot_number=b.lot_number,
                    expiry_date=b.expiry_date.isoformat() if b.expiry_date else "",
                    qty=float(b.qty),
                    days_to_expiry=delta,
                )
            )
    return items, expired_count


def _top_products(
    session: Session, since: date, today: date, warehouse_id: Optional[str], limit: int = 8
) -> list[TopProduct]:
    """Top variants by line_total_clp in issued sales docs (not NCs/quotes/guias)."""
    stmt = (
        select(
            DocumentItem.variant_id,
            DocumentItem.sku_snapshot,
            DocumentItem.name_snapshot,
            func.sum(DocumentItem.quantity).label("qty"),
            func.sum(DocumentItem.line_total_clp).label("total"),
        )
        .join(Document, Document.id == DocumentItem.document_id)
        .where(Document.status == DocumentStatus.issued)
        .where(Document.document_type.in_(SALES_TYPES))
        .where(Document.issued_at >= since)
        .where(Document.issued_at <= today)
        .where(DocumentItem.variant_id.is_not(None))
        .group_by(DocumentItem.variant_id, DocumentItem.sku_snapshot, DocumentItem.name_snapshot)
        .order_by(func.sum(DocumentItem.line_total_clp).desc())
        .limit(limit)
    )
    if warehouse_id:
        stmt = stmt.where(Document.warehouse_id == warehouse_id)

    rows = session.exec(stmt).all()
    return [
        TopProduct(
            variant_id=str(r[0]),
            sku=str(r[1] or ""),
            name=str(r[2] or ""),
            qty=float(r[3] or 0),
            total_clp=float(r[4] or 0),
        )
        for r in rows
    ]


def _payments_breakdown(
    session: Session, since: date, today: date, warehouse_id: Optional[str]
) -> list[PaymentBreakdownItem]:
    """Aggregate payments by method for issued sales docs in the period.
    NC payments subtract from the totals."""
    doc_stmt = (
        select(Document.id, Document.document_type)
        .where(Document.status == DocumentStatus.issued)
        .where(Document.issued_at >= since)
        .where(Document.issued_at <= today)
    )
    if warehouse_id:
        doc_stmt = doc_stmt.where(Document.warehouse_id == warehouse_id)
    docs = session.exec(doc_stmt).all()
    sales_ids = [d[0] for d in docs if d[1] in SALES_TYPES]
    nc_ids = [d[0] for d in docs if d[1] == DocumentType.nota_credito]

    breakdown: dict[str, dict] = {}

    def _accumulate(doc_ids: list[str], sign: Decimal) -> None:
        if not doc_ids:
            return
        rows = session.exec(
            select(DocumentPayment, PaymentMethod)
            .join(PaymentMethod, PaymentMethod.id == DocumentPayment.payment_method_id)
            .where(DocumentPayment.document_id.in_(doc_ids))
        ).all()
        for p, pm in rows:
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
            entry["amount"] += p.amount_clp * sign

    _accumulate(sales_ids, Decimal("1"))
    _accumulate(nc_ids, Decimal("-1"))

    items = [
        PaymentBreakdownItem(
            payment_method_id=v["payment_method_id"],
            code=v["code"],
            name=v["name"],
            is_cash=v["is_cash"],
            amount_clp=float(v["amount"]),
        )
        for v in breakdown.values()
    ]
    items.sort(key=lambda b: -b.amount_clp)
    return items


def _cash_sessions_open(
    session: Session, warehouse_id: Optional[str]
) -> list[CashSessionBrief]:
    stmt = select(CashSession, Warehouse).join(
        Warehouse, Warehouse.id == CashSession.warehouse_id, isouter=True
    ).where(CashSession.status == CashSessionStatus.open)
    if warehouse_id:
        stmt = stmt.where(CashSession.warehouse_id == warehouse_id)
    rows = session.exec(stmt).all()

    from app.routers.cash import _session_summary as cash_summary

    out: list[CashSessionBrief] = []
    for cs, wh in rows:
        s = cash_summary(session, cs.id)
        out.append(
            CashSessionBrief(
                id=cs.id,
                warehouse_code=wh.code if wh else "",
                warehouse_name=wh.name if wh else "",
                opening_amount_clp=float(cs.opening_amount_clp),
                cash_total_clp=s.cash_total_clp,
                non_cash_total_clp=s.non_cash_total_clp,
                expected_clp=float(cs.opening_amount_clp) + s.cash_total_clp,
                documents_count=s.documents_count,
            )
        )
    return out


# ── Endpoint ──────────────────────────────────────────────────────────────────


@router.get("/summary", response_model=DashboardSummary)
def dashboard_summary(
    warehouse_id: Optional[str] = Query(default=None),
    expiring_within_days: int = Query(default=30, ge=0, le=365),
) -> DashboardSummary:
    with Session(engine) as session:
        today = date.today()
        # ISO week start (Monday) for "this week" and 1st of month for "this month".
        week_start = today - timedelta(days=today.weekday())
        month_start = today.replace(day=1)

        today_kpi = _period(session, "Hoy", today, today, warehouse_id)
        week_kpi = _period(session, "Esta semana", week_start, today, warehouse_id)
        month_kpi = _period(session, "Este mes", month_start, today, warehouse_id)

        # Quotes active (issued + not converted) vs expired (valid_until past)
        quote_stmt = (
            select(Document)
            .where(Document.document_type == DocumentType.cotizacion)
            .where(Document.status == DocumentStatus.issued)
            .where(Document.converted_to_document_id.is_(None))
        )
        if warehouse_id:
            quote_stmt = quote_stmt.where(Document.warehouse_id == warehouse_id)
        quotes = session.exec(quote_stmt).all()
        quotes_active = sum(
            1 for q in quotes if not q.valid_until or q.valid_until >= today
        )
        quotes_expired = sum(
            1 for q in quotes if q.valid_until and q.valid_until < today
        )

        # Guias unbilled = issued + not converted to invoice
        guia_stmt = (
            select(func.count())
            .select_from(Document)
            .where(Document.document_type == DocumentType.guia_despacho)
            .where(Document.status == DocumentStatus.issued)
            .where(Document.converted_to_document_id.is_(None))
        )
        if warehouse_id:
            guia_stmt = guia_stmt.where(Document.warehouse_id == warehouse_id)
        guia_raw = session.exec(guia_stmt).first()
        guias_unbilled = (
            guia_raw[0] if isinstance(guia_raw, tuple) else int(guia_raw or 0)
        )

        low_stock = _low_stock(session, warehouse_id)
        expiring, expired_count = _expiring_batches(session, warehouse_id, expiring_within_days)
        top_products = _top_products(session, month_start, today, warehouse_id)
        payments_breakdown = _payments_breakdown(session, month_start, today, warehouse_id)
        cash_sessions = _cash_sessions_open(session, warehouse_id)

        return DashboardSummary(
            today=today_kpi,
            this_week=week_kpi,
            this_month=month_kpi,
            quotes_active=quotes_active,
            quotes_expired=quotes_expired,
            guias_unbilled=int(guias_unbilled),
            low_stock=low_stock,
            expiring_batches=expiring,
            expired_batches_count=expired_count,
            top_products_this_month=top_products,
            payments_this_month=payments_breakdown,
            cash_sessions_open=cash_sessions,
        )
