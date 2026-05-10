"""App-specific database migrations for Vent OS.

The shared `commons/backend/database.py` calls SQLModel.metadata.create_all()
which is non-destructive but does NOT add new columns to existing tables.
This module runs idempotent ALTER TABLE statements to bring older installs
forward when the app updates.

Convention (see skeleton `skills/stack-database-extension`):
- never DROP columns
- additive ALTER TABLE only
- safe to re-run; checks existing schema before touching
"""

from __future__ import annotations

from sqlalchemy import text

from app.database import engine


def _existing_columns(table: str) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    return {row[1] for row in rows}


def _add_column_if_missing(table: str, column: str, ddl: str) -> None:
    if column in _existing_columns(table):
        return
    with engine.begin() as conn:
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))


def run_migrations() -> None:
    """Apply additive migrations. Safe to call on every startup."""
    # v0.2.0 — product catalog columns
    _add_column_if_missing("product", "barcode", "VARCHAR")
    _add_column_if_missing("product", "category", "VARCHAR")
    _add_column_if_missing("product", "brand", "VARCHAR")
    _add_column_if_missing(
        "product",
        "product_type",
        "VARCHAR NOT NULL DEFAULT 'product'",
    )
    _add_column_if_missing("product", "cost_clp", "NUMERIC")
