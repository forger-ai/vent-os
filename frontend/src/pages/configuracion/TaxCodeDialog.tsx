import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  Stack,
  Switch,
  TextField,
} from "@mui/material";
import { ApiError } from "../../api/client";
import {
  type TaxCodeCreateInput,
  type TaxCodeRow,
  type TaxCodeUpdateInput,
  createTaxCode,
  updateTaxCode,
} from "../../api/tax_codes";

interface TaxCodeDialogProps {
  open: boolean;
  initial: TaxCodeRow | null;
  onClose: () => void;
  onSaved: (row: TaxCodeRow) => void;
}

interface FormState {
  code: string;
  name: string;
  description: string;
  ratePercent: number; // rate expressed as percent for UX (e.g. 18 for 18%)
  is_active: boolean;
}

const empty: FormState = {
  code: "",
  name: "",
  description: "",
  ratePercent: 0,
  is_active: true,
};

const fromRow = (r: TaxCodeRow): FormState => ({
  code: r.code,
  name: r.name,
  description: r.description ?? "",
  ratePercent: Number((r.rate * 100).toFixed(4)),
  is_active: r.is_active,
});

export default function TaxCodeDialog({ open, initial, onClose, onSaved }: TaxCodeDialogProps) {
  const editing = initial !== null;
  const [form, setForm] = useState<FormState>(empty);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(initial ? fromRow(initial) : empty);
  }, [open, initial]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = async () => {
    setError(null);
    if (!form.code.trim() || !form.name.trim()) {
      setError("Codigo y nombre son obligatorios.");
      return;
    }
    setSaving(true);
    try {
      const ratePercent = Number(form.ratePercent);
      const body: TaxCodeCreateInput | TaxCodeUpdateInput = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        rate: ratePercent / 100,
        is_active: form.is_active,
      };
      const saved = editing
        ? await updateTaxCode(initial!.id, body)
        : await createTaxCode(body as TaxCodeCreateInput);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el impuesto.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{editing ? "Editar impuesto" : "Nuevo impuesto"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Grid container spacing={2}>
            <Grid item xs={12} sm={5}>
              <TextField
                label="Codigo"
                fullWidth
                required
                value={form.code}
                onChange={(e) => set("code", e.target.value)}
                helperText="ILA_FUERTE, AZUCARADA_18, ..."
                slotProps={{ htmlInput: { style: { textTransform: "uppercase" } } }}
              />
            </Grid>
            <Grid item xs={12} sm={7}>
              <TextField
                label="Nombre"
                fullWidth
                required
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                label="Tasa (%)"
                type="number"
                fullWidth
                value={form.ratePercent}
                onChange={(e) => set("ratePercent", Number(e.target.value))}
                slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
                helperText="Ej: 18 para 18%"
              />
            </Grid>
            <Grid item xs={12} sm={8}>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.is_active}
                    onChange={(e) => set("is_active", e.target.checked)}
                  />
                }
                label={form.is_active ? "Activo" : "Inactivo"}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Descripcion"
                fullWidth
                multiline
                minRows={2}
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
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
          {saving ? "Guardando..." : editing ? "Guardar" : "Crear impuesto"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
