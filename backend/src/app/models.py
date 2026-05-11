"""Domain models for Vent OS.

v0.3.0 introduces product variants (Shopify-style attributes), multi-warehouse
inventory, and optional batch/expiry tracking per product. The data model
moves SKU, price, cost, and stock OUT of `Product` and INTO `ProductVariant`
and `StockLevel`.

A `Product` is the parent / template (a "Polera"). One or more `ProductVariant`
rows hang off it ("Polera Negra L", "Polera Roja M"), each with its own SKU,
barcode, prices, and per-warehouse stock. Variants get their attributes as
free-form key/value rows in `VariantAttribute`.

If `Product.tracks_batches` is True, stock for that product's variants is
broken down further into `Batch` rows (lot number + optional expiry). The
sum of batch qty for a (variant, warehouse) tuple should equal the
`StockLevel.qty` for the same tuple — invariant maintained by the router.

This version still does **not** emit electronic documents to the SII.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from enum import Enum
from typing import Optional
from uuid import uuid4

from sqlalchemy import UniqueConstraint
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


class ProductType(str, Enum):
    product = "product"
    service = "service"


class CustomerDocumentType(str, Enum):
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


# ── Catalog: product template ────────────────────────────────────────────────


class Product(SQLModel, table=True):
    """Product template / parent. Holds info shared by all its variants."""

    id: str = Field(default_factory=new_id, primary_key=True)
    name: str
    description: Optional[str] = None
    category: Optional[str] = Field(default=None, index=True)
    brand: Optional[str] = Field(default=None, index=True)
    product_type: ProductType = Field(default=ProductType.product)
    unit: ProductUnit = Field(default=ProductUnit.unit)
    iva_affected: bool = Field(default=True)
    tracks_batches: bool = Field(default=False)
    is_active: bool = Field(default=True)
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class ProductVariant(SQLModel, table=True):
    """A concrete sellable item: SKU, barcode, price, cost, stock_min.

    Each Product has at least one variant. Simple products use a single default
    variant whose attributes are empty.
    """

    id: str = Field(default_factory=new_id, primary_key=True)
    product_id: str = Field(foreign_key="product.id", index=True)
    sku: str = Field(index=True, unique=True)
    barcode: Optional[str] = Field(default=None, index=True)
    display_name: Optional[str] = Field(
        default=None,
        description="Optional override; if null, frontend builds it from product name + attributes.",
    )
    price_clp: Decimal = Field(default=Decimal("0"))
    cost_clp: Optional[Decimal] = None
    stock_min: Decimal = Field(
        default=Decimal("0"),
        description="Low-stock alert threshold (compared against sum of StockLevel.qty across warehouses).",
    )
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class VariantAttribute(SQLModel, table=True):
    """Free-form attribute on a variant (Shopify-style)."""

    __table_args__ = (
        UniqueConstraint("variant_id", "name", name="uq_variant_attribute_name"),
    )

    id: str = Field(default_factory=new_id, primary_key=True)
    variant_id: str = Field(foreign_key="productvariant.id", index=True)
    name: str = Field(description="e.g., 'Talla', 'Color', 'Material'")
    value: str = Field(description="e.g., 'L', 'Negro', 'Algodon'")


class ProductImage(SQLModel, table=True):
    """Image attached to a product (default for all variants) or a specific variant.

    Exactly one of product_id / variant_id must be set. The file lives under
    {data}/images/<filename>; the API serves it at /api/images/<filename>.
    """

    id: str = Field(default_factory=new_id, primary_key=True)
    product_id: Optional[str] = Field(default=None, foreign_key="product.id", index=True)
    variant_id: Optional[str] = Field(default=None, foreign_key="productvariant.id", index=True)
    filename: str = Field(description="Filename relative to {app_data}/images/.")
    content_type: Optional[str] = None
    size_bytes: Optional[int] = None
    is_primary: bool = Field(default=False)
    created_at: datetime = Field(default_factory=utcnow)


# ── Tax codes ─────────────────────────────────────────────────────────────────


class TaxCode(SQLModel, table=True):
    """Additional tax (ILA, Bebidas azucaradas, etc.) applied on top of IVA.

    A variant can have zero or more tax codes via ProductVariantTaxCode.
    The rate is a fraction (e.g., 0.315 for 31.5%).
    """

    id: str = Field(default_factory=new_id, primary_key=True)
    code: str = Field(index=True, unique=True, description="Short identifier: ILA_FUERTE, AZUCARADA_18.")
    name: str
    description: Optional[str] = None
    rate: Decimal = Field(default=Decimal("0"), description="Fraction; 0.18 means 18%.")
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class ProductVariantTaxCode(SQLModel, table=True):
    """M:N join between ProductVariant and TaxCode."""

    __table_args__ = (
        UniqueConstraint(
            "variant_id", "tax_code_id", name="uq_variant_tax_code"
        ),
    )

    id: str = Field(default_factory=new_id, primary_key=True)
    variant_id: str = Field(foreign_key="productvariant.id", index=True)
    tax_code_id: str = Field(foreign_key="taxcode.id", index=True)


# ── Price lists ───────────────────────────────────────────────────────────────


class PriceList(SQLModel, table=True):
    """A named pricing scheme (Minorista, Mayorista, VIP, etc.).

    The default price list resolves to variant.price_clp. Non-default lists
    may have per-variant overrides stored as PriceListEntry rows; when no
    entry exists, the variant base price is the effective price.
    """

    id: str = Field(default_factory=new_id, primary_key=True)
    code: str = Field(index=True, unique=True, description="Short identifier: RETAIL, WHOLESALE.")
    name: str
    description: Optional[str] = None
    is_default: bool = Field(default=False)
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class PriceListEntry(SQLModel, table=True):
    """Per-variant override price within a non-default price list."""

    __table_args__ = (
        UniqueConstraint(
            "price_list_id", "variant_id", name="uq_price_list_variant"
        ),
    )

    id: str = Field(default_factory=new_id, primary_key=True)
    price_list_id: str = Field(foreign_key="pricelist.id", index=True)
    variant_id: str = Field(foreign_key="productvariant.id", index=True)
    price_clp: Decimal = Field(default=Decimal("0"))
    updated_at: datetime = Field(default_factory=utcnow)


# ── Customers ─────────────────────────────────────────────────────────────────


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
    warehouse_id: Optional[str] = Field(default=None, foreign_key="warehouse.id")
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
    variant_id: Optional[str] = Field(default=None, foreign_key="productvariant.id")
    sku_snapshot: Optional[str] = None
    name_snapshot: str
    quantity: Decimal = Field(default=Decimal("1"))
    unit_price_clp: Decimal = Field(default=Decimal("0"))
    iva_affected: bool = Field(default=True)
    discount_clp: Decimal = Field(default=Decimal("0"))
    line_total_clp: Decimal = Field(default=Decimal("0"))


# ── Inventory: warehouses, stock levels, batches ─────────────────────────────


class Warehouse(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    code: str = Field(index=True, unique=True, description="Short code: BP, LC, BD2.")
    name: str
    address: Optional[str] = None
    is_default: bool = Field(default=False)
    is_active: bool = Field(default=True)
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class StockLevel(SQLModel, table=True):
    """Per-(variant, warehouse) on-hand quantity.

    If the product tracks batches, qty must equal the sum of associated Batch.qty
    (router enforces this invariant). Otherwise qty is the direct stock count.
    """

    __table_args__ = (
        UniqueConstraint("variant_id", "warehouse_id", name="uq_stock_variant_warehouse"),
    )

    id: str = Field(default_factory=new_id, primary_key=True)
    variant_id: str = Field(foreign_key="productvariant.id", index=True)
    warehouse_id: str = Field(foreign_key="warehouse.id", index=True)
    qty: Decimal = Field(default=Decimal("0"))
    updated_at: datetime = Field(default_factory=utcnow)


class Batch(SQLModel, table=True):
    """Lot / batch for products with tracks_batches=True.

    Each batch belongs to one (variant, warehouse). Lot number is unique per
    (variant, warehouse, lot_number) — a product can have the same lot
    number stored in different warehouses without collision.
    """

    __table_args__ = (
        UniqueConstraint(
            "variant_id",
            "warehouse_id",
            "lot_number",
            name="uq_batch_variant_warehouse_lot",
        ),
    )

    id: str = Field(default_factory=new_id, primary_key=True)
    variant_id: str = Field(foreign_key="productvariant.id", index=True)
    warehouse_id: str = Field(foreign_key="warehouse.id", index=True)
    lot_number: str
    expiry_date: Optional[date] = Field(default=None, index=True)
    qty: Decimal = Field(default=Decimal("0"))
    received_at: datetime = Field(default_factory=utcnow)
    notes: Optional[str] = None


class StockMovement(SQLModel, table=True):
    """Audit log of every stock change. Append-only.

    Variant + warehouse are required. Batch is optional — set when the
    movement affected a specific batch (which happens automatically for
    products with tracks_batches=True).
    """

    id: str = Field(default_factory=new_id, primary_key=True)
    variant_id: str = Field(foreign_key="productvariant.id", index=True)
    warehouse_id: str = Field(foreign_key="warehouse.id", index=True)
    batch_id: Optional[str] = Field(default=None, foreign_key="batch.id")
    kind: StockMovementKind
    quantity: Decimal = Field(
        description="Signed delta. Positive for entrada and positive ajuste, negative for salida and negative ajuste."
    )
    qty_after: Decimal = Field(
        default=Decimal("0"),
        description="Snapshot of StockLevel.qty AFTER this movement applied.",
    )
    reason: Optional[str] = None
    document_id: Optional[str] = Field(default=None, foreign_key="document.id")
    occurred_at: datetime = Field(default_factory=utcnow)


# ── Cash register ─────────────────────────────────────────────────────────────


class CashSession(SQLModel, table=True):
    """Cash drawer / till session, scoped to a warehouse.

    A session is opened with a starting amount, accumulates sales while open,
    and is closed with an actual counted amount. The expected amount is
    computed from sales emitted during the session; the difference is
    expected - closing (positive = sobrante, negative = faltante).

    At most one open session per warehouse at a time (enforced in router).
    """

    id: str = Field(default_factory=new_id, primary_key=True)
    warehouse_id: Optional[str] = Field(
        default=None, foreign_key="warehouse.id", index=True
    )
    opened_by: Optional[str] = Field(
        default=None, description="Free-text cashier name; no auth yet."
    )
    opened_at: datetime = Field(default_factory=utcnow)
    closed_at: Optional[datetime] = None
    opening_amount_clp: Decimal = Field(default=Decimal("0"))
    closing_amount_clp: Optional[Decimal] = None
    expected_amount_clp: Optional[Decimal] = None
    difference_clp: Optional[Decimal] = None
    status: CashSessionStatus = Field(default=CashSessionStatus.open)
    notes: Optional[str] = None
