"""Cash register router (scaffold).

Cash sessions: open / close / current. v0.1.x: not implemented.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/sessions")
def list_cash_sessions() -> list[dict]:
    return []


@router.get("/current")
def current_session() -> dict | None:
    return None
