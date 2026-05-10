"""Products CSV import / export router.

One row per variant: products with multiple variants appear in multiple rows
sharing the same `product_id` / `product_name`.

CSV columns (export and import):
  product_id, product_name, description, category, brand, product_type,
  unit, iva_affected, tracks_batches, product_active,
  variant_id, sku, barcode, display_name, price_clp, cost_clp, stock_min,
  variant_active, attributes

The `attributes` column is encoded as "Name1=Value1;Name2=Value2".

Import behaviour:
  - dry_run=true: validates and returns report without writing
  - existing product matched by `product_id` (round-trip), else by exact
    case-insensitive `product_name`. New products are created if no match.
  - existing variant matched by `variant_id` (round-trip), else by `sku`.
  - SKU must be globally unique; collisions across products fail the row.
"""

from __future__ import annotations

import csv
import io
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import engine
from app.models import (
    Product,
    ProductType,
    ProductUnit,
    ProductVariant,
    VariantAttribute,
)

router = APIRouter()


CSV_COLUMNS = [
    "product_id",
    "product_name",
    "description",
    "category",
    "brand",
    "product_type",
    "unit",
    "iva_affected",
    "tracks_batches",
    "product_active",
    "variant_id",
    "sku",
    "barcode",
    "display_name",
    "price_clp",
    "cost_clp",
    "stock_min",
    "variant_active",
    "attributes",
]


def _encode_attributes(rows: list[VariantAttribute]) -> str:
    return ";".join(f"{r.name}={r.value}" for r in rows)


def _decode_attributes(text: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    if not text:
        return out
    for piece in text.split(";"):
        piece = piece.strip()
        if not piece:
            continue
        if "=" not in piece:
            continue
        name, value = piece.split("=", 1)
        name = name.strip()
        value = value.strip()
        if name and value:
            out.append((name, value))
    return out


def _bool_from_csv(s: str) -> Optional[bool]:
    s = (s or "").strip().lower()
    if s in ("", "-"):
        return None
    return s in ("true", "1", "yes", "si", "sí", "y")


def _bool_to_csv(b: bool) -> str:
    return "true" if b else "false"


# ── Export ────────────────────────────────────────────────────────────────────


@router.get("/export.csv")
def export_csv(
    include_inactive: bool = Query(default=False),
) -> StreamingResponse:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=CSV_COLUMNS)
    writer.writeheader()

    with Session(engine) as session:
        product_stmt = select(Product)
        if not include_inactive:
            product_stmt = product_stmt.where(Product.is_active.is_(True))
        product_stmt = product_stmt.order_by(Product.name.asc())
        products = session.exec(product_stmt).all()
        for p in products:
            variant_stmt = select(ProductVariant).where(
                ProductVariant.product_id == p.id
            )
            if not include_inactive:
                variant_stmt = variant_stmt.where(ProductVariant.is_active.is_(True))
            variant_stmt = variant_stmt.order_by(ProductVariant.created_at.asc())
            variants = session.exec(variant_stmt).all()
            for v in variants:
                attrs = session.exec(
                    select(VariantAttribute)
                    .where(VariantAttribute.variant_id == v.id)
                    .order_by(VariantAttribute.name.asc())
                ).all()
                writer.writerow(
                    {
                        "product_id": p.id,
                        "product_name": p.name,
                        "description": p.description or "",
                        "category": p.category or "",
                        "brand": p.brand or "",
                        "product_type": p.product_type.value,
                        "unit": p.unit.value,
                        "iva_affected": _bool_to_csv(p.iva_affected),
                        "tracks_batches": _bool_to_csv(p.tracks_batches),
                        "product_active": _bool_to_csv(p.is_active),
                        "variant_id": v.id,
                        "sku": v.sku,
                        "barcode": v.barcode or "",
                        "display_name": v.display_name or "",
                        "price_clp": str(v.price_clp),
                        "cost_clp": str(v.cost_clp) if v.cost_clp is not None else "",
                        "stock_min": str(v.stock_min),
                        "variant_active": _bool_to_csv(v.is_active),
                        "attributes": _encode_attributes(attrs),
                    }
                )

    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="vent-os-productos.csv"'},
    )


