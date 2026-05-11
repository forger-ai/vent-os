import { useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
import { ApiError } from "../../api/client";
import {
  type CustomerCreateInput,
  type CustomerDocumentType,
  type CustomerRow,
  type CustomerUpdateInput,
  createCustomer,
  listGiros,
  updateCustomer,
} from "../../api/customers";

interface ClientDialogProps {
  open: boolean;
  initial: CustomerRow | null;
  onClose: () => void;
  onSaved: (row: CustomerRow) => void;
}

interface FormState {
  rut: string;
  razon_social: string;
  giro: string;
  email: string;
  phone: string;
  address: string;
  comuna: string;
  ciudad: string;
  default_document_type: CustomerDocumentType;
  notes: string;
}

const empty: FormState = {
  rut: "",
  razon_social: "",
  giro: "",
  email: "",
  phone: "",
  address: "",
  comuna: "",
  ciudad: "",
  default_document_type: "boleta",
  notes: "",
};

const fromRow = (c: CustomerRow): FormState => ({
  rut: c.rut ?? "",
  razon_social: c.razon_social,
  giro: c.giro ?? "",
  email: c.email ?? "",
  phone: c.phone ?? "",
  address: c.address ?? "",
  comuna: c.comuna ?? "",
  ciudad: c.ciudad ?? "",
  default_document_type: c.default_document_type,
  notes: "",
});

export default function ClientDialog({ open, initial, onClose, onSaved }: ClientDialogProps) {
  const editing = initial !== null;
  const [form, setForm] = useState<FormState>(empty);
  const [giros, setGiros] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(initial ? fromRow(initial) : empty);
    listGiros()
      .then(setGiros)
      .catch(() => setGiros([]));
  }, [open, initial]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = async () => {
    setError(null);
    if (!form.razon_social.trim()) {
      setError("La razon social es obligatoria.");
      return;
    }
    if (form.default_document_type === "factura" && !form.rut.trim()) {
      setError("Para clientes con factura por defecto, el RUT es obligatorio.");
      return;
    }
    setSaving(true);
    try {
      const body: CustomerCreateInput | CustomerUpdateInput = {
        rut: form.rut.trim() || null,
        razon_social: form.razon_social.trim(),
        giro: form.giro.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        comuna: form.comuna.trim() || null,
        ciudad: form.ciudad.trim() || null,
        default_document_type: form.default_document_type,
        notes: form.notes.trim() || null,
      };
      const saved = editing
        ? await updateCustomer(initial!.id, body)
        : await createCustomer(body as CustomerCreateInput);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el cliente.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{editing ? "Editar cliente" : "Nuevo cliente"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <TextField
                label="RUT"
                fullWidth
                value={form.rut}
                onChange={(e) => set("rut", e.target.value)}
                placeholder="77.123.456-5"
                helperText="Obligatorio para factura"
              />
            </Grid>
            <Grid item xs={12} sm={8}>
              <TextField
                label="Razon social"
                fullWidth
                required
                value={form.razon_social}
                onChange={(e) => set("razon_social", e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Autocomplete
                freeSolo
                options={giros}
                value={form.giro}
                onInputChange={(_, v) => set("giro", v)}
                renderInput={(p) => <TextField {...p} label="Giro" fullWidth />}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Documento por defecto"
                select
                fullWidth
                value={form.default_document_type}
                onChange={(e) =>
                  set("default_document_type", e.target.value as CustomerDocumentType)
                }
              >
                <MenuItem value="boleta">Boleta</MenuItem>
                <MenuItem value="factura">Factura</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Email"
                fullWidth
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Telefono"
                fullWidth
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
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
              <TextField
                label="Comuna"
                fullWidth
                value={form.comuna}
                onChange={(e) => set("comuna", e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Ciudad"
                fullWidth
                value={form.ciudad}
                onChange={(e) => set("ciudad", e.target.value)}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Notas"
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
          {saving ? "Guardando..." : editing ? "Guardar" : "Crear cliente"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
