import { del, get, patch, post } from "./client";

export type CustomerDocumentType = "boleta" | "factura";

export interface CustomerRow {
  id: string;
  rut: string | null;
  razon_social: string;
  giro: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  comuna: string | null;
  ciudad: string | null;
  default_document_type: CustomerDocumentType;
  documents_count: number;
}

export interface CustomerPage {
  items: CustomerRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface CustomerCreateInput {
  rut?: string | null;
  razon_social: string;
  giro?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  comuna?: string | null;
  ciudad?: string | null;
  default_document_type: CustomerDocumentType;
  notes?: string | null;
}

export interface CustomerUpdateInput {
  rut?: string | null;
  razon_social?: string;
  giro?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  comuna?: string | null;
  ciudad?: string | null;
  default_document_type?: CustomerDocumentType;
  notes?: string | null;
}

export interface ListCustomersParams {
  q?: string;
  default_document_type?: CustomerDocumentType;
  comuna?: string;
  sort?: "razon_social" | "rut" | "comuna" | "ciudad" | "updated_at";
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

export const listCustomers = (params: ListCustomersParams = {}, signal?: AbortSignal) =>
  get<CustomerPage>(`/api/customers${buildQuery(params as Record<string, unknown>)}`, signal);

export const getCustomer = (id: string) => get<CustomerRow>(`/api/customers/${id}`);

export const createCustomer = (body: CustomerCreateInput) =>
  post<CustomerRow>("/api/customers", body);

export const updateCustomer = (id: string, body: CustomerUpdateInput) =>
  patch<CustomerRow>(`/api/customers/${id}`, body);

export const deleteCustomer = (id: string) => del<void>(`/api/customers/${id}`);

export const listGiros = () => get<string[]>("/api/customers/giros");
