import { del, get, patch, post } from "./client";

export interface BatchRow {
  id: string;
  variant_id: string;
  variant_sku: string;
  product_id: string;
  product_name: string;
  warehouse_id: string;
  warehouse_code: string;
  lot_number: string;
  expiry_date: string | null;
  qty: number;
  received_at: string;
  notes: string | null;
  days_to_expiry: number | null;
  is_expired: boolean;
}

export interface BatchCreateInput {
  warehouse_id: string;
  lot_number: string;
  expiry_date?: string | null;
  qty: number;
  notes?: string | null;
}

export interface BatchUpdateInput {
  lot_number?: string;
  expiry_date?: string | null;
  notes?: string | null;
}

export const listVariantBatches = (variantId: string) =>
  get<BatchRow[]>(`/api/variants/${variantId}/batches`);

export const createBatch = (variantId: string, body: BatchCreateInput) =>
  post<BatchRow>(`/api/variants/${variantId}/batches`, body);

export const getBatch = (id: string) => get<BatchRow>(`/api/batches/${id}`);

export const updateBatch = (id: string, body: BatchUpdateInput) =>
  patch<BatchRow>(`/api/batches/${id}`, body);

export const deleteBatch = (id: string) => del<void>(`/api/batches/${id}`);

export const listExpiringBatches = (withinDays = 30, warehouseId?: string) => {
  const params = new URLSearchParams({ within_days: String(withinDays) });
  if (warehouseId) params.set("warehouse_id", warehouseId);
  return get<BatchRow[]>(`/api/batches/expiring?${params.toString()}`);
};
