import { get, post } from "./client";
import type { DocumentOut, DocumentType } from "./pos";

export type { DocumentOut, DocumentType };

export type DocumentStatus = "draft" | "issued" | "cancelled";

export interface DocumentRow {
  id: string;
  document_type: DocumentType;
  folio: number;
  issued_at: string;
  status: DocumentStatus;
  customer_id: string | null;
  customer_name: string | null;
  warehouse_id: string | null;
  warehouse_code: string | null;
  total_clp: number;
  items_count: number;
}

export interface DocumentPage {
  items: DocumentRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListDocumentsParams {
  document_type?: DocumentType;
  status?: DocumentStatus;
  customer_id?: string;
  warehouse_id?: string;
  issued_from?: string;
  issued_to?: string;
  q?: string;
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

export const listDocuments = (params: ListDocumentsParams = {}) =>
  get<DocumentPage>(`/api/documents${buildQuery(params as Record<string, unknown>)}`);

export const getDocument = (id: string) => get<DocumentOut>(`/api/documents/${id}`);

export const cancelDocument = (id: string) =>
  post<DocumentOut>(`/api/documents/${id}/cancel`, {});

export interface CreditNoteItemInput {
  original_item_id: string;
  quantity: number;
}

export interface CreditNoteInput {
  items: CreditNoteItemInput[];
  reason: string;
  notes?: string | null;
}

export const createCreditNote = (documentId: string, body: CreditNoteInput) =>
  post<DocumentOut>(`/api/documents/${documentId}/credit-note`, body);

export const listCreditNotesFor = (documentId: string) =>
  get<DocumentRow[]>(`/api/documents/${documentId}/credit-notes`);

export interface ConvertDocumentInput {
  document_type: DocumentType;
  cash_session_id?: string | null;
  payments: { payment_method_id: string; amount_clp: number; reference?: string | null }[];
  notes?: string | null;
}

export const convertDocument = (documentId: string, body: ConvertDocumentInput) =>
  post<DocumentOut>(`/api/documents/${documentId}/convert`, body);

export interface AddPaymentInput {
  payments: { payment_method_id: string; amount_clp: number; reference?: string | null }[];
}

export const addDocumentPayment = (documentId: string, body: AddPaymentInput) =>
  post<DocumentOut>(`/api/documents/${documentId}/payments`, body);
