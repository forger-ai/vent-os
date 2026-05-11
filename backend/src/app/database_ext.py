"""App-specific database migrations for Vent OS.

The shared `commons/backend/database.py` calls SQLModel.metadata.create_all()
which is non-destructive but does NOT add new columns to existing tables.
This module runs at startup in two phases:

  1. `run_pre_create_migrations()` — drops legacy columns / tables that
     conflict with the new schema, BEFORE create_all runs. Returns a
     migration context with rescued legacy data (e.g. v0.2 product rows
     before stock_qty is dropped).

  2. `run_post_create_migrations(context)` — runs AFTER create_all has
     created the new tables. Inserts defaults (a primary warehouse) and
     backfills new tables from the context (legacy products -> variants
     + stock_levels).

Convention:
  - additive ALTER TABLE ADD COLUMN is safe and idempotent
  - DROP COLUMN is only used when we have already rescued the data we need
  - DROP TABLE is only used when the table is known to be empty (scaffolding)
  - safe to re-run on every startup; checks existing schema before touching
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import text

from app.database import engine

logger = logging.getLogger(__name__)


# ── Schema introspection ──────────────────────────────────────────────────────


def _table_exists(table: str) -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name=:n"),
            {"n": table},
        ).first()
    return row is not None


def _table_columns(table: str) -> set[str]:
    if not _table_exists(table):
        return set()
    with engine.connect() as conn:
        rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    return {row[1] for row in rows}


def _table_row_count(table: str) -> int:
    if not _table_exists(table):
        return 0
    with engine.connect() as conn:
        row = conn.execute(text(f"SELECT COUNT(*) FROM {table}")).first()
    return int(row[0]) if row else 0


def _exec(sql: str) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql))


def _add_column_if_missing(table: str, column: str, ddl: str) -> None:
    if not _table_exists(table):
        return
    if column in _table_columns(table):
        return
    _exec(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


def _indexes_on_column(table: str, column: str) -> list[str]:
    """Return index names that reference `column` on `table`.

    SQLite's DROP COLUMN refuses to run while an index references the column,
    so callers should drop these indexes first.
    """
    if not _table_exists(table):
        return []
    with engine.connect() as conn:
        idx_rows = conn.execute(
            text(f"PRAGMA index_list({table})")
        ).fetchall()
        names: list[str] = []
        for idx in idx_rows:
            idx_name = idx[1]
            idx_cols = conn.execute(
                text(f"PRAGMA index_info({idx_name})")
            ).fetchall()
            if any(col[2] == column for col in idx_cols):
                names.append(idx_name)
    return names


def _drop_column_if_present(table: str, column: str) -> None:
    """SQLite 3.35+ supports DROP COLUMN. Skip silently if column absent."""
    if not _table_exists(table):
        return
    if column not in _table_columns(table):
        return
    for idx_name in _indexes_on_column(table, column):
        _exec(f"DROP INDEX IF EXISTS {idx_name}")
    _exec(f"ALTER TABLE {table} DROP COLUMN {column}")


# ── Migration context (passed between pre and post phases) ────────────────────


@dataclass
class LegacyProductRow:
    """v0.2.0 shape of `product`. Used to backfill variants + stock levels."""

    id: str
    sku: str
    barcode: Optional[str]
    name: str
    price_clp: Decimal
    cost_clp: Optional[Decimal]
    stock_qty: Decimal
    stock_min: Decimal


@dataclass
class MigrationContext:
    legacy_products: list[LegacyProductRow] = field(default_factory=list)


# ── Pre-create migrations ─────────────────────────────────────────────────────


def _rescue_legacy_products() -> list[LegacyProductRow]:
    """If `product` has v0.2 columns (sku, stock_qty, price_clp), copy them out
    before they are dropped."""
    cols = _table_columns("product")
    legacy_cols = {"sku", "price_clp", "stock_qty", "stock_min"}
    if not legacy_cols.issubset(cols):
        return []

    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT id, sku, barcode, name, price_clp, cost_clp, "
                "stock_qty, stock_min FROM product"
            )
        ).mappings().all()

    rescued: list[LegacyProductRow] = []
    for row in rows:
        rescued.append(
            LegacyProductRow(
                id=str(row["id"]),
                sku=str(row["sku"]),
                barcode=row["barcode"],
                name=str(row["name"]),
                price_clp=Decimal(str(row["price_clp"] or 0)),
                cost_clp=Decimal(str(row["cost_clp"])) if row["cost_clp"] is not None else None,
                stock_qty=Decimal(str(row["stock_qty"] or 0)),
                stock_min=Decimal(str(row["stock_min"] or 0)),
            )
        )
    return rescued


def _drop_legacy_product_columns() -> None:
    """Remove v0.2 columns from `product` that now live on ProductVariant."""
    for column in ("sku", "barcode", "price_clp", "cost_clp", "stock_qty", "stock_min"):
        _drop_column_if_present("product", column)


def _drop_legacy_dependent_tables() -> None:
    """Drop tables that referenced the old product_id schema.

    Both documentitem and stockmovement are scaffolding in v0.2 (empty). After
    create_all runs they will be recreated with the new schema (variant_id,
    warehouse_id, etc.).
    """
    for table in ("documentitem", "stockmovement"):
        if _table_exists(table) and _table_row_count(table) == 0:
            _exec(f"DROP TABLE {table}")
        elif _table_exists(table):
            # The table has rows. Don't blow them away.
            logger.warning(
                "vent-os migration: %s has %d rows; leaving in place. New "
                "columns will be added but the schema may be inconsistent.",
                table,
                _table_row_count(table),
            )


def run_pre_create_migrations() -> MigrationContext:
    context = MigrationContext()

    if _table_exists("product"):
        context.legacy_products = _rescue_legacy_products()
        if context.legacy_products:
            logger.info(
                "vent-os migration: rescued %d legacy product rows for backfill",
                len(context.legacy_products),
            )
        _drop_legacy_dependent_tables()
        _drop_legacy_product_columns()

    # Additive: introduce tracks_batches on product if it's missing (e.g. a
    # fresh v0.2 install upgrading to v0.3 keeps the product table).
    _add_column_if_missing(
        "product",
        "tracks_batches",
        "BOOLEAN NOT NULL DEFAULT 0",
    )

    # v0.8: cash session gains warehouse + cashier name
    _add_column_if_missing("cashsession", "warehouse_id", "VARCHAR")
    _add_column_if_missing("cashsession", "opened_by", "VARCHAR")

    # v0.10: nota de credito references its parent document
    _add_column_if_missing("document", "parent_document_id", "VARCHAR")

    # v0.11: quotes (cotizaciones) — valid_until + conversion link
    _add_column_if_missing("document", "valid_until", "DATE")
    _add_column_if_missing("document", "converted_to_document_id", "VARCHAR")

    # v0.12: guia de despacho — campos opcionales de envio
    _add_column_if_missing("document", "shipping_address", "VARCHAR")
    _add_column_if_missing("document", "shipping_notes", "VARCHAR")
    _add_column_if_missing("document", "carrier_name", "VARCHAR")

    # v0.14: cuentas por cobrar — fecha de vencimiento del pago
    _add_column_if_missing("document", "due_date", "DATE")

    return context


# ── Post-create migrations ────────────────────────────────────────────────────


def _ensure_default_warehouse() -> str:
    """Insert a default warehouse if no warehouses exist. Returns its id."""
    with engine.connect() as conn:
        existing = conn.execute(text("SELECT id FROM warehouse LIMIT 1")).first()
    if existing:
        return str(existing[0])

    from uuid import uuid4

    wh_id = str(uuid4())
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO warehouse (id, code, name, is_default, is_active, "
                "created_at, updated_at) VALUES (:id, :code, :name, 1, 1, "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": wh_id, "code": "BP", "name": "Bodega principal"},
        )
    logger.info("vent-os migration: created default warehouse %s", wh_id)
    return wh_id


def _backfill_variants_from_legacy(
    legacy: list[LegacyProductRow], default_warehouse_id: str
) -> None:
    if not legacy:
        return

    from uuid import uuid4

    with engine.begin() as conn:
        for row in legacy:
            # Skip if this product already has a variant (re-run safety).
            existing = conn.execute(
                text("SELECT id FROM productvariant WHERE product_id=:pid LIMIT 1"),
                {"pid": row.id},
            ).first()
            if existing:
                continue

            variant_id = str(uuid4())
            conn.execute(
                text(
                    "INSERT INTO productvariant (id, product_id, sku, barcode, "
                    "display_name, price_clp, cost_clp, stock_min, is_active, "
                    "created_at, updated_at) VALUES (:id, :pid, :sku, :barcode, "
                    "NULL, :price, :cost, :stock_min, 1, CURRENT_TIMESTAMP, "
                    "CURRENT_TIMESTAMP)"
                ),
                {
                    "id": variant_id,
                    "pid": row.id,
                    "sku": row.sku,
                    "barcode": row.barcode,
                    "price": str(row.price_clp),
                    "cost": str(row.cost_clp) if row.cost_clp is not None else None,
                    "stock_min": str(row.stock_min),
                },
            )
            conn.execute(
                text(
                    "INSERT INTO stocklevel (id, variant_id, warehouse_id, qty, "
                    "updated_at) VALUES (:id, :vid, :wid, :qty, CURRENT_TIMESTAMP)"
                ),
                {
                    "id": str(uuid4()),
                    "vid": variant_id,
                    "wid": default_warehouse_id,
                    "qty": str(row.stock_qty),
                },
            )
    logger.info(
        "vent-os migration: backfilled %d variants + stock levels", len(legacy)
    )


def _ensure_default_price_list() -> str:
    """Insert a default PriceList if no rows exist. Returns its id."""
    with engine.connect() as conn:
        existing = conn.execute(text("SELECT id FROM pricelist LIMIT 1")).first()
    if existing:
        return str(existing[0])

    from uuid import uuid4

    pl_id = str(uuid4())
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO pricelist (id, code, name, is_default, is_active, "
                "created_at, updated_at) VALUES (:id, :code, :name, 1, 1, "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": pl_id, "code": "RETAIL", "name": "Lista minorista"},
        )
    logger.info("vent-os migration: created default price list %s", pl_id)
    return pl_id


def _ensure_default_payment_methods() -> None:
    """Seed the standard payment methods (only if table is empty)."""
    from uuid import uuid4

    with engine.connect() as conn:
        existing = conn.execute(text("SELECT id FROM paymentmethod LIMIT 1")).first()
    if existing:
        return

    defaults = [
        ("EFECTIVO", "Efectivo", True, 10),
        ("DEBITO", "Tarjeta de debito", False, 20),
        ("CREDITO", "Tarjeta de credito", False, 30),
        ("TRANSFERENCIA", "Transferencia bancaria", False, 40),
        ("OTRO", "Otro medio", False, 90),
    ]
    with engine.begin() as conn:
        for code, name, is_cash, sort_order in defaults:
            conn.execute(
                text(
                    "INSERT INTO paymentmethod (id, code, name, is_cash, is_active, "
                    "sort_order, created_at, updated_at) VALUES (:id, :code, :name, "
                    ":is_cash, 1, :sort_order, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {
                    "id": str(uuid4()),
                    "code": code,
                    "name": name,
                    "is_cash": 1 if is_cash else 0,
                    "sort_order": sort_order,
                },
            )
    logger.info("vent-os migration: seeded %d default payment methods", len(defaults))


def run_post_create_migrations(context: MigrationContext) -> None:
    default_wh = _ensure_default_warehouse()
    _backfill_variants_from_legacy(context.legacy_products, default_wh)
    _ensure_default_price_list()
    _ensure_default_payment_methods()
