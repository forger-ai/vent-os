"""Customers router — full CRUD with Chilean RUT normalization.

Endpoints:
  GET    /api/customers                       — paginated list with search/filter
  GET    /api/customers/{id}                  — detail
  POST   /api/customers                       — create
  PATCH  /api/customers/{id}                  — partial update
  DELETE /api/customers/{id}                  — soft delete (clears email? No — full delete row
                                                 since customers aren't referenced by FK other
                                                 than documents which keep customer_id as snapshot).
                                                 Actually keep is_active soft delete pattern via... we
                                                 don't have is_active on customer. Hard delete is OK
                                                 since Document.customer_id is nullable and won't cascade.
  GET    /api/customers/giros                 — distinct giros for autocomplete
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, func, or_, select

from app.database import engine
from app.models import Customer, CustomerDocumentType, Document

router = APIRouter()


# ── Shapes ────────────────────────────────────────────────────────────────────


class CustomerRow(BaseModel):
    id: str
    rut: Optional[str]
    razon_social: str
    giro: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    address: Optional[str]
    comuna: Optional[str]
    ciudad: Optional[str]
    default_document_type: CustomerDocumentType
    documents_count: int


class CustomerPage(BaseModel):
    items: list[CustomerRow]
    total: int
    limit: int
    offset: int


class CustomerCreate(BaseModel):
    rut: Optional[str] = Field(default=None, max_length=20)
    razon_social: str = Field(min_length=1, max_length=200)
    giro: Optional[str] = Field(default=None, max_length=120)
    email: Optional[str] = Field(default=None, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=40)
    address: Optional[str] = None
    comuna: Optional[str] = Field(default=None, max_length=80)
    ciudad: Optional[str] = Field(default=None, max_length=80)
    default_document_type: CustomerDocumentType = CustomerDocumentType.boleta
    notes: Optional[str] = None


class CustomerUpdate(BaseModel):
    rut: Optional[str] = Field(default=None, max_length=20)
    razon_social: Optional[str] = Field(default=None, min_length=1, max_length=200)
    giro: Optional[str] = Field(default=None, max_length=120)
    email: Optional[str] = Field(default=None, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=40)
    address: Optional[str] = None
    comuna: Optional[str] = Field(default=None, max_length=80)
    ciudad: Optional[str] = Field(default=None, max_length=80)
    default_document_type: Optional[CustomerDocumentType] = None
    notes: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────


def _normalize_optional_str(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def normalize_rut(rut: Optional[str]) -> Optional[str]:
    """Normalize Chilean RUT to format NNNNNNNN-D (no dots, dash before DV,
    DV uppercase)."""
    if rut is None:
        return None
    cleaned = "".join(ch for ch in rut if ch.isalnum()).upper()
    if not cleaned:
        return None
    if len(cleaned) < 2:
        return cleaned
    return f"{cleaned[:-1]}-{cleaned[-1]}"


def _documents_count(session: Session, customer_id: str) -> int:
    raw = session.exec(
        select(func.count()).select_from(Document).where(Document.customer_id == customer_id)
    ).first()
    return raw[0] if isinstance(raw, tuple) else int(raw or 0)


def _to_row(session: Session, customer: Customer) -> CustomerRow:
    return CustomerRow(
        id=customer.id,
        rut=customer.rut,
        razon_social=customer.razon_social,
        giro=customer.giro,
        email=customer.email,
        phone=customer.phone,
        address=customer.address,
        comuna=customer.comuna,
        ciudad=customer.ciudad,
        default_document_type=customer.default_document_type,
        documents_count=_documents_count(session, customer.id),
    )


# ── List ──────────────────────────────────────────────────────────────────────


SortColumn = Literal["razon_social", "rut", "comuna", "ciudad", "updated_at"]
SortOrder = Literal["asc", "desc"]


@router.get("", response_model=CustomerPage)
def list_customers(
    q: Optional[str] = Query(default=None, description="Busca en RUT, razon social, email."),
    default_document_type: Optional[CustomerDocumentType] = None,
    comuna: Optional[str] = None,
    sort: SortColumn = "razon_social",
    order: SortOrder = "asc",
    limit: int = Query(default=25, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> CustomerPage:
    with Session(engine) as session:
        stmt = select(Customer)

        if q:
            like = f"%{q.lower()}%"
            stmt = stmt.where(
                or_(
                    func.lower(Customer.razon_social).like(like),
                    func.lower(Customer.rut).like(like),
                    func.lower(Customer.email).like(like),
                )
            )
        if default_document_type:
            stmt = stmt.where(Customer.default_document_type == default_document_type)
        if comuna:
            stmt = stmt.where(func.lower(Customer.comuna) == comuna.lower())

        sort_map = {
            "razon_social": Customer.razon_social,
            "rut": Customer.rut,
            "comuna": Customer.comuna,
            "ciudad": Customer.ciudad,
            "updated_at": Customer.updated_at,
        }
        sort_col = sort_map[sort]
        stmt = stmt.order_by(sort_col.desc() if order == "desc" else sort_col.asc())

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total_raw = session.exec(count_stmt).one()
        total = total_raw[0] if isinstance(total_raw, tuple) else int(total_raw)

        rows = session.exec(stmt.offset(offset).limit(limit)).all()
        return CustomerPage(
            items=[_to_row(session, c) for c in rows],
            total=int(total),
            limit=limit,
            offset=offset,
        )


@router.get("/giros", response_model=list[str])
def list_giros() -> list[str]:
    with Session(engine) as session:
        rows = session.exec(
            select(Customer.giro)
            .where(Customer.giro.is_not(None))
            .distinct()
            .order_by(Customer.giro.asc())
        ).all()
        return [r for r in rows if r]


@router.get("/{customer_id}", response_model=CustomerRow)
def get_customer(customer_id: str) -> CustomerRow:
    with Session(engine) as session:
        c = session.get(Customer, customer_id)
        if c is None:
            raise HTTPException(status_code=404, detail="Cliente no encontrado")
        return _to_row(session, c)


# ── Create / update / delete ─────────────────────────────────────────────────


@router.post("", response_model=CustomerRow, status_code=201)
def create_customer(payload: CustomerCreate) -> CustomerRow:
    with Session(engine) as session:
        rut = normalize_rut(payload.rut)
        if rut:
            existing = session.exec(select(Customer).where(Customer.rut == rut)).first()
            if existing:
                raise HTTPException(
                    status_code=409, detail=f"Ya existe un cliente con RUT '{rut}'"
                )

        c = Customer(
            rut=rut,
            razon_social=payload.razon_social.strip(),
            giro=_normalize_optional_str(payload.giro),
            email=_normalize_optional_str(payload.email) if payload.email else None,
            phone=_normalize_optional_str(payload.phone),
            address=_normalize_optional_str(payload.address),
            comuna=_normalize_optional_str(payload.comuna),
            ciudad=_normalize_optional_str(payload.ciudad),
            default_document_type=payload.default_document_type,
            notes=_normalize_optional_str(payload.notes),
        )
        session.add(c)
        session.commit()
        session.refresh(c)
        return _to_row(session, c)


@router.patch("/{customer_id}", response_model=CustomerRow)
def update_customer(customer_id: str, payload: CustomerUpdate) -> CustomerRow:
    with Session(engine) as session:
        c = session.get(Customer, customer_id)
        if c is None:
            raise HTTPException(status_code=404, detail="Cliente no encontrado")

        data = payload.model_dump(exclude_unset=True)

        if "rut" in data:
            new_rut = normalize_rut(data["rut"])
            if new_rut and new_rut != c.rut:
                clash = session.exec(
                    select(Customer).where(Customer.rut == new_rut).where(Customer.id != customer_id)
                ).first()
                if clash:
                    raise HTTPException(
                        status_code=409, detail=f"Ya existe otro cliente con RUT '{new_rut}'"
                    )
            data["rut"] = new_rut

        if "razon_social" in data and data["razon_social"] is not None:
            data["razon_social"] = data["razon_social"].strip()
            if not data["razon_social"]:
                raise HTTPException(status_code=400, detail="La razon social es obligatoria.")

        for f in ("giro", "phone", "address", "comuna", "ciudad", "notes"):
            if f in data:
                data[f] = _normalize_optional_str(data[f])

        if "email" in data and data["email"] is not None:
            data["email"] = _normalize_optional_str(data["email"])

        for f, v in data.items():
            setattr(c, f, v)

        c.updated_at = datetime.now(timezone.utc)
        session.add(c)
        session.commit()
        session.refresh(c)
        return _to_row(session, c)


@router.delete("/{customer_id}", status_code=204)
def delete_customer(customer_id: str) -> None:
    """Hard delete a customer. Their documents keep customer_id as snapshot,
    which we set to NULL since the row goes away. SQLite FK with default
    ON DELETE NO ACTION may refuse — we explicitly null first."""
    with Session(engine) as session:
        c = session.get(Customer, customer_id)
        if c is None:
            return  # idempotent

        # Null the FK on any documents pointing to this customer (preserve
        # the documents themselves; razon_social isn't snapshot today but
        # the document existed at the time).
        session.exec(
            Document.__table__.update()
            .where(Document.__table__.c.customer_id == customer_id)
            .values(customer_id=None)
        )
        session.delete(c)
        session.commit()
