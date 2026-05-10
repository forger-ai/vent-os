"""Product images router.

Stores image files under {app_data}/images/ and serves them at /api/images/{filename}.
Images can be attached either to a product (template, default for all variants)
or to a specific variant. One can be marked primary per scope.

Endpoints:
  GET    /api/images/serve/{filename}                — static file (mounted in main)
  GET    /api/products/{pid}/images                   — list product+variant images
  GET    /api/variants/{vid}/images                   — list only this variant
  POST   /api/products/{pid}/images                   — multipart upload (file)
  POST   /api/variants/{vid}/images                   — multipart upload (file)
  PATCH  /api/images/{id}                             — set is_primary (only one)
  DELETE /api/images/{id}                             — remove file + row
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import engine
from app.models import Product, ProductImage, ProductVariant

router = APIRouter()


# ── Storage layout ────────────────────────────────────────────────────────────


def _images_dir() -> Path:
    """Folder where uploaded images are stored.

    Resolves to {DATABASE_URL parent}/images by default (alongside the SQLite
    file), or to FORGER_IMAGES_DIR if set.
    """
    override = os.getenv("FORGER_IMAGES_DIR")
    if override:
        path = Path(override)
    else:
        from app.database import _DEFAULT_DB_PATH  # type: ignore[attr-defined]

        path = _DEFAULT_DB_PATH.parent / "images"
    path.mkdir(parents=True, exist_ok=True)
    return path


ALLOWED_MIME = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
}
MAX_BYTES = 8 * 1024 * 1024  # 8 MB


# ── Shapes ────────────────────────────────────────────────────────────────────


class ImageRow(BaseModel):
    id: str
    product_id: Optional[str]
    variant_id: Optional[str]
    filename: str
    content_type: Optional[str]
    size_bytes: Optional[int]
    is_primary: bool
    url: str


def _to_row(img: ProductImage) -> ImageRow:
    return ImageRow(
        id=img.id,
        product_id=img.product_id,
        variant_id=img.variant_id,
        filename=img.filename,
        content_type=img.content_type,
        size_bytes=img.size_bytes,
        is_primary=img.is_primary,
        url=f"/api/images/serve/{img.filename}",
    )


def _save_upload(file: UploadFile) -> tuple[str, str, int]:
    """Validate and save the upload. Returns (filename, content_type, size_bytes)."""
    if not file.content_type or file.content_type not in ALLOWED_MIME:
        raise HTTPException(
            status_code=400,
            detail=f"Tipo de archivo no permitido. Usa: {', '.join(sorted(ALLOWED_MIME))}",
        )

    ext = ALLOWED_MIME[file.content_type]
    filename = f"{uuid4().hex}.{ext}"
    target = _images_dir() / filename

    size = 0
    with target.open("wb") as out:
        while True:
            chunk = file.file.read(64 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_BYTES:
                out.close()
                target.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=400,
                    detail=f"Imagen demasiado grande (max {MAX_BYTES // (1024 * 1024)} MB).",
                )
            out.write(chunk)

    return filename, file.content_type, size


def _ensure_primary_unique(
    session: Session,
    product_id: Optional[str],
    variant_id: Optional[str],
    except_image_id: Optional[str] = None,
) -> None:
    """Within the same scope (product OR variant), only one image may be primary."""
    stmt = select(ProductImage).where(ProductImage.is_primary.is_(True))
    if variant_id is not None:
        stmt = stmt.where(ProductImage.variant_id == variant_id)
    elif product_id is not None:
        stmt = stmt.where(ProductImage.product_id == product_id).where(
            ProductImage.variant_id.is_(None)
        )
    if except_image_id:
        stmt = stmt.where(ProductImage.id != except_image_id)
    for other in session.exec(stmt).all():
        other.is_primary = False
        session.add(other)


# ── List ──────────────────────────────────────────────────────────────────────


@router.get("/products/{product_id}/images", response_model=list[ImageRow])
def list_product_images(product_id: str) -> list[ImageRow]:
    with Session(engine) as session:
        product = session.get(Product, product_id)
        if product is None:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        rows = session.exec(
            select(ProductImage)
            .where(
                (ProductImage.product_id == product_id)
                | (
                    ProductImage.variant_id.in_(
                        select(ProductVariant.id).where(
                            ProductVariant.product_id == product_id
                        )
                    )
                )
            )
            .order_by(ProductImage.is_primary.desc(), ProductImage.created_at.asc())
        ).all()
        return [_to_row(r) for r in rows]


@router.get("/variants/{variant_id}/images", response_model=list[ImageRow])
def list_variant_images(variant_id: str) -> list[ImageRow]:
    with Session(engine) as session:
        variant = session.get(ProductVariant, variant_id)
        if variant is None:
            raise HTTPException(status_code=404, detail="Variante no encontrada")
        rows = session.exec(
            select(ProductImage)
            .where(ProductImage.variant_id == variant_id)
            .order_by(ProductImage.is_primary.desc(), ProductImage.created_at.asc())
        ).all()
        return [_to_row(r) for r in rows]


# ── Upload ────────────────────────────────────────────────────────────────────


@router.post(
    "/products/{product_id}/images",
    response_model=ImageRow,
    status_code=201,
)
def upload_product_image(
    product_id: str,
    file: UploadFile = File(...),
    is_primary: bool = False,
) -> ImageRow:
    with Session(engine) as session:
        product = session.get(Product, product_id)
        if product is None:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        filename, content_type, size = _save_upload(file)

        if is_primary:
            _ensure_primary_unique(session, product_id=product_id, variant_id=None)

        img = ProductImage(
            product_id=product_id,
            variant_id=None,
            filename=filename,
            content_type=content_type,
            size_bytes=size,
            is_primary=is_primary,
        )
        session.add(img)
        session.commit()
        session.refresh(img)
        return _to_row(img)


@router.post(
    "/variants/{variant_id}/images",
    response_model=ImageRow,
    status_code=201,
)
def upload_variant_image(
    variant_id: str,
    file: UploadFile = File(...),
    is_primary: bool = False,
) -> ImageRow:
    with Session(engine) as session:
        variant = session.get(ProductVariant, variant_id)
        if variant is None:
            raise HTTPException(status_code=404, detail="Variante no encontrada")
        filename, content_type, size = _save_upload(file)

        if is_primary:
            _ensure_primary_unique(session, product_id=None, variant_id=variant_id)

        img = ProductImage(
            product_id=None,
            variant_id=variant_id,
            filename=filename,
            content_type=content_type,
            size_bytes=size,
            is_primary=is_primary,
        )
        session.add(img)
        session.commit()
        session.refresh(img)
        return _to_row(img)


# ── Set primary / delete ──────────────────────────────────────────────────────


class ImagePatchInput(BaseModel):
    is_primary: bool


@router.patch("/images/{image_id}", response_model=ImageRow)
def set_primary(image_id: str, payload: ImagePatchInput) -> ImageRow:
    with Session(engine) as session:
        img = session.get(ProductImage, image_id)
        if img is None:
            raise HTTPException(status_code=404, detail="Imagen no encontrada")
        if payload.is_primary:
            _ensure_primary_unique(
                session,
                product_id=img.product_id,
                variant_id=img.variant_id,
                except_image_id=img.id,
            )
        img.is_primary = payload.is_primary
        session.add(img)
        session.commit()
        session.refresh(img)
        return _to_row(img)


@router.delete("/images/{image_id}", status_code=204)
def delete_image(image_id: str) -> None:
    with Session(engine) as session:
        img = session.get(ProductImage, image_id)
        if img is None:
            return  # idempotent
        path = _images_dir() / img.filename
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        session.delete(img)
        session.commit()
