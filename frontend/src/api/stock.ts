import { get, post } from "./client";

export type StockMovementKind = "entrada" | "salida" | "ajuste";

export interface StockLevelRow {
  id: string;
  variant_id: string;
  variant_sku: string;
  variant_display: string;
  product_id: string;
  product_name: string;
  warehouse_id: string;
  warehouse_code: string;
  warehouse_name: string;
  qty: number;
  stock_min: number;
  low_stock: boolean;
  tracks_batches: boolean;
}

export interface MovementRow {
  id: string;
  occurred_at: string;
  kind: StockMovementKind;
  quantity: number;
  qty_after: number;
  variant_id: string;
  variant_sku: string;
  variant_display: string;
  warehouse_id: string;
  warehouse_code: string;
  batch_id: string | null;
  lot_number: string | null;
  reason: string | null;
}

export interface MovementPage {
  items: MovementRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListStockParams {
  q?: string;
  warehouse_id?: string;
  product_id?: string;
  low_stock_only?: boolean;
  limit?: number;
}

export interface ListMovementsParams {
  variant_id?: string;
  warehouse_id?: string;
  kind?: StockMovementKind;
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
}

export interface StockAdjustInput {
  variant_id: string;
  warehouse_id: string;
  kind: StockMovementKind;
  quantity: number;
  target_qty?: number | null;
  batch_id?: string | null;
  reason?: string | null;
}

const buildQuery = (params: Record<string, unknown>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
};

export const listStockLevels = (params: ListStockParams = {}) =>
  get<StockLevelRow[]>(`/api/stock${buildQuery(params as Record<string, unknown>)}`);

export const stockByVariant = (variantId: string) =>
  get<StockLevelRow[]>(`/api/stock/by-variant/${variantId}`);

export const adjustStock = (body: StockAdjustInput) =>
  post<StockLevelRow>("/api/stock/adjust", body);

export const listMovements = (params: ListMovementsParams = {}) =>
  get<MovementPage>(`/api/stock/movements${buildQuery(params as Record<string, unknown>)}`);


// ── Transfer between warehouses ──────────────────────────────────────────────

export interface StockTransferInput {
  variant_id: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  quantity: number;
  batch_id?: string | null;
  reason?: string | null;
}

export interface TransferResult {
  source: StockLevelRow;
  destination: StockLevelRow;
}

export const transferStock = (body: StockTransferInput) =>
  post<TransferResult>("/api/stock/transfer", body);


// ── Physical count ───────────────────────────────────────────────────────────

export interface CountEntry {
  variant_id: string;
  counted_qty: number;
}

export interface StockCountInput {
  warehouse_id: string;
  entries: CountEntry[];
  reason?: string | null;
}

export interface CountRowResult {
  variant_id: string;
  variant_sku: string;
  expected_qty: number;
  counted_qty: number;
  delta: number;
  action: "adjusted" | "unchanged" | "skipped_batched" | "skipped_service" | "error";
  message: string | null;
}

export interface CountReport {
  warehouse_id: string;
  warehouse_code: string;
  total_entries: number;
  adjusted: number;
  unchanged: number;
  skipped: number;
  errors: number;
  rows: CountRowResult[];
}

export const applyCount = (body: StockCountInput) =>
  post<CountReport>("/api/stock/count", body);


// ── Valuation ────────────────────────────────────────────────────────────────

export type ValuationMode = "cost" | "price";

export interface ValuationBucket {
  label: string;
  code: string | null;
  units: number;
  value_clp: number;
}

export interface ValuationVariantRow {
  variant_id: string;
  variant_sku: string;
  variant_display: string;
  product_id: string;
  product_name: string;
  category: string | null;
  units: number;
  unit_value_clp: number;
  total_value_clp: number;
}

export interface ValuationReport {
  mode: ValuationMode;
  total_units: number;
  total_value_clp: number;
  total_variants_without_cost: number;
  by_warehouse: ValuationBucket[];
  by_category: ValuationBucket[];
  top_variants: ValuationVariantRow[];
}

export interface ValuationParams {
  mode?: ValuationMode;
  warehouse_id?: string;
  category?: string;
  brand?: string;
  top_n?: number;
}

export const getValuation = (params: ValuationParams = {}) =>
  get<ValuationReport>(`/api/stock/valuation${buildQuery(params as Record<string, unknown>)}`);
