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
  IconButton,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { ApiError } from "../../api/client";
import {
  type VariantAttribute,
  type VariantCreateInput,
  type VariantRow,
  type VariantUpdateInput,
  createVariant,
  listAttributeNames,
  updateVariant,
} from "../../api/variants";
import {
  type TaxCodeRow,
  listTaxCodes,
  listVariantTaxCodes,
  replaceVariantTaxCodes,
} from "../../api/tax_codes";

interface VariantDialogProps {
  open: boolean;
  productId: string;
  productName: string;
  initial: VariantRow | null;
  onClose: () => void;
  onSaved: (variant: VariantRow) => void;
}

interface FormState {
  sku: string;
  barcode: string;
  display_name: string;
  price_clp: number;
  cost_clp: number | "";
  stock_min: number;
  is_active: boolean;
  attributes: VariantAttribute[];
}

const empty: FormState = {
  sku: "",
  barcode: "",
  display_name: "",
  price_clp: 0,
  cost_clp: "",
  stock_min: 0,
  is_active: true,
  attributes: [],
};

const fromVariant = (v: VariantRow): FormState => ({
  sku: v.sku,
  barcode: v.barcode ?? "",
  display_name: v.display_name ?? "",
  price_clp: v.price_clp,
  cost_clp: v.cost_clp ?? "",
  stock_min: v.stock_min,
  is_active: v.is_active,
  attributes: v.attributes.map((a) => ({ ...a })),
});

