import { del, get, patch, post, put } from "./client";

export interface PriceListRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_default: boolean;
  is_active: boolean;
  entries_count: number;
}

export interface PriceListCreateInput {
  code: string;
  name: string;
  description?: string | null;
  is_default?: boolean;
  is_active?: boolean;
}

export interface PriceListUpdateInput {
  code?: string;
  name?: string;
  description?: string | null;
  is_default?: boolean;
  is_active?: boolean;
}

export interface PriceListEntryRow {
  variant_id: string;
  variant_sku: string;
  variant_display: string;
  product_id: string;
  product_name: string;
  base_price_clp: number;
  override_price_clp: number | null;
  effective_price_clp: number;
  source: "list" | "base";
}

export interface ResolvedPrice {
  variant_id: string;
  list_id: string;
  price_clp: number;
  source: "list" | "base";
}

export const listPriceLists = (includeInactive = false) =>
  get<PriceListRow[]>(`/api/price-lists${includeInactive ? "?include_inactive=true" : ""}`);

export const getPriceList = (id: string) => get<PriceListRow>(`/api/price-lists/${id}`);

export const createPriceList = (body: PriceListCreateInput) =>
  post<PriceListRow>("/api/price-lists", body);

export const updatePriceList = (id: string, body: PriceListUpdateInput) =>
  patch<PriceListRow>(`/api/price-lists/${id}`, body);

export const deactivatePriceList = (id: string) => del<PriceListRow>(`/api/price-lists/${id}`);

export const listEntries = (listId: string, onlyOverrides = false, q = "") => {
  const params = new URLSearchParams();
  if (onlyOverrides) params.set("only_overrides", "true");
  if (q) params.set("q", q);
  const qs = params.toString();
  return get<PriceListEntryRow[]>(
    `/api/price-lists/${listId}/entries${qs ? `?${qs}` : ""}`,
  );
};

export const setEntry = (listId: string, variantId: string, priceClp: number) =>
  put<PriceListEntryRow>(`/api/price-lists/${listId}/entries/${variantId}`, {
    price_clp: priceClp,
  });

export const removeEntry = (listId: string, variantId: string) =>
  del<void>(`/api/price-lists/${listId}/entries/${variantId}`);

export const resolvePrice = (listId: string, variantId: string) =>
  get<ResolvedPrice>(
    `/api/price-lists/resolve?list_id=${listId}&variant_id=${variantId}`,
  );
