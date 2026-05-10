import { del, get, patch, post } from "./client";

export interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  address: string | null;
  is_default: boolean;
  is_active: boolean;
  notes: string | null;
  variants_with_stock: number;
}

export interface WarehouseCreateInput {
  code: string;
  name: string;
  address?: string | null;
  is_default?: boolean;
  is_active?: boolean;
  notes?: string | null;
}

export interface WarehouseUpdateInput {
  code?: string;
  name?: string;
  address?: string | null;
  is_default?: boolean;
  is_active?: boolean;
  notes?: string | null;
}

export const listWarehouses = (includeInactive = false) =>
  get<WarehouseRow[]>(`/api/warehouses${includeInactive ? "?include_inactive=true" : ""}`);

export const getWarehouse = (id: string) => get<WarehouseRow>(`/api/warehouses/${id}`);

export const createWarehouse = (body: WarehouseCreateInput) =>
  post<WarehouseRow>("/api/warehouses", body);

export const updateWarehouse = (id: string, body: WarehouseUpdateInput) =>
  patch<WarehouseRow>(`/api/warehouses/${id}`, body);

export const deactivateWarehouse = (id: string) => del<WarehouseRow>(`/api/warehouses/${id}`);
