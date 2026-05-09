"""Products router (scaffold).

v0.1.x: list/create/update/delete are not implemented. Returns empty list so
the frontend can render its empty state.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("")
def list_products() -> list[dict]:
    return []
