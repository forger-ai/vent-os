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
  type WarehouseCreateInput,
  type WarehouseRow,
  type WarehouseUpdateInput,
  createWarehouse,
  updateWarehouse,
} from "../../api/warehouses";

interface WarehouseDialogProps {
  open: boolean;
  initial: WarehouseRow | null;
  onClose: () => void;
  onSaved: (warehouse: WarehouseRow) => void;
}

interface FormState {
  code: string;
  name: string;
  address: string;
  is_default: boolean;
  is_active: boolean;
  notes: string;
}

const empty: FormState = {
  code: "",
  name: "",
  address: "",
  is_default: false,
  is_active: true,
  notes: "",
};

const fromRow = (w: WarehouseRow): FormState => ({
  code: w.code,
  name: w.name,
  address: w.address ?? "",
  is_default: w.is_default,
  is_active: w.is_active,
  notes: w.notes ?? "",
});

export default function WarehouseDialog({ open, initial, onClose, onSaved }: WarehouseDialogProps) {
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
    if (!form.code.trim()) {
      setError("El codigo es obligatorio.");
      return;
    }
    if (!form.name.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        address: form.address.trim() || null,
        is_default: form.is_default,
        is_active: form.is_active,
        notes: form.notes.trim() || null,
      };
      const saved = editing
        ? await updateWarehouse(initial!.id, body as WarehouseUpdateInput)
        : await createWarehouse(body as WarehouseCreateInput);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la bodega.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{editing ? "Editar bodega" : "Nueva bodega"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <TextField
                label="Codigo"
                fullWidth
                required
                value={form.code}
                onChange={(e) => set("code", e.target.value)}
                helperText="BP, LC, BD2..."
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
                label="Direccion"
                fullWidth
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
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
                label="Bodega por defecto"
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
            <Grid item xs={12}>
              <TextField
                label="Notas internas"
                fullWidth
                multiline
                minRows={2}
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
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
          {saving ? "Guardando..." : editing ? "Guardar" : "Crear bodega"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
