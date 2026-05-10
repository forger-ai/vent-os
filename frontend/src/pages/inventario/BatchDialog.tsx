import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { ApiError } from "../../api/client";
import {
  type BatchCreateInput,
  type BatchRow,
  type BatchUpdateInput,
  createBatch,
  updateBatch,
} from "../../api/batches";
import { type WarehouseRow, listWarehouses } from "../../api/warehouses";

interface BatchDialogProps {
  open: boolean;
  variantId: string | null;
  variantLabel: string;
  initial: BatchRow | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function BatchDialog({
  open,
  variantId,
  variantLabel,
  initial,
  onClose,
  onSaved,
}: BatchDialogProps) {
  const editing = initial !== null;
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [lotNumber, setLotNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [qty, setQty] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadWarehouses = useCallback(async () => {
    try {
      const ws = await listWarehouses(false);
      setWarehouses(ws);
      if (!editing && ws.length > 0 && !warehouseId) {
        const def = ws.find((w) => w.is_default) ?? ws[0];
        setWarehouseId(def.id);
      }
    } catch {
      // best-effort
    }
  }, [editing, warehouseId]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (initial) {
      setWarehouseId(initial.warehouse_id);
      setLotNumber(initial.lot_number);
      setExpiry(initial.expiry_date ?? "");
      setQty(initial.qty);
      setNotes(initial.notes ?? "");
    } else {
      setLotNumber("");
      setExpiry("");
      setQty(0);
      setNotes("");
    }
    loadWarehouses();
  }, [open, initial, loadWarehouses]);

  if (!variantId) return null;

  const handleSubmit = async () => {
    setError(null);
    if (!lotNumber.trim()) {
      setError("El numero de lote es obligatorio.");
      return;
    }
    if (!editing && !warehouseId) {
      setError("Selecciona una bodega.");
      return;
    }
    setSaving(true);
    try {
      if (editing && initial) {
        const body: BatchUpdateInput = {
          lot_number: lotNumber.trim(),
          expiry_date: expiry || null,
          notes: notes.trim() || null,
        };
        await updateBatch(initial.id, body);
      } else {
        const body: BatchCreateInput = {
          warehouse_id: warehouseId,
          lot_number: lotNumber.trim(),
          expiry_date: expiry || null,
          qty: Number(qty) || 0,
          notes: notes.trim() || null,
        };
        await createBatch(variantId, body);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el lote.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {editing ? "Editar lote" : "Nuevo lote"}
        <Typography variant="body2" color="text.secondary">
          {variantLabel}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Autocomplete
                options={warehouses}
                getOptionLabel={(o) => `${o.code} · ${o.name}`}
                value={warehouses.find((w) => w.id === warehouseId) ?? null}
                onChange={(_, v) => setWarehouseId(v?.id ?? "")}
                disabled={editing}
                renderInput={(p) => (
                  <TextField
                    {...p}
                    label="Bodega"
                    required
                    helperText={editing ? "No se puede cambiar la bodega del lote" : undefined}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="N° de lote"
                fullWidth
                required
                value={lotNumber}
                onChange={(e) => setLotNumber(e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Vencimiento"
                type="date"
                fullWidth
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                helperText="Opcional"
              />
            </Grid>
            {!editing && (
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Cantidad inicial"
                  type="number"
                  fullWidth
                  value={qty}
                  onChange={(e) => setQty(Number(e.target.value))}
                  helperText="Se registra como entrada de stock"
                  slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
                />
              </Grid>
            )}
            <Grid item xs={12}>
              <TextField
                label="Notas"
                fullWidth
                multiline
                minRows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Grid>
          </Grid>
          {editing && (
            <Alert severity="info" variant="outlined">
              Para cambiar la cantidad de un lote, usa "Ajustar stock" desde la pestana
              Stock (asi queda registrado el movimiento).
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving}>
          {saving ? "Guardando..." : editing ? "Guardar" : "Crear lote"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
