from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.cors import allowed_origins
from app.database import init_db
from app.health import router as health_router
from app.routers.batches import router as batches_router
from app.routers.cash import router as cash_router
from app.routers.customers import router as customers_router
from app.routers.documents import router as documents_router
from app.routers.images import _images_dir
from app.routers.images import router as images_router
from app.routers.payment_methods import router as payment_methods_router
from app.routers.pos import router as pos_router
from app.routers.price_lists import router as price_lists_router
from app.routers.products import router as products_router
from app.routers.products_csv import router as products_csv_router
from app.routers.quotes import router as quotes_router
from app.routers.stock import router as stock_router
from app.routers.tax_codes import router as tax_codes_router
from app.routers.variants import router as variants_router
from app.routers.warehouses import router as warehouses_router

app = FastAPI(
    title="Vent OS API",
    version="0.12.0",
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
# CSV routes must register BEFORE the products router so their explicit paths
# (/api/products/export.csv, /api/products/import.csv) win over the
# /{product_id} catch-all.
app.include_router(products_csv_router, prefix="/api/products", tags=["products-csv"])
app.include_router(products_router, prefix="/api/products", tags=["products"])
app.include_router(variants_router, prefix="/api", tags=["variants"])
app.include_router(warehouses_router, prefix="/api/warehouses", tags=["warehouses"])
app.include_router(stock_router, prefix="/api/stock", tags=["stock"])
app.include_router(batches_router, prefix="/api", tags=["batches"])
app.include_router(tax_codes_router, prefix="/api/tax-codes", tags=["tax-codes"])
app.include_router(price_lists_router, prefix="/api/price-lists", tags=["price-lists"])
app.include_router(payment_methods_router, prefix="/api/payment-methods", tags=["payment-methods"])
app.include_router(images_router, prefix="/api", tags=["images"])
app.mount(
    "/api/images/serve",
    StaticFiles(directory=str(_images_dir())),
    name="images-static",
)
app.include_router(customers_router, prefix="/api/customers", tags=["customers"])
app.include_router(documents_router, prefix="/api/documents", tags=["documents"])
app.include_router(quotes_router, prefix="/api/quotes", tags=["quotes"])
app.include_router(pos_router, prefix="/api/pos", tags=["pos"])
app.include_router(cash_router, prefix="/api/cash", tags=["cash"])


@app.on_event("startup")
def on_startup() -> None:
    from app import models as _models  # noqa: F401  — register SQLModel metadata
    from app.database_ext import (
        run_post_create_migrations,
        run_pre_create_migrations,
    )

    context = run_pre_create_migrations()
    init_db()  # SQLModel.metadata.create_all — adds new tables introduced in v0.3
    run_post_create_migrations(context)