# ── Import ────────────────────────────────────────────────────────────────────


class ImportRowResult(BaseModel):
    row: int
    sku: Optional[str]
    action: str  # 'created', 'updated', 'skipped', 'error'
    product_name: Optional[str] = None
    message: Optional[str] = None


class ImportReport(BaseModel):
    dry_run: bool
    total_rows: int
    created_products: int
    updated_products: int
    created_variants: int
    updated_variants: int
    errors: int
    rows: list[ImportRowResult]


def _normalize(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _parse_decimal(value: Optional[str], default: Decimal = Decimal("0")) -> Decimal:
    if not value or not value.strip():
        return default
    return Decimal(value.strip())


def _optional_decimal(value: Optional[str]) -> Optional[Decimal]:
    if not value or not value.strip():
        return None
    return Decimal(value.strip())


@router.post("/import.csv", response_model=ImportReport)
def import_csv(
    file: UploadFile = File(...),
    dry_run: bool = Query(default=True),
) -> ImportReport:
    """Import products and variants from a CSV file produced by /export.csv.

    By default runs in dry-run mode (no writes). Set dry_run=false to commit.
    """
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Sube un archivo .csv")

    try:
        text = file.file.read().decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="El archivo debe estar en UTF-8.")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV vacio o sin cabecera.")

    required = {"product_name", "sku", "price_clp"}
    missing = required - set(reader.fieldnames)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Faltan columnas obligatorias: {', '.join(sorted(missing))}",
        )

    results: list[ImportRowResult] = []
    counters = {
        "created_products": 0,
        "updated_products": 0,
        "created_variants": 0,
        "updated_variants": 0,
        "errors": 0,
    }

    with Session(engine) as session:
        for index, raw in enumerate(reader, start=2):  # row 1 is header
            sku = (raw.get("sku") or "").strip()
            try:
                product = _resolve_product(session, raw)
                product_created = product is None or product.id is None
                if product is None:
                    product = Product(
                        name=(raw.get("product_name") or "").strip(),
                    )
                    product_created = True

                _apply_product_fields(product, raw)

                if not product.name:
                    raise ValueError("product_name es obligatorio")
                if not sku:
                    raise ValueError("sku es obligatorio")
                price = _parse_decimal(raw.get("price_clp"))

                if not dry_run:
                    if product_created:
                        session.add(product)
                        session.flush()
                        counters["created_products"] += 1
                    else:
                        counters["updated_products"] += 1
                        session.add(product)

                variant = _resolve_variant(session, raw, product)
                variant_created = variant is None
                if variant is None:
                    variant = ProductVariant(product_id=product.id, sku=sku, price_clp=price)
                _apply_variant_fields(variant, raw, product)

                if not dry_run:
                    if variant_created:
                        session.add(variant)
                        session.flush()
                        counters["created_variants"] += 1
                    else:
                        counters["updated_variants"] += 1
                        session.add(variant)

                    attrs = _decode_attributes(raw.get("attributes") or "")
                    session.exec(
                        VariantAttribute.__table__.delete().where(
                            VariantAttribute.__table__.c.variant_id == variant.id
                        )
                    )
                    for name, value in attrs:
                        session.add(
                            VariantAttribute(
                                variant_id=variant.id, name=name, value=value
                            )
                        )
                else:
                    # in dry run, still count what WOULD happen
                    if variant_created:
                        counters["created_variants"] += 1
                    else:
                        counters["updated_variants"] += 1
                    if product_created:
                        counters["created_products"] += 1
                    else:
                        counters["updated_products"] += 1

                results.append(
                    ImportRowResult(
                        row=index,
                        sku=sku,
                        action="created" if variant_created else "updated",
                        product_name=product.name,
                    )
                )
            except Exception as exc:  # noqa: BLE001
                counters["errors"] += 1
                results.append(
                    ImportRowResult(
                        row=index,
                        sku=sku or None,
                        action="error",
                        message=str(exc),
                    )
                )
                if not dry_run:
                    session.rollback()

        if not dry_run and counters["errors"] == 0:
            session.commit()
        elif not dry_run:
            session.rollback()
            # When errors occurred we rolled back; turn counters into "would have"
            # since nothing was persisted.
            for key in (
                "created_products",
                "updated_products",
                "created_variants",
                "updated_variants",
            ):
                # leave as-is; the dry_run flag in the response signals the state

                pass

    return ImportReport(
        dry_run=dry_run or counters["errors"] > 0,
        total_rows=len(results),
        created_products=counters["created_products"],
        updated_products=counters["updated_products"],
        created_variants=counters["created_variants"],
        updated_variants=counters["updated_variants"],
        errors=counters["errors"],
        rows=results,
    )


