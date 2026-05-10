import { del, get, patch, post, put } from "./client";

export interface TaxCodeRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  rate: number;
  is_active: boolean;
  variants_count: number;
}

export interface TaxCodeCreateInput {
  code: string;
  name: string;
  description?: string | null;
  rate: number;
  is_active?: boolean;
}

export interface TaxCodeUpdateInput {
  code?: string;
  name?: string;
  description?: string | null;
  rate?: number;
  is_active?: boolean;
}

export const listTaxCodes = (includeInactive = false) =>
  get<TaxCodeRow[]>(`/api/tax-codes${includeInactive ? "?include_inactive=true" : ""}`);

export const getTaxCode = (id: string) => get<TaxCodeRow>(`/api/tax-codes/${id}`);

export const createTaxCode = (body: TaxCodeCreateInput) => post<TaxCodeRow>("/api/tax-codes", body);

export const updateTaxCode = (id: string, body: TaxCodeUpdateInput) =>
  patch<TaxCodeRow>(`/api/tax-codes/${id}`, body);

export const deactivateTaxCode = (id: string) => del<TaxCodeRow>(`/api/tax-codes/${id}`);

export const listVariantTaxCodes = (variantId: string) =>
  get<TaxCodeRow[]>(`/api/tax-codes/variants/${variantId}`);

export const replaceVariantTaxCodes = (variantId: string, taxCodeIds: string[]) =>
  put<TaxCodeRow[]>(`/api/tax-codes/variants/${variantId}`, { tax_code_ids: taxCodeIds });
