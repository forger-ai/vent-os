"""Domain models for Vent OS.

Scope of v0.1.x is scaffolding only: tables and enums are declared so SQLModel
metadata produces a real schema, but the calculation/validation logic
(folio assignment, IVA totals, stock enforcement, cash close summary) lives
in routers and is not implemented yet.

This version does **not** emit electronic documents to the SII. Sales
documents are recorded locally with an internal folio.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from enum import Enum
from typing import Optional
from uuid import uuid4

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid4())


# ── Enums ─────────────────────────────────────────────────────────────────────


class ProductUnit(str, Enum):
    unit = "unit"
    kg = "kg"
    g = "g"
    l = "l"
    ml = "ml"
    m = "m"
    box = "box"


class CustomerDocumentType(str, Enum):
    """Default document the customer expects."""

    boleta = "boleta"
    factura = "factura"


class DocumentType(str, Enum):
    boleta = "boleta"
    factura = "factura"
    nota_venta = "nota_venta"


class DocumentStatus(str, Enum):
    draft = "draft"
    issued = "issued"
    cancelled = "cancelled"


class StockMovementKind(str, Enum):
    entrada = "entrada"
    salida = "salida"
    ajuste = "ajuste"


class CashSessionStatus(str, Enum):
    open = "open"
    closed = "closed"


# ── Catalog ───────────────────────────────────────────────────────────────────


class Product(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    sku: str = Field(index=True, unique=True)
    name: str
    description: Optional[str] = None
    unit: ProductUnit = Field(default=ProductUnit.unit)
    price_clp: Decimal = Field(default=Decimal("0"))
    iva_affected: bool = Field(default=True)
    stock_qty: Decimal = Field(default=Decimal("0"))
    stock_min: Decimal = Field(default=Decimal("0"))
    is_active: bool = Field(default=True)
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Customer(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    rut: Optional[str] = Field(default=None, index=True)
    razon_social: str
    giro: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    comuna: Optional[str] = None
    ciudad: Optional[str] = None
    default_document_type: CustomerDocumentType = Field(
        default=CustomerDocumentType.boleta
    )
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


# ── Sales documents ───────────────────────────────────────────────────────────


class Document(SQLModel, table=True):
    """Local sales document — boleta, factura, or nota de venta.

    Internal folio (no SII CAF) unique per document_type. Totals stored as
    denormalized snapshots; line-item source of truth is DocumentItem.
    """

    id: str = Field(default_factory=new_id, primary_key=True)
    document_type: DocumentType
    folio: int = Field(index=True)
    issued_at: date = Field(default_factory=lambda: datetime.now(timezone.utc).date())
    customer_id: Optional[str] = Field(default=None, foreign_key="customer.id")
    status: DocumentStatus = Field(default=DocumentStatus.draft)
    subtotal_clp: Decimal = Field(default=Decimal("0"))
    iva_clp: Decimal = Field(default=Decimal("0"))
    total_clp: Decimal = Field(default=Decimal("0"))
    notes: Optional[str] = None
    cash_session_id: Optional[str] = Field(default=None, foreign_key="cashsession.id")
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class DocumentItem(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    document_id: str = Field(foreign_key="document.id", index=True)
    product_id: Optional[str] = Field(default=None, foreign_key="product.id")
    sku_snapshot: Optional[str] = None
    name_snapshot: str
    quantity: Decimal = Field(default=Decimal("1"))
    unit_price_clp: Decimal = Field(default=Decimal("0"))
    iva_affected: bool = Field(default=True)
    discount_clp: Decimal = Field(default=Decimal("0"))
    line_total_clp: Decimal = Field(default=Decimal("0"))


# ── Inventory ─────────────────────────────────────────────────────────────────


class StockMovement(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    product_id: str = Field(foreign_key="product.id", index=True)
    kind: StockMovementKind
    quantity: Decimal
    reason: Optional[str] = None
    document_id: Optional[str] = Field(default=None, foreign_key="document.id")
    occurred_at: datetime = Field(default_factory=utcnow)


# ── Cash register ─────────────────────────────────────────────────────────────


class CashSession(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    opened_at: datetime = Field(default_factory=utcnow)
    closed_at: Optional[datetime] = None
    opening_amount_clp: Decimal = Field(default=Decimal("0"))
    closing_amount_clp: Optional[Decimal] = None
    expected_amount_clp: Optional[Decimal] = None
    difference_clp: Optional[Decimal] = None
    status: CashSessionStatus = Field(default=CashSessionStatus.open)
    notes: Optional[str] = None
