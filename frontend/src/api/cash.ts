import { get, post } from "./client";

export type CashSessionStatus = "open" | "closed";

export interface SessionSummary {
  documents_count: number;
  sales_total_clp: number;
  cancelled_count: number;
}

export interface CashSessionRow {
  id: string;
  warehouse_id: string | null;
  warehouse_code: string | null;
  warehouse_name: string | null;
  opened_by: string | null;
  opened_at: string;
  closed_at: string | null;
  opening_amount_clp: number;
  closing_amount_clp: number | null;
  expected_amount_clp: number | null;
  difference_clp: number | null;
  status: CashSessionStatus;
  notes: string | null;
  summary: SessionSummary;
}

export interface CashSessionPage {
  items: CashSessionRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface OpenSessionInput {
  warehouse_id: string;
  opening_amount_clp?: number;
  opened_by?: string | null;
  notes?: string | null;
}

export interface CloseSessionInput {
  closing_amount_clp: number;
  notes?: string | null;
}

export interface ListSessionsParams {
  warehouse_id?: string;
  status?: CashSessionStatus;
  order?: "asc" | "desc";
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

export const listSessions = (params: ListSessionsParams = {}) =>
  get<CashSessionPage>(`/api/cash/sessions${buildQuery(params as Record<string, unknown>)}`);

export const getSession = (id: string) =>
  get<CashSessionRow>(`/api/cash/sessions/${id}`);

export const currentSession = (warehouseId: string) =>
  get<CashSessionRow | null>(`/api/cash/current?warehouse_id=${encodeURIComponent(warehouseId)}`);

export const openSession = (body: OpenSessionInput) =>
  post<CashSessionRow>("/api/cash/open", body);

export const closeSession = (id: string, body: CloseSessionInput) =>
  post<CashSessionRow>(`/api/cash/sessions/${id}/close`, body);
