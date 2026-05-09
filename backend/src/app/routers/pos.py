"""Point of sale router (scaffold).

Cart-style flow on top of products + customers, producing a Document.
v0.1.x: not implemented.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/cart")
def get_cart() -> dict:
    return {"items": [], "subtotal_clp": 0, "iva_clp": 0, "total_clp": 0}