def _resolve_product(
    session: Session, raw: dict[str, str]
) -> Optional[Product]:
    """Find an existing Product by id (round-trip) or case-insensitive name."""
    pid = (raw.get("product_id") or "").strip()
    if pid:
        existing = session.get(Product, pid)
        if existing:
            return existing
    name = (raw.get("product_name") or "").strip().lower()
    if not name:
        return None
    from sqlmodel import func

    return session.exec(
        select(Product).where(func.lower(Product.name) == name).limit(1)
    ).first()


def _resolve_variant(
    session: Session, raw: dict[str, str], product: Product
) -> Optional[ProductVariant]:
    vid = (raw.get("variant_id") or "").strip()
    if vid:
        existing = session.get(ProductVariant, vid)
        if existing:
            if existing.product_id != product.id:
                raise ValueError(
                    f"variant_id pertenece a otro producto (esperado {product.id})"
                )
            return existing
    sku = (raw.get("sku") or "").strip()
    if not sku:
        return None
    existing_sku = session.exec(
        select(ProductVariant).where(ProductVariant.sku == sku).limit(1)
    ).first()
    if existing_sku and existing_sku.product_id != product.id:
        raise ValueError(
            f"El SKU '{sku}' ya existe en otro producto"
        )
    return existing_sku


def _apply_product_fields(product: Product, raw: dict[str, str]) -> None:
    product.name = (raw.get("product_name") or "").strip()
    product.description = _normalize(raw.get("description"))
    product.category = _normalize(raw.get("category"))
    product.brand = _normalize(raw.get("brand"))
    pt = (raw.get("product_type") or "").strip().lower()
    if pt:
        try:
            product.product_type = ProductType(pt)
        except ValueError:
            raise ValueError(f"product_type invalido: '{pt}'") from None
    unit = (raw.get("unit") or "").strip().lower()
    if unit:
        try:
            product.unit = ProductUnit(unit)
        except ValueError:
            raise ValueError(f"unit invalida: '{unit}'") from None
    iva = _bool_from_csv(raw.get("iva_affected", ""))
    if iva is not None:
        product.iva_affected = iva
    tb = _bool_from_csv(raw.get("tracks_batches", ""))
    if tb is not None:
        product.tracks_batches = tb
    pa = _bool_from_csv(raw.get("product_active", ""))
    if pa is not None:
        product.is_active = pa


def _apply_variant_fields(
    variant: ProductVariant, raw: dict[str, str], product: Product
) -> None:
    variant.sku = (raw.get("sku") or "").strip()
    variant.barcode = _normalize(raw.get("barcode"))
    variant.display_name = _normalize(raw.get("display_name"))
    variant.price_clp = _parse_decimal(raw.get("price_clp"))
    variant.cost_clp = _optional_decimal(raw.get("cost_clp"))
    variant.stock_min = _parse_decimal(raw.get("stock_min"))
    va = _bool_from_csv(raw.get("variant_active", ""))
    if va is not None:
        variant.is_active = va
    if variant.product_id is None:
        variant.product_id = product.id
