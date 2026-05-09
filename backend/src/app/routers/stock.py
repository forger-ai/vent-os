"""Inventory router (scaffold).

Stock movements (entrada / salida / ajuste). v0.1.x: not implemented.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/movements")
def list_stock_movements() -> list[dict]:
    return []
