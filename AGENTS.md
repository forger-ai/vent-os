# AGENTS

## Source of Truth

This file is the main functional and operational context source for this app.

If `manifest.json` exists, use it for installation, service, and script metadata. Do not use it as the list of user-visible capabilities.

The agent must always distinguish between:

- user-visible capabilities
- internal agent tools

Key rule: internal tools can be used to execute tasks, but they must not be presented as the user interface or as steps the user must run manually.

## Product Identity

- id: `vent-os`
- recommended visible name: `Vent OS`
- type: local-first POS, sales, and inventory app for Chilean SMBs (Pymes)
- status: catalog + inventory funcional (productos con variantes, multi-bodega, lotes y vencimientos). El resto (clientes, POS, documentos, caja) sigue como scaffolding

## Functional Goal

Vent OS replaces the spreadsheet-and-paper sales workflow for a small retail Pyme with a private, local app:

- product catalog with stock
- customer registry
- point of sale (POS) on the counter
- local registry of boletas, facturas, and notas de venta with internal folio
- inventory movements with reason and optional document link
- daily cash session with open and close

All data lives on the user's machine. **This version does not emit electronic documents to the SII.**

## Target User

### Primary User

- owner-operator of a small Pyme (1–20 people) doing retail sales
- a clerk who needs a fast counter checkout, prints (or shows) a sales document, and tracks what was sold today

### Final User

- non-technical operator: thinks in "vendi 3 unidades", "abrir caja", "que clientes me deben", not in databases

## Real Functional Scope

### What It Does Today (v0.3.x)

- starts a frontend and backend locally
- responds to `GET /api/health`
- shows a six-tab shell: Productos, Clientes, POS, Documentos, Inventario, Caja
- **Productos: funcional con variantes y atributos**. Cada producto es un "template" que tiene una o varias variantes (talla, color, etc.) con su propio SKU, precio y stock. Atributos libres tipo Shopify. Crear, editar, buscar (SKU/nombre/codigo de barras), filtrar (categoria, marca, tipo, activos, stock bajo), desactivar producto o variante. Producto soporta `product` o `service` (servicios no manejan stock).
- **Inventario: funcional con multi-bodega y lotes**. Sub-tabs: Stock (vista y ajustes), Movimientos (historial), Bodegas (CRUD), Lotes (lotes con vencimientos y vista de proximos a vencer). Stock se trackea por (variante, bodega), opcionalmente por lote si el producto tiene `tracks_batches=True`.
- Clientes, POS, Documentos y Caja: scaffolding (modelos declarados, endpoints devuelven listas vacias, UI muestra Alerts informativos)

### What It Does Not Do Today

- no SII electronic emission (digital signature, CAF folios, DTE submission, libro de ventas)
- no banking reconciliation, payment gateways, or POS integrated with terminals
- no promotions, loyalty, gift cards
- no multi-branch (sucursales) or multi-warehouse
- no multi-user or authentication
- no automatic cost-based stock valuation (FIFO, LIFO, average cost)
- no purchase orders / suppliers module

The agent must not invent capabilities outside this scope. When the user asks about "boletas electronicas al SII", explain clearly that this version is **local registry only** and that SII emission is on the roadmap but not implemented.

## User-Visible Capabilities

These are the actions you can present as real to the final user — at the **scaffolding** level (the UI exists, business logic is pending).

### 1. Product Catalog with variants (v0.3.0+)

The user can ask:

- "que productos tengo cargados?"
- "agrega el producto X con precio Y"
- "cual es el stock de X en la bodega Y?"
- "cuales productos estan en stock bajo?"
- "agrega una variante talla L color rojo al producto Z"
- "desactiva el producto X" o "desactiva esta variante"

What works today:

- crear, editar y desactivar productos (template) desde la UI; al crear se exige al menos una variante
- agregar/editar/desactivar variantes dentro del detalle del producto, con atributos libres (Talla, Color, Material, etc.)
- buscar por SKU, nombre o codigo de barras (busca a nivel producto y variantes)
- filtrar por categoria, marca, tipo (producto/servicio), activos o stock bajo
- listado pagina del lado del servidor con orden configurable

The agent debe distinguir entre **producto** (maneja stock) y **servicio** (no maneja stock). Tambien debe distinguir entre **producto template** (cabecera) y **variante** (item vendible). El SKU vive en la variante, no en el producto.

Desactivar producto es soft delete y cascadea a sus variantes. Desactivar una variante deja las demas activas.

### 2. Multi-warehouse stock (v0.3.0+)

The user can ask:

- "cuanto stock tengo de X en la bodega Y?"
- "transfiere 5 unidades de la bodega central al local centro" (en v0.3 se hace via dos ajustes: salida en una + entrada en la otra)
- "registra entrada de 20 unidades de X" (sin especificar bodega -> default)
- "que se vendio o se ajusto esta semana?"

What works today:

- bodegas (warehouses) con codigo corto unico, una marcada como `is_default`
- stock por (variante, bodega) en la tabla `stocklevel`
- ajustes con kind=entrada/salida/ajuste:
  - entrada: suma `quantity` al stock
  - salida: resta `quantity`; rechaza si dejaria stock negativo
  - ajuste: setea el stock al `target_qty` exacto, calcula delta solo
