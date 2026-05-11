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
  type PriceListCreateInput,
  type PriceListRow,
  type PriceListUpdateInput,
  createPriceList,
  updatePriceList,
} from "../../api/price_lists";

interface PriceListDialogProps {
  open: boolean;
  initial: PriceListRow | null;
  onClose: () => void;
  onSaved: (row: PriceListRow) => void;
}

interface FormState {
  code: string;
  name: string;
  description: string;
  is_default: boolean;
  is_active: boolean;
}

const empty: FormState = {
  code: "",
  name: "",
  description: "",
  is_default: false,
  is_active: true,
};

const fromRow = (r: PriceListRow): FormState => ({
  code: r.code,
  name: r.name,
  description: r.description ?? "",
  is_default: r.is_default,
  is_active: r.is_active,
});

export default function PriceListDialog({ open, initial, onClose, onSaved }: PriceListDialogProps) {
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
      setError("Código y nombre son obligatorios.");
      return;
    }
    setSaving(true);
    try {
      const body: PriceListCreateInput | PriceListUpdateInput = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        is_default: form.is_default,
        is_active: form.is_active,
      };
      const saved = editing
        ? await updatePriceList(initial!.id, body)
        : await createPriceList(body as PriceListCreateInput);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la lista.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{editing ? "Editar lista" : "Nueva lista de precios"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <TextField
                label="Código"
                fullWidth
                required
                value={form.code}
                onChange={(e) => set("code", e.target.value)}
                helperText="RETAIL, WHOLESALE, VIP..."
                slotProps={{ htmlInput: { style: { textTransform: "uppercase" } } }}
              />
            </Grid>
            <Grid item xs={12} sm={8}>
              <TextField
                label="Nombre"
                fullWidth
                required
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
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
            <Grid item xs={12} sm={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.is_default}
                    onChange={(e) => set("is_default", e.target.checked)}
                  />
                }
                label="Lista por defecto"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.is_active}
                    onChange={(e) => set("is_active", e.target.checked)}
                  />
                }
                label={form.is_active ? "Activa" : "Inactiva"}
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
          {saving ? "Guardando..." : editing ? "Guardar" : "Crear lista"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
