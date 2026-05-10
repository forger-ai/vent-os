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
