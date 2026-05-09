"""Sales documents router (scaffold).

Boletas, facturas, and notas de venta with internal folio. v0.1.x does not
emit DTE to the SII — folio is local-only.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("")
def list_documents() -> list[dict]:
    return []
