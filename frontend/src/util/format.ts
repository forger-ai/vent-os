export const formatCLP = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(value);
};

export const formatCLPRange = (
  min: number | null,
  max: number | null,
): string => {
  if (min === null && max === null) return "—";
  if (min === null || max === null || min === max) {
    return formatCLP(min ?? max);
  }
  return `${formatCLP(min)} – ${formatCLP(max)}`;
};

export const formatQty = (value: number, unit?: string): string => {
  const formatted = new Intl.NumberFormat("es-CL", {
    maximumFractionDigits: 2,
  }).format(value);
  return unit ? `${formatted} ${unit}` : formatted;
};

export const formatVariantTitle = (
  productName: string,
  attributes: { name: string; value: string }[],
  displayName: string | null | undefined,
): string => {
  if (displayName) return displayName;
  if (attributes.length === 0) return productName;
  const attrs = attributes.map((a) => a.value).join(" / ");
  return `${productName} · ${attrs}`;
};
