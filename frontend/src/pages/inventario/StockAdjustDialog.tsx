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
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { ApiError } from "../../api/client";
import { type StockLevelRow, adjustStock } from "../../api/stock";
import { type WarehouseRow, listWarehouses } from "../../api/warehouses";
import { type BatchRow, listVariantBatches } from "../../api/batches";

interface StockAdjustDialogProps {
  open: boolean;
  level: StockLevelRow | null;
  onClose: () => void;
  onSaved: () => void;
}

type Kind = "entrada" | "salida" | "ajuste";

export default function StockAdjustDialog({
  open,
  level,
  onClose,
  onSaved,
}: StockAdjustDialogProps) {
  const [kind, setKind] = useState<Kind>("entrada");
  const [quantity, setQuantity] = useState<number>(0);
  const [targetQty, setTargetQty] = useState<number>(0);
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [batchId, setBatchId] = useState<string | "">("");
  const [reason, setReason] = useState<string>("");
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !level) return;
    setError(null);
    setKind("entrada");
    setQuantity(0);
    setTargetQty(level.qty);
    setWarehouseId(level.warehouse_id);
    setBatchId("");
    setReason("");
  }, [open, level]);

  const loadOptions = useCallback(async () => {
    if (!level) return;
    try {
      const [ws, bs] = await Promise.all([
        listWarehouses(false),
        level.tracks_batches ? listVariantBatches(level.variant_id) : Promise.resolve([]),
      ]);
      setWarehouses(ws);
      setBatches(bs);
    } catch {
      // best-effort
    }
  }, [level]);

  useEffect(() => {
    if (open) loadOptions();
  }, [open, loadOptions]);

  if (!level) return null;

  const filteredBatches = batches.filter((b) => b.warehouse_id === warehouseId);

  const handleSubmit = async () => {
    setError(null);
    if (kind === "ajuste") {
      if (targetQty < 0) {
        setError("La cantidad final no puede ser negativa.");
        return;
      }
    } else if (quantity <= 0) {
      setError("La cantidad debe ser mayor a 0.");
      return;
    }
    if (level.tracks_batches && !batchId) {
      setError("Selecciona un lote (este producto maneja lotes).");
      return;
    }
    setSaving(true);
    try {
      await adjustStock({
        variant_id: level.variant_id,
        warehouse_id: warehouseId,
        kind,
        quantity: kind === "ajuste" ? 1 : Number(quantity),
        target_qty: kind === "ajuste" ? Number(targetQty) : null,
        batch_id: batchId || null,
        reason: reason.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo ajustar el stock.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Ajustar stock
        <Typography variant="body2" color="text.secondary">
          {level.variant_display} · {level.variant_sku}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Tipo"
                select
                fullWidth
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
              >
                <MenuItem value="entrada">Entrada (sumar stock)</MenuItem>
                <MenuItem value="salida">Salida (restar stock)</MenuItem>
                <MenuItem value="ajuste">Ajuste (fijar cantidad)</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Autocomplete
                options={warehouses}
                getOptionLabel={(o) => `${o.code} · ${o.name}`}
                value={warehouses.find((w) => w.id === warehouseId) ?? null}
                onChange={(_, v) => setWarehouseId(v?.id ?? "")}
                renderInput={(p) => <TextField {...p} label="Bodega" />}
              />
            </Grid>
            {kind === "ajuste" ? (
              <Grid item xs={12}>
                <TextField
                  label="Stock final"
                  type="number"
                  fullWidth
                  value={targetQty}
                  onChange={(e) => setTargetQty(Number(e.target.value))}
                  helperText={`Stock actual: ${level.qty}`}
                  slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
                />
              </Grid>
            ) : (
              <Grid item xs={12}>
                <TextField
                  label="Cantidad"
                  type="number"
                  fullWidth
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  helperText={`Stock actual: ${level.qty}`}
                  slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
                />
              </Grid>
            )}
            {level.tracks_batches && (
              <Grid item xs={12}>
                <Autocomplete
                  options={filteredBatches}
                  getOptionLabel={(o) =>
                    `${o.lot_number}${o.expiry_date ? ` · vence ${o.expiry_date}` : ""} · qty ${o.qty}`
                  }
                  value={filteredBatches.find((b) => b.id === batchId) ?? null}
                  onChange={(_, v) => setBatchId(v?.id ?? "")}
                  renderInput={(p) => (
                    <TextField
                      {...p}
                      label="Lote"
                      required
                      helperText="Producto con lotes: cada ajuste debe afectar un lote especifico."
                    />
                  )}
                />
              </Grid>
            )}
            <Grid item xs={12}>
              <TextField
                label="Motivo"
                fullWidth
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                multiline
                minRows={2}
                helperText="Aparece en el historial de movimientos."
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
          {saving ? "Aplicando..." : "Aplicar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
