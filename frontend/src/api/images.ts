import { API_BASE_URL, ApiError, del, get, patch } from "./client";

export interface ImageRow {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  is_primary: boolean;
  url: string;
}

const uploadFile = async <T>(path: string, file: File, isPrimary: boolean): Promise<T> => {
  const formData = new FormData();
  formData.append("file", file);
  const url = `${API_BASE_URL}${path}?is_primary=${isPrimary ? "true" : "false"}`;
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
  return payload as T;
};

export const listProductImages = (productId: string) =>
  get<ImageRow[]>(`/api/products/${productId}/images`);

export const listVariantImages = (variantId: string) =>
  get<ImageRow[]>(`/api/variants/${variantId}/images`);

export const uploadProductImage = (productId: string, file: File, isPrimary = false) =>
  uploadFile<ImageRow>(`/api/products/${productId}/images`, file, isPrimary);

export const uploadVariantImage = (variantId: string, file: File, isPrimary = false) =>
  uploadFile<ImageRow>(`/api/variants/${variantId}/images`, file, isPrimary);

export const setImagePrimary = (imageId: string, isPrimary: boolean) =>
  patch<ImageRow>(`/api/images/${imageId}`, { is_primary: isPrimary });

export const deleteImage = (imageId: string) => del<void>(`/api/images/${imageId}`);

export const imageUrl = (filename: string): string =>
  `${API_BASE_URL}/api/images/serve/${filename}`;
