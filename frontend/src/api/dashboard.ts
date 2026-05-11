import { get } from "./client";

export interface PeriodKpis {
  label: string;
  documents_count: number;
  sales_total_clp: number;
  credits_total_clp: number;
  net_total_clp: number;
}

export interface TopProduct {
  variant_id: string;
  sku: string;
  name: string;
  qty: number;
  total_clp: number;
}

export interface PaymentBreakdownItem {
  payment_method_id: string;
  code: string;
  name: string;
  is_cash: boolean;
  amount_clp: number;
}

export interface CashSessionBrief {
  id: string;
  warehouse_code: string;
  warehouse_name: string;
  opening_amount_clp: number;
  cash_total_clp: number;
  non_cash_total_clp: number;
  expected_clp: number;
  documents_count: number;
}

export interface ExpiringBatchBrief {
  id: string;
  product_name: string;
  variant_sku: string;
  warehouse_code: string;
  lot_number: string;
  expiry_date: string;
  qty: number;
  days_to_expiry: number;
}

export interface LowStockBrief {
  variant_id: string;
  sku: string;
  display_name: string;
  product_name: string;
  stock_qty: number;
  stock_min: number;
}

export interface DashboardSummary {
  today: PeriodKpis;
  this_week: PeriodKpis;
  this_month: PeriodKpis;
  quotes_active: number;
  quotes_expired: number;
  guias_unbilled: number;
  low_stock: LowStockBrief[];
  expiring_batches: ExpiringBatchBrief[];
  expired_batches_count: number;
  top_products_this_month: TopProduct[];
  payments_this_month: PaymentBreakdownItem[];
  cash_sessions_open: CashSessionBrief[];
}

export interface DashboardParams {
  warehouse_id?: string;
  expiring_within_days?: number;
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

export const getDashboardSummary = (params: DashboardParams = {}) =>
  get<DashboardSummary>(
    `/api/dashboard/summary${buildQuery(params as Record<string, unknown>)}`,
  );
