import { del, get, patch, post } from "./client";

export interface PaymentMethodRow {
  id: string;
  code: string;
  name: string;
  is_cash: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface PaymentMethodCreateInput {
  code: string;
  name: string;
  is_cash?: boolean;
  is_active?: boolean;
  sort_order?: number;
}

export interface PaymentMethodUpdateInput {
  code?: string;
  name?: string;
  is_cash?: boolean;
  is_active?: boolean;
  sort_order?: number;
}

export const listPaymentMethods = (includeInactive = false) =>
  get<PaymentMethodRow[]>(
    `/api/payment-methods${includeInactive ? "?include_inactive=true" : ""}`,
  );

export const createPaymentMethod = (body: PaymentMethodCreateInput) =>
  post<PaymentMethodRow>("/api/payment-methods", body);

export const updatePaymentMethod = (id: string, body: PaymentMethodUpdateInput) =>
  patch<PaymentMethodRow>(`/api/payment-methods/${id}`, body);

export const deactivatePaymentMethod = (id: string) =>
  del<PaymentMethodRow>(`/api/payment-methods/${id}`);
