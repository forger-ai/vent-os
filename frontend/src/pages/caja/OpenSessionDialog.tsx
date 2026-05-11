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
  Stack,
  TextField,
} from "@mui/material";
import { ApiError } from "../../api/client";
import { type CashSessionRow, openSession } from "../../api/cash";
import { type WarehouseRow, listWarehouses } from "../../api/warehouses";

interface OpenSessionDialogProps {
  open: boolean;
  defaultWarehouseId?: string;
  onClose: () => void;
  onOpened: (session: CashSessionRow) => void;
}

export default function OpenSessionDialog({
  open,
  defaultWarehouseId,
  onClose,
  onOpened,
}: OpenSessionDialogProps) {
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [openingAmount, setOpeningAmount] = useState<number>(0);
  const [openedBy, setOpenedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setOpeningAmount(0);
    setOpenedBy("");
    setNotes("");
    listWarehouses(false)
      .then((ws) => {
        setWarehouses(ws);
        const def =
          ws.find((w) => w.id === defaultWarehouseId) ??
          ws.find((w) => w.is_default) ??
          ws[0];
        if (def) setWarehouseId(def.id);
      })
      .catch(() => {});
  }, [open, defaultWarehouseId]);

  const handleSubmit = async () => {
    setError(null);
    if (!warehouseId) {
      setError("Selecciona una bodega.");
      return;
    }
    setSaving(true);
    try {
      const cs = await openSession({
        warehouse_id: warehouseId,
        opening_amount_clp: openingAmount || 0,
        opened_by: openedBy.trim() || null,
        notes: notes.trim() || null,
      });
      onOpened(cs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo abrir la caja.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Abrir caja</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Autocomplete
                options={warehouses}
                getOptionLabel={(o) => `${o.code} · ${o.name}`}
                value={warehouses.find((w) => w.id === warehouseId) ?? null}
                onChange={(_, v) => setWarehouseId(v?.id ?? "")}
                renderInput={(p) => <TextField {...p} label="Bodega" required />}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Monto inicial (CLP)"
                type="number"
                fullWidth
                value={openingAmount}
                onChange={(e) => setOpeningAmount(Math.max(0, Number(e.target.value)))}
                helperText="Dinero presente en la caja al abrir"
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Cajero (opcional)"
                fullWidth
                value={openedBy}
                onChange={(e) => setOpenedBy(e.target.value)}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Notas (opcional)"
                fullWidth
                multiline
                minRows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
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
          {saving ? "Abriendo..." : "Abrir caja"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
