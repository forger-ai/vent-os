import { del, get, patch, post } from "./client";

export interface VariantAttribute {
  name: string;
  value: string;
}

export interface VariantRow {
  id: string;
  product_id: string;
  sku: string;
  barcode: string | null;
  display_name: string | null;
  price_clp: number;
  cost_clp: number | null;
  stock_min: number;
  is_active: boolean;
  attributes: VariantAttribute[];
  total_stock_qty: number;
  low_stock: boolean;
}

export interface VariantCreateInput {
  sku: string;
  barcode?: string | null;
  display_name?: string | null;
  price_clp: number;
  cost_clp?: number | null;
  stock_min: number;
  is_active?: boolean;
  attributes: VariantAttribute[];
}

export interface VariantUpdateInput {
  sku?: string;
  barcode?: string | null;
  display_name?: string | null;
  price_clp?: number;
  cost_clp?: number | null;
  stock_min?: number;
  is_active?: boolean;
  attributes?: VariantAttribute[];
}

export const listVariants = (productId: string, includeInactive = false) =>
  get<VariantRow[]>(
    `/api/products/${productId}/variants${includeInactive ? "?include_inactive=true" : ""}`,
  );

export const getVariant = (variantId: string) => get<VariantRow>(`/api/variants/${variantId}`);

export const createVariant = (productId: string, body: VariantCreateInput) =>
  post<VariantRow>(`/api/products/${productId}/variants`, body);

export const updateVariant = (variantId: string, body: VariantUpdateInput) =>
  patch<VariantRow>(`/api/variants/${variantId}`, body);

export const deactivateVariant = (variantId: string) =>
  del<VariantRow>(`/api/variants/${variantId}`);

export const listAttributeNames = () => get<string[]>("/api/variants/attribute-names");

export const listAttributeValues = (name: string) =>
  get<string[]>(`/api/variants/attribute-values?name=${encodeURIComponent(name)}`);
