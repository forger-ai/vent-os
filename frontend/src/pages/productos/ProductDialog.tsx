import { useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  MenuItem,
  Stack,
  Switch,
  TextField,
} from "@mui/material";
import {
  type ProductDetail,
  type ProductInput,
  type ProductType,
  type ProductUnit,
  createProduct,
  updateProduct,
} from "../../api/products";
import { ApiError } from "../../api/client";

interface ProductDialogProps {
  open: boolean;
  initial: ProductDetail | null;
  categories: string[];
  brands: string[];
  onClose: () => void;
  onSaved: (product: ProductDetail) => void;
}

const UNIT_OPTIONS: ProductUnit[] = ["unit", "kg", "g", "l", "ml", "m", "box"];

const emptyForm: ProductInput = {
  sku: "",
  barcode: "",
  name: "",
  description: "",
  category: "",
  brand: "",
  product_type: "product",
  unit: "unit",
  price_clp: 0,
  cost_clp: null,
  iva_affected: true,
  stock_qty: 0,
  stock_min: 0,
  is_active: true,
  notes: "",
};

const fromDetail = (p: ProductDetail): ProductInput => ({
  sku: p.sku,
  barcode: p.barcode ?? "",
  name: p.name,
  description: p.description ?? "",
  category: p.category ?? "",
  brand: p.brand ?? "",
  product_type: p.product_type,
  unit: p.unit,
  price_clp: p.price_clp,
  cost_clp: p.cost_clp,
  iva_affected: p.iva_affected,
  stock_qty: p.stock_qty,
  stock_min: p.stock_min,
  is_active: p.is_active,
  notes: p.notes ?? "",
});

const normalize = (form: ProductInput): ProductInput => ({
  ...form,
  sku: form.sku.trim(),
  name: form.name.trim(),
  barcode: form.barcode?.toString().trim() || null,
  description: form.description?.toString().trim() || null,
  category: form.category?.toString().trim() || null,
  brand: form.brand?.toString().trim() || null,
  notes: form.notes?.toString().trim() || null,
  cost_clp:
    form.cost_clp === null || form.cost_clp === undefined || Number.isNaN(form.cost_clp)
      ? null
      : Number(form.cost_clp),
  price_clp: Number(form.price_clp) || 0,
  stock_qty: Number(form.stock_qty) || 0,
  stock_min: Number(form.stock_min) || 0,
});

export default function ProductDialog({
  open,
  initial,
  categories,
  brands,
  onClose,
  onSaved,
}: ProductDialogProps) {
  const editing = initial !== null;
  const [form, setForm] = useState<ProductInput>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(initial ? fromDetail(initial) : emptyForm);
  }, [open, initial]);

  const setField = <K extends keyof ProductInput>(field: K, value: ProductInput[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const isService = form.product_type === "service";

  const handleSubmit = async () => {
    setError(null);
    if (!form.sku.trim()) {
      setError("SKU es obligatorio.");
      return;
    }
    if (!form.name.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    setSaving(true);
    try {
      const normalized = normalize(form);
      const saved = editing
        ? await updateProduct(initial!.id, normalized)
        : await createProduct(normalized);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("No se pudo guardar el producto.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{editing ? "Editar producto" : "Nuevo producto"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <TextField
                label="SKU"
                fullWidth
                required
                value={form.sku}
                onChange={(e) => setField("sku", e.target.value)}
                disabled={editing}
                helperText={editing ? "SKU no se puede cambiar aqui" : "Codigo unico interno"}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                label="Codigo de barras"
                fullWidth
                value={form.barcode ?? ""}
                onChange={(e) => setField("barcode", e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                label="Tipo"
                select
                fullWidth
                value={form.product_type}
                onChange={(e) => setField("product_type", e.target.value as ProductType)}
              >
                <MenuItem value="product">Producto</MenuItem>
                <MenuItem value="service">Servicio</MenuItem>
              </TextField>
            </Grid>

            <Grid item xs={12}>
              <TextField
                label="Nombre"
                fullWidth
                required
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
              />
            </Grid>

            <Grid item xs={12}>
              <TextField
                label="Descripcion"
                fullWidth
                multiline
                minRows={2}
                value={form.description ?? ""}
                onChange={(e) => setField("description", e.target.value)}
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <Autocomplete
                freeSolo
                options={categories}
                value={form.category ?? ""}
                onChange={(_, value) => setField("category", value ?? "")}
                onInputChange={(_, value) => setField("category", value)}
                renderInput={(params) => <TextField {...params} label="Categoria" fullWidth />}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Autocomplete
                freeSolo
                options={brands}
                value={form.brand ?? ""}
                onChange={(_, value) => setField("brand", value ?? "")}
                onInputChange={(_, value) => setField("brand", value)}
                renderInput={(params) => <TextField {...params} label="Marca" fullWidth />}
              />
            </Grid>

            <Grid item xs={12} sm={4}>
              <TextField
                label="Unidad"
                select
                fullWidth
                value={form.unit}
                onChange={(e) => setField("unit", e.target.value as ProductUnit)}
              >
                {UNIT_OPTIONS.map((u) => (
                  <MenuItem key={u} value={u}>
                    {u}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                label="Precio (CLP)"
                type="number"
                fullWidth
                value={form.price_clp}
                onChange={(e) => setField("price_clp", Number(e.target.value))}
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                label="Costo (CLP)"
                type="number"
                fullWidth
                value={form.cost_clp ?? ""}
                onChange={(e) =>
                  setField(
                    "cost_clp",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
                helperText="Opcional, para calcular margen"
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.iva_affected}
                    onChange={(e) => setField("iva_affected", e.target.checked)}
                  />
                }
                label={form.iva_affected ? "Afecto a IVA" : "Exento de IVA"}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.is_active}
                    onChange={(e) => setField("is_active", e.target.checked)}
                  />
                }
                label={form.is_active ? "Activo" : "Inactivo"}
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField
                label="Stock actual"
                type="number"
                fullWidth
                value={form.stock_qty}
                onChange={(e) => setField("stock_qty", Number(e.target.value))}
                disabled={isService}
                slotProps={{ htmlInput: { step: 0.01 } }}
                helperText={isService ? "Los servicios no manejan stock" : undefined}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Stock minimo"
                type="number"
                fullWidth
                value={form.stock_min}
                onChange={(e) => setField("stock_min", Number(e.target.value))}
                disabled={isService}
                slotProps={{ htmlInput: { step: 0.01 } }}
                helperText="Alerta cuando stock cae a este nivel"
              />
            </Grid>

            <Grid item xs={12}>
              <TextField
                label="Notas internas"
                fullWidth
                multiline
                minRows={2}
                value={form.notes ?? ""}
                onChange={(e) => setField("notes", e.target.value)}
              />
            </Grid>
          </Grid>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving}>
          {saving ? "Guardando..." : editing ? "Guardar" : "Crear producto"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
