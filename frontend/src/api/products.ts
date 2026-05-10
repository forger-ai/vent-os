import { del, get, patch, post } from "./client";

export type ProductType = "product" | "service";

export type ProductUnit = "unit" | "kg" | "g" | "l" | "ml" | "m" | "box";

export interface AttributeInput {
  name: string;
  value: string;
}

export interface InitialVariantInput {
  sku: string;
  barcode?: string | null;
  display_name?: string | null;
  price_clp: number;
  cost_clp?: number | null;
  stock_min: number;
  attributes: AttributeInput[];
}

export interface ProductRow {
  id: string;
  name: string;
  category: string | null;
  brand: string | null;
  product_type: ProductType;
  unit: ProductUnit;
  iva_affected: boolean;
  tracks_batches: boolean;
  is_active: boolean;
  variant_count: number;
  min_price_clp: number | null;
  max_price_clp: number | null;
  total_stock_qty: number;
  low_stock: boolean;
}

export interface ProductDetail extends ProductRow {
  description: string | null;
  notes: string | null;
}

export interface ProductPage {
  items: ProductRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListProductsParams {
  q?: string;
  category?: string;
  brand?: string;
  product_type?: ProductType;
  is_active?: boolean;
  low_stock_only?: boolean;
  sort?: "name" | "category" | "brand" | "price" | "stock" | "updated_at";
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface ProductCreateInput {
  name: string;
  description?: string | null;
  category?: string | null;
  brand?: string | null;
  product_type: ProductType;
  unit: ProductUnit;
  iva_affected: boolean;
  tracks_batches: boolean;
  is_active: boolean;
  notes?: string | null;
  initial_variant: InitialVariantInput;
}

export interface ProductUpdateInput {
  name?: string;
  description?: string | null;
  category?: string | null;
  brand?: string | null;
  product_type?: ProductType;
  unit?: ProductUnit;
  iva_affected?: boolean;
  tracks_batches?: boolean;
  is_active?: boolean;
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

export const listProducts = (params: ListProductsParams = {}, signal?: AbortSignal) =>
  get<ProductPage>(`/api/products${buildQuery(params as Record<string, unknown>)}`, signal);

export const getProduct = (id: string, signal?: AbortSignal) =>
  get<ProductDetail>(`/api/products/${id}`, signal);

export const listCategories = (signal?: AbortSignal) =>
  get<string[]>("/api/products/categories", signal);

export const listBrands = (signal?: AbortSignal) =>
  get<string[]>("/api/products/brands", signal);

export const createProduct = (body: ProductCreateInput) =>
  post<ProductDetail>("/api/products", body);

export const updateProduct = (id: string, body: ProductUpdateInput) =>
  patch<ProductDetail>(`/api/products/${id}`, body);

export const deactivateProduct = (id: string) =>
  del<ProductDetail>(`/api/products/${id}`);
