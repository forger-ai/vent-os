import { get, post } from "./client";
import type { CheckoutPaymentInput, DocumentOut, DocumentType } from "./pos";

export interface QuoteItemInput {
  variant_id: string;
  quantity: number;
  unit_price_clp?: number | null;
  line_discount_clp?: number;
}

export interface QuoteCreateInput {
  warehouse_id: string;
  customer_id?: string | null;
  price_list_id?: string | null;
  valid_until?: string | null;
  global_discount_clp?: number;
  notes?: string | null;
  items: QuoteItemInput[];
}

export interface QuoteRow {
  id: string;
  folio: number;
  issued_at: string;
  status: "draft" | "issued" | "cancelled";
  customer_id: string | null;
  customer_name: string | null;
  warehouse_id: string | null;
  warehouse_code: string | null;
  total_clp: number;
  items_count: number;
  valid_until: string | null;
  is_expired: boolean;
  converted_to_document_id: string | null;
  converted_to_folio: number | null;
  converted_to_type: DocumentType | null;
}

export interface QuotePage {
  items: QuoteRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListQuotesParams {
  status?: "draft" | "issued" | "cancelled";
  only_active?: boolean;
  only_expired?: boolean;
  only_converted?: boolean;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface ConvertQuoteInput {
  document_type: DocumentType;
  cash_session_id?: string | null;
  payments: CheckoutPaymentInput[];
  notes?: string | null;
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

export const createQuote = (body: QuoteCreateInput) =>
  post<DocumentOut>("/api/quotes", body);

export const listQuotes = (params: ListQuotesParams = {}) =>
  get<QuotePage>(`/api/quotes${buildQuery(params as Record<string, unknown>)}`);

export const getQuote = (id: string) => get<DocumentOut>(`/api/quotes/${id}`);

export const convertQuote = (id: string, body: ConvertQuoteInput) =>
  post<DocumentOut>(`/api/quotes/${id}/convert`, body);

export const cancelQuote = (id: string) =>
  post<DocumentOut>(`/api/quotes/${id}/cancel`, {});
