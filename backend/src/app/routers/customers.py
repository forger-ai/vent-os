"""Customers router (scaffold).

v0.1.x: CRUD not implemented yet.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("")
def list_customers() -> list[dict]:
    return []
