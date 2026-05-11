import { get, post } from "./client";

export type DocumentType = "boleta" | "factura" | "nota_venta";

export interface TaxCodeBrief {
  id: string;
  code: string;
  name: string;
  rate: number;
}

export interface CartProduct {
  variant_id: string;
  sku: string;
  barcode: string | null;
  display_name: string;
  product_id: string;
  product_name: string;
  unit: string;
  iva_affected: boolean;
  tracks_batches: boolean;
  base_price_clp: number;
  effective_price_clp: number;
  price_source: string;
  stock_qty: number;
  tax_codes: TaxCodeBrief[];
}

export interface CheckoutItemInput {
  variant_id: string;
  quantity: number;
  unit_price_clp?: number | null;
  line_discount_clp?: number;
}

export interface CheckoutPaymentInput {
  payment_method_id: string;
  amount_clp: number;
  reference?: string | null;
}

export interface CheckoutInput {
  document_type: DocumentType;
  warehouse_id: string;
  customer_id?: string | null;
  price_list_id?: string | null;
  cash_session_id?: string | null;
  global_discount_clp?: number;
  notes?: string | null;
  items: CheckoutItemInput[];
  payments?: CheckoutPaymentInput[];
}

export interface DocumentItemOut {
  id: string;
  variant_id: string | null;
  sku_snapshot: string | null;
  name_snapshot: string;
  quantity: number;
  unit_price_clp: number;
  iva_affected: boolean;
  discount_clp: number;
  line_total_clp: number;
}

export interface DocumentPaymentOut {
  id: string;
  payment_method_id: string;
  code: string;
  name: string;
  is_cash: boolean;
  amount_clp: number;
  reference: string | null;
}

export interface DocumentOut {
  id: string;
  document_type: DocumentType;
  folio: number;
  issued_at: string;
  status: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_rut: string | null;
  warehouse_id: string | null;
  warehouse_code: string | null;
  subtotal_clp: number;
  iva_clp: number;
  total_clp: number;
  notes: string | null;
  items: DocumentItemOut[];
  payments: DocumentPaymentOut[];
}

export const searchPosProducts = (
  q: string,
  warehouseId: string,
  priceListId?: string,
) => {
  const params = new URLSearchParams({ q, warehouse_id: warehouseId });
  if (priceListId) params.set("price_list_id", priceListId);
  return get<CartProduct[]>(`/api/pos/search?${params.toString()}`);
};

export const lookupPosProduct = (
  code: string,
  warehouseId: string,
  priceListId?: string,
) => {
  const params = new URLSearchParams({ warehouse_id: warehouseId });
  if (priceListId) params.set("price_list_id", priceListId);
  return get<CartProduct>(
    `/api/pos/lookup/${encodeURIComponent(code)}?${params.toString()}`,
  );
};

export const posCheckout = (body: CheckoutInput) =>
  post<DocumentOut>("/api/pos/checkout", body);
