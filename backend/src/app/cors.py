"""CORS helper shared across all vite-fastapi-sqlite apps."""

from __future__ import annotations

import os


def allowed_origins() -> list[str]:
    """Read CORS_ORIGINS from env, fall back to Vite dev server defaults.

    The fallback covers both the stack default (5173) and the vent-os port
    (5182) so local `uv run uvicorn` outside Docker / Forger Desktop works
    without manual env setup.
    """
    raw = os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5182,http://127.0.0.1:5182",
    )
    return [origin.strip() for origin in raw.split(",") if origin.strip()]
