import { API_BASE_URL, ApiError } from "./client";

export interface ImportRowResult {
  row: number;
  sku: string | null;
  action: "created" | "updated" | "skipped" | "error";
  product_name: string | null;
  message: string | null;
}

export interface ImportReport {
  dry_run: boolean;
  total_rows: number;
  created_products: number;
  updated_products: number;
  created_variants: number;
  updated_variants: number;
  errors: number;
  rows: ImportRowResult[];
}

export const exportProductsCsvUrl = (includeInactive = false): string =>
  `${API_BASE_URL}/api/products/export.csv${includeInactive ? "?include_inactive=true" : ""}`;

export const downloadProductsCsv = async (includeInactive = false): Promise<void> => {
  const response = await fetch(exportProductsCsvUrl(includeInactive));
  if (!response.ok) throw new ApiError(response.status, `HTTP ${response.status}`);
  const blob = await response.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "vent-os-productos.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
};

export const importProductsCsv = async (
  file: File,
  dryRun: boolean,
): Promise<ImportReport> => {
  const formData = new FormData();
  formData.append("file", file);
  const url = `${API_BASE_URL}/api/products/import.csv?dry_run=${dryRun ? "true" : "false"}`;
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", body: formData });
  } catch (err) {
    throw new ApiError(0, "Network error", err);
  }
  const contentType = response.headers.get("Content-Type") ?? "";
  const payload: unknown = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);
  if (!response.ok) {
    const detail =
      payload && typeof payload === "object" && "detail" in payload
        ? String((payload as { detail: unknown }).detail)
        : `HTTP ${response.status}`;
    throw new ApiError(response.status, detail, payload);
  }
  return payload as ImportReport;
};
