import { get } from "./client";
import type { DocumentType } from "./pos";

export type PaymentStatus = "pending" | "partial" | "overdue" | "paid";

export interface ReceivableRow {
  id: string;
  document_type: DocumentType;
  folio: number;
  issued_at: string;
  due_date: string | null;
  days_to_due: number | null;
  is_overdue: boolean;
  customer_id: string | null;
  customer_name: string | null;
  customer_rut: string | null;
  warehouse_id: string | null;
  warehouse_code: string | null;
  total_clp: number;
  paid_total_clp: number;
  returned_total_clp: number;
  balance_due_clp: number;
  payment_status: PaymentStatus;
}

export interface ReceivablePage {
  items: ReceivableRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface ReceivablesStats {
  open_count: number;
  total_due_clp: number;
  overdue_count: number;
  overdue_total_clp: number;
  due_within_7_clp: number;
  due_within_30_clp: number;
}

export interface ListReceivablesParams {
  status?: PaymentStatus;
  customer_id?: string;
  warehouse_id?: string;
  document_type?: DocumentType;
  due_from?: string;
  due_to?: string;
  only_with_balance?: boolean;
  limit?: number;
  offset?: number;
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

export const listReceivables = (params: ListReceivablesParams = {}) =>
  get<ReceivablePage>(`/api/receivables${buildQuery(params as Record<string, unknown>)}`);

export const getReceivablesStats = (warehouseId?: string, customerId?: string) =>
  get<ReceivablesStats>(
    `/api/receivables/stats${buildQuery({ warehouse_id: warehouseId, customer_id: customerId })}`,
  );
