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
  type PaymentMethodCreateInput,
  type PaymentMethodRow,
  type PaymentMethodUpdateInput,
  createPaymentMethod,
  updatePaymentMethod,
} from "../../api/payment_methods";

interface PaymentMethodDialogProps {
  open: boolean;
  initial: PaymentMethodRow | null;
  onClose: () => void;
  onSaved: (row: PaymentMethodRow) => void;
}

interface FormState {
  code: string;
  name: string;
  is_cash: boolean;
  is_active: boolean;
  sort_order: number;
}

const empty: FormState = {
  code: "",
  name: "",
  is_cash: false,
  is_active: true,
  sort_order: 100,
};

export default function PaymentMethodDialog({
  open,
  initial,
  onClose,
  onSaved,
}: PaymentMethodDialogProps) {
  const editing = initial !== null;
  const [form, setForm] = useState<FormState>(empty);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      initial
        ? {
            code: initial.code,
            name: initial.name,
            is_cash: initial.is_cash,
            is_active: initial.is_active,
            sort_order: initial.sort_order,
          }
        : empty,
    );
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
      const body: PaymentMethodCreateInput | PaymentMethodUpdateInput = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        is_cash: form.is_cash,
        is_active: form.is_active,
        sort_order: form.sort_order,
      };
      const saved = editing
        ? await updatePaymentMethod(initial!.id, body)
        : await createPaymentMethod(body as PaymentMethodCreateInput);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el método.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{editing ? "Editar método de pago" : "Nuevo método de pago"}</DialogTitle>
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
            <Grid item xs={12} sm={4}>
              <TextField
                label="Orden"
                type="number"
                fullWidth
                value={form.sort_order}
                onChange={(e) => set("sort_order", Number(e.target.value))}
                helperText="Menor = aparece primero"
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.is_cash}
                    onChange={(e) => set("is_cash", e.target.checked)}
                  />
                }
                label="Es efectivo (va a caja)"
              />
            </Grid>
            <Grid item xs={12} sm={4}>
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
          </Grid>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving}>
          {saving ? "Guardando..." : editing ? "Guardar" : "Crear método"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
