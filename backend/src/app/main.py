from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.cors import allowed_origins
from app.database import init_db
from app.health import router as health_router
from app.routers.cash import router as cash_router
from app.routers.customers import router as customers_router
from app.routers.documents import router as documents_router
from app.routers.pos import router as pos_router
from app.routers.products import router as products_router
from app.routers.stock import router as stock_router

app = FastAPI(
    title="Vent OS API",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router, prefix="/api")
app.include_router(products_router, prefix="/api/products", tags=["products"])
app.include_router(customers_router, prefix="/api/customers", tags=["customers"])
app.include_router(documents_router, prefix="/api/documents", tags=["documents"])
app.include_router(pos_router, prefix="/api/pos", tags=["pos"])
app.include_router(stock_router, prefix="/api/stock", tags=["stock"])
app.include_router(cash_router, prefix="/api/cash", tags=["cash"])


@app.on_event("startup")
def on_startup() -> None:
    from app import models as _models  # noqa: F401

    init_db()