export default function VariantDialog({
  open,
  productId,
  productName,
  initial,
  onClose,
  onSaved,
}: VariantDialogProps) {
  const editing = initial !== null;
  const [form, setForm] = useState<FormState>(empty);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [attributeNames, setAttributeNames] = useState<string[]>([]);
  const [availableTaxCodes, setAvailableTaxCodes] = useState<TaxCodeRow[]>([]);
  const [selectedTaxCodes, setSelectedTaxCodes] = useState<TaxCodeRow[]>([]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(initial ? fromVariant(initial) : empty);
    listAttributeNames()
      .then(setAttributeNames)
      .catch(() => {});
    listTaxCodes(false)
      .then(setAvailableTaxCodes)
      .catch(() => setAvailableTaxCodes([]));
    if (initial) {
      listVariantTaxCodes(initial.id)
        .then(setSelectedTaxCodes)
        .catch(() => setSelectedTaxCodes([]));
    } else {
      setSelectedTaxCodes([]);
    }
  }, [open, initial]);

  const setField = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const setAttr = (idx: number, key: "name" | "value", value: string) => {
    setForm((prev) => {
      const next = prev.attributes.map((a, i) => (i === idx ? { ...a, [key]: value } : a));
      return { ...prev, attributes: next };
    });
  };

  const addAttribute = () => {
    setForm((prev) => ({ ...prev, attributes: [...prev.attributes, { name: "", value: "" }] }));
  };

  const removeAttribute = (idx: number) => {
    setForm((prev) => ({
      ...prev,
      attributes: prev.attributes.filter((_, i) => i !== idx),
    }));
  };

  const handleSubmit = async () => {
    setError(null);
    if (!form.sku.trim()) {
      setError("SKU es obligatorio.");
      return;
    }
    const cleanAttrs = form.attributes
      .map((a) => ({ name: a.name.trim(), value: a.value.trim() }))
      .filter((a) => a.name && a.value);
    setSaving(true);
    try {
      let saved: VariantRow;
      if (editing && initial) {
        const body: VariantUpdateInput = {
          sku: form.sku.trim(),
          barcode: form.barcode.trim() || null,
          display_name: form.display_name.trim() || null,
          price_clp: Number(form.price_clp) || 0,
          cost_clp: form.cost_clp === "" ? null : Number(form.cost_clp),
          stock_min: Number(form.stock_min) || 0,
          is_active: form.is_active,
          attributes: cleanAttrs,
        };
        saved = await updateVariant(initial.id, body);
      } else {
        const body: VariantCreateInput = {
          sku: form.sku.trim(),
          barcode: form.barcode.trim() || null,
          display_name: form.display_name.trim() || null,
          price_clp: Number(form.price_clp) || 0,
          cost_clp: form.cost_clp === "" ? null : Number(form.cost_clp),
          stock_min: Number(form.stock_min) || 0,
          is_active: form.is_active,
          attributes: cleanAttrs,
        };
        saved = await createVariant(productId, body);
      }
      await replaceVariantTaxCodes(
        saved.id,
        selectedTaxCodes.map((t) => t.id),
      );
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la variante.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {editing ? "Editar variante" : "Nueva variante"}
        <Typography variant="body2" color="text.secondary">
          {productName}
        </Typography>
      </DialogTitle>
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
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                label="Codigo de barras"
                fullWidth
                value={form.barcode}
                onChange={(e) => setField("barcode", e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.is_active}
                    onChange={(e) => setField("is_active", e.target.checked)}
                  />
                }
                label={form.is_active ? "Activa" : "Inactiva"}
              />
            </Grid>

            <Grid item xs={12}>
              <TextField
                label="Nombre visible (opcional)"
                fullWidth
                value={form.display_name}
                onChange={(e) => setField("display_name", e.target.value)}
                helperText="Si lo dejas vacio se arma desde el producto + atributos"
              />
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
                value={form.cost_clp}
                onChange={(e) =>
                  setField("cost_clp", e.target.value === "" ? "" : Number(e.target.value))
                }
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
                helperText="Opcional"
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                label="Stock minimo"
                type="number"
                fullWidth
                value={form.stock_min}
                onChange={(e) => setField("stock_min", Number(e.target.value))}
                slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
                helperText="Alerta de stock bajo"
              />
            </Grid>
          </Grid>

          <Stack spacing={1}>
            <Typography variant="subtitle2" fontWeight={600}>
              Impuestos adicionales
            </Typography>
            {availableTaxCodes.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                Sin codigos de impuestos configurados. Crea uno desde la pestana
                Configuracion - Impuestos.
              </Typography>
            ) : (
              <Autocomplete
                multiple
                options={availableTaxCodes}
                getOptionLabel={(o) => `${o.code} · ${o.name} (${(o.rate * 100).toFixed(2)}%)`}
                value={selectedTaxCodes}
                onChange={(_, v) => setSelectedTaxCodes(v)}
                isOptionEqualToValue={(o, v) => o.id === v.id}
                renderInput={(p) => (
                  <TextField
                    {...p}
                    label="Codigos aplicables (ILA, especificos, ...)"
                    placeholder="Selecciona uno o varios"
                  />
                )}
              />
            )}
          </Stack>

          <Stack spacing={1}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="subtitle2" fontWeight={600}>
                Atributos
              </Typography>
              <Button size="small" startIcon={<AddIcon />} onClick={addAttribute}>
                Agregar atributo
              </Button>
            </Stack>
            {form.attributes.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                Sin atributos. Si el producto tiene una sola version, dejalo asi.
              </Typography>
            )}
            {form.attributes.map((attr, idx) => (
              <Stack direction="row" spacing={1} key={idx} alignItems="center">
                <Autocomplete
                  freeSolo
                  options={attributeNames}
                  value={attr.name}
                  onInputChange={(_, value) => setAttr(idx, "name", value)}
                  sx={{ flex: 1 }}
                  renderInput={(params) => (
                    <TextField {...params} label="Nombre (ej: Talla)" size="small" />
                  )}
                />
                <TextField
                  label="Valor (ej: L)"
                  size="small"
                  sx={{ flex: 1 }}
                  value={attr.value}
                  onChange={(e) => setAttr(idx, "value", e.target.value)}
                />
                <Tooltip title="Quitar atributo">
                  <IconButton onClick={() => removeAttribute(idx)} size="small">
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            ))}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving}>
          {saving ? "Guardando..." : editing ? "Guardar" : "Crear variante"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