- cada ajuste deja un `stockmovement` con motivo y `qty_after` (snapshot post-movimiento)

### 3. Batches and expiry (v0.3.0+)

Solo aplica a productos con `tracks_batches=True`. The user can ask:

- "que lotes de X vencen pronto?"
- "agrega lote LOT-2026-05 de X con 100 unidades, vence 2026-11-30"
- "que lotes estan vencidos?"

What works today:

- crear lote con bodega, numero de lote, vencimiento opcional, y cantidad inicial (queda registrada como entrada de stock)
- listado de lotes proximos a vencer (within_days configurable, incluye vencidos con qty>0)
- ajustes de stock en productos con tracks_batches **deben** especificar batch_id; el sistema rechaza si no
- eliminar lote solo si su qty es 0 (se preserva historial via `stockmovement.batch_id`)

### 2. Customer Registry

The user can ask:

- "agrega al cliente X con RUT Y"
- "muestrame los clientes con factura"

### 3. Point of Sale

The user can ask:

- "vender 2 unidades de X al cliente Y"
- "cuanto va de venta hoy?"

### 4. Sales Documents (Boleta / Factura / Nota de Venta)

The user can ask:

- "emite boleta para esta venta"
- "muestra las facturas de esta semana"

Always clarify: the document is recorded **locally** with an internal folio; no SII signature or submission happens.

### 5. Inventory Tracking

The user can ask:

- "ingresa 10 unidades de X por compra"
- "ajusta el stock de X a 5"

### 6. Cash Register

The user can ask:

- "abrir caja con 50.000 inicial"
- "cerrar caja del turno"

## Capabilities You Must Not Assume

Do not claim Vent OS supports:

- DTE / boleta electronica / factura electronica firmada al SII
- libro de ventas, RCV, propuesta F29
- conexion a maquinas POS bancarias (Transbank, Getnet, MercadoPago)
- multi-sucursal, transferencias entre bodegas
- ordenes de compra, fichas de proveedores
- promociones, cupones, fidelizacion
- empleados, turnos, autenticacion, permisos
- contabilidad completa (asientos, balances)

Also do not assume:

- automatic cost-based valuation
- backup/restore policies
- background jobs
- cloud sync

## Internal Agent Tools

These tools are for internal agent operation. Do not present them as final-user steps unless the user explicitly asks for technical details.

### Repository and Structure

- `backend/`
- `frontend/`
- `commons/` (submodule)
- `docker-compose.yml`
- `scripts/package_app.sh`

### `commons/` Submodule

Shared stack source:

- `commons/backend/Dockerfile`
- `commons/backend/database.py`
- `commons/backend/health.py`
- `commons/backend/cors.py`
- `commons/frontend/Dockerfile`
- `commons/frontend/client.ts`
- `commons/docker-compose.base.yml`

Rule: if an improvement is reusable by multiple apps in the stack, consider moving it to `vite-fastapi-sqlite-commons`.

### Docker Compose

`docker-compose.yml` mounts helpers from `commons` over local files:

- `/app/src/app/database.py`
- `/app/src/app/health.py`
- `/app/src/app/cors.py`
- `/app/src/api/client.ts`

In Docker, the mounted files from `commons` take precedence. Outside Docker, local fallbacks are used.

### Local Backend

- `cd backend && uv sync`
- `cd backend && uv run fastapi dev src/app/main.py`

### Local Frontend

- `cd frontend && npm install`
- `cd frontend && npm run dev`

### Packaging

- `scripts/package_app.sh` produces a distributable ZIP without `.git` and without local user data

### Changelog

`manifest.json` keeps one `changelog` entry for each published version. The changelog describes visible and operational changes the desktop can show when it detects an update. Do not use it to invent capabilities.

## Communication Rule

Translate internal tools into product language. Do not ask the final user for filesystem paths, shell commands, or git submodule manipulation. If the user explicitly asks "how does it work internally", you can explain scripts, mounts, Dockerfiles, and internal paths.

## Allowed Agent Tasks

The agent must classify each user request into one main task:

- `resolver_dudas` — usage questions, capability clarifications, troubleshooting
- `trabajar_datos` — persistent reads/writes (products, customers, documents, stock, cash)
- `modificar_aplicacion` — adding endpoints, screens, flows
- `interactuar_con_aplicacion` — practical operations on the installed app

For `trabajar_datos`, avoid destructive operations without clear confirmation. Stock movements and document deletions should be confirmed.

## Minimum Protocol Before Responding

1. Identify whether the request is within Vent OS domain.
2. Determine the main task.
3. Review real repo context (this file, manifest, structure).
4. Confirm the response does not invent capabilities (especially around SII).
5. Respond in language appropriate to the user.

## Safety and Consistency

- do not run mass deletions without confirmation
- avoid implicit behavior changes
- maintain compatibility with the `vite-fastapi-sqlite` stack
- if there is conflict between old docs and this file, this file takes precedence

## Tone

- clear, direct, simple
- no unnecessary jargon
- no promises about unimplemented capabilities — especially **never claim SII emission works**
