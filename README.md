# vent-os

Local-first POS, sales, and inventory app for Chilean SMBs (Pymes), built on the `vite-fastapi-sqlite` stack.

Vent OS replaces the spreadsheet-and-paper sales workflow for a small retail Pyme with a private, local app. All data lives in a SQLite file on the user's machine. Sales documents (boleta, factura, nota de venta) are recorded with an internal folio; **this version does not emit electronic documents to the SII**.

## Committed MVP Scope

Vent OS v0.1.x targets six capabilities:

1. **Product catalog** — products with SKU, name, price, unit, IVA flag, and current stock.
2. **Customer registry** — customers with RUT, razon social, giro, address, and default document type.
3. **Point of sale** — cart with product lookup, IVA calculation, and customer selection.
4. **Sales documents** — local registry of boletas, facturas, and notas de venta with internal folio.
5. **Inventory tracking** — stock movements (entrada / salida / ajuste) with reason and optional document link.
6. **Cash register** — daily cash sessions with open / close and shift sales summary.

The current state is the scaffolding: domain models, REST endpoints (empty), and a six-tab frontend shell. POS calculation logic, document folio generation, and stock movement enforcement are pending.

## Non-Goals

To keep Vent OS focused, these are explicitly out of scope:

- electronic emission to SII (digital signature, CAF folios, DTE submission)
- libro de ventas / RCV export
- banking reconciliation, payment gateways
- promotions, loyalty programs, gift cards
- multi-branch (sucursales)
- multi-user, employee shifts, authentication
- multi-currency or multi-warehouse

When any of these is reconsidered, document it in `AGENTS.md` before adding code.

## Stack Common Dependency

Vent OS uses the shared stack contract, like the rest of `vite-fastapi-sqlite` apps.

- Required submodule: `commons/`
- Expected remote: `git@github.com:forger-ai/vite-fastapi-sqlite-commons.git`
- Docker mounts the shared helpers over local fallbacks:
  - `backend/src/app/database.py`
  - `backend/src/app/health.py`
  - `backend/src/app/cors.py`
  - `frontend/src/api/client.ts`

## Structure

```text
vent-os/
├── manifest.json
├── AGENTS.md
├── docker-compose.yml
├── commons/                          # submodule: shared stack contract
├── backend/
│   ├── pyproject.toml
│   ├── data/                         # local SQLite (gitignored)
│   └── src/app/
│       ├── main.py
│       ├── models.py                 # Product, Customer, Document, DocumentItem, StockMovement, CashSession
│       ├── database.py               # local fallback, overridden in Docker
│       ├── health.py                 # local fallback, overridden in Docker
│       ├── cors.py                   # local fallback, overridden in Docker
│       └── routers/
│           ├── products.py
│           ├── customers.py
│           ├── documents.py
│           ├── pos.py
│           ├── stock.py
│           └── cash.py
├── frontend/
│   ├── package.json
│   └── src/
│       ├── App.tsx                   # six-tab shell
│       ├── theme.ts
│       ├── api/client.ts             # local fallback, overridden in Docker
│       └── pages/
│           ├── ProductosPage.tsx
│           ├── ClientesPage.tsx
│           ├── PosPage.tsx
│           ├── DocumentosPage.tsx
│           ├── InventarioPage.tsx
│           └── CajaPage.tsx
└── scripts/
    └── package_app.sh
```

## Correct Clone

Always clone with submodules:

```bash
git clone --recurse-submodules git@github.com:forger-ai/vent-os.git
```

If you already cloned without submodules:

```bash
git submodule update --init --recursive
```

## Recommended Development (Docker + commons)

```bash
docker compose up --build
```

Services:

- Backend: `http://localhost:8000`
- Frontend: `http://localhost:5182`
- Health: `GET http://localhost:8000/api/health`

## Local Development without Docker (fallback)

```bash
cd backend
uv sync
uv run fastapi dev src/app/main.py
```

```bash
cd frontend
npm install
npm run dev
```

## Update the Stack Common

```bash
git submodule update --remote commons
git add commons
git commit -m "chore: bump commons"
```
