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
  type ListProductsParams,
  type ProductRow,
  listProducts,
} from "../../api/products";
import {
  type StockLevelRow,
  stockByVariant,
  transferStock,
} from "../../api/stock";
import { type VariantRow, listVariants } from "../../api/variants";
import { type WarehouseRow, listWarehouses } from "../../api/warehouses";
import { type BatchRow, listVariantBatches } from "../../api/batches";
import { formatQty, formatVariantTitle } from "../../util/format";

interface TransferDialogProps {
  open: boolean;
  initialLevel: StockLevelRow | null;
  onClose: () => void;
  onSaved: () => void;
}

interface VariantOption {
  variant: VariantRow;
  product: ProductRow;
  label: string;
}

export default function TransferDialog({
  open,
  initialLevel,
  onClose,
  onSaved,
}: TransferDialogProps) {
  const [variantOptions, setVariantOptions] = useState<VariantOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [selectedVariant, setSelectedVariant] = useState<VariantOption | null>(null);
  const [fromWh, setFromWh] = useState<string>("");
  const [toWh, setToWh] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(0);
  const [reason, setReason] = useState("");
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [batchId, setBatchId] = useState<string>("");
  const [levels, setLevels] = useState<StockLevelRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOptions = useCallback(async () => {
    try {
      const ws = await listWarehouses(false);
      setWarehouses(ws);
      const page = await listProducts({
        is_active: true,
        limit: 500,
      } as ListProductsParams);
      const tangible = page.items.filter((p) => p.product_type === "product");
      const options: VariantOption[] = [];
      for (const p of tangible) {
        const vs = await listVariants(p.id, false);
        for (const v of vs) {
          options.push({
            variant: v,
            product: p,
            label: `${formatVariantTitle(p.name, v.attributes, v.display_name)} · ${v.sku}`,
          });
        }
      }
      setVariantOptions(options);
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setQuantity(0);
    setReason("");
    setBatchId("");
    setBatches([]);
    setLevels([]);
    loadOptions();

    if (initialLevel) {
      setFromWh(initialLevel.warehouse_id);
      setToWh("");
      // Preselect variant in next effect once options load.
    } else {
      setSelectedVariant(null);
      setFromWh("");
      setToWh("");
    }
  }, [open, initialLevel, loadOptions]);

  useEffect(() => {
    if (!initialLevel || variantOptions.length === 0) return;
    const match = variantOptions.find((o) => o.variant.id === initialLevel.variant_id);
    if (match) setSelectedVariant(match);
  }, [initialLevel, variantOptions]);

  useEffect(() => {
    if (!selectedVariant) {
      setLevels([]);
      setBatches([]);
      return;
    }
    stockByVariant(selectedVariant.variant.id)
      .then(setLevels)
      .catch(() => setLevels([]));
    if (selectedVariant.product.tracks_batches) {
      listVariantBatches(selectedVariant.variant.id)
        .then(setBatches)
        .catch(() => setBatches([]));
    } else {
      setBatches([]);
    }
  }, [selectedVariant]);

  const sourceLevel = levels.find((l) => l.warehouse_id === fromWh);
  const sourceQty = sourceLevel?.qty ?? 0;
  const tracksBatches = selectedVariant?.product.tracks_batches ?? false;
  const filteredBatches = batches.filter((b) => b.warehouse_id === fromWh);

  const handleSubmit = async () => {
    setError(null);
    if (!selectedVariant) {
      setError("Selecciona una variante.");
      return;
    }
    if (!fromWh || !toWh) {
      setError("Selecciona bodega origen y destino.");
      return;
    }
    if (fromWh === toWh) {
      setError("Origen y destino no pueden ser la misma bodega.");
      return;
    }
    if (quantity <= 0) {
      setError("La cantidad debe ser mayor a 0.");
      return;
    }
    if (quantity > sourceQty) {
      setError(`Stock insuficiente en origen: hay ${sourceQty}.`);
      return;
    }
    if (tracksBatches && !batchId) {
      setError("Este producto maneja lotes: selecciona el lote de origen.");
      return;
    }
    setSaving(true);
    try {
      await transferStock({
        variant_id: selectedVariant.variant.id,
        from_warehouse_id: fromWh,
        to_warehouse_id: toWh,
        quantity,
        batch_id: batchId || null,
        reason: reason.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo transferir el stock.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Transferir stock entre bodegas</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Autocomplete
            options={variantOptions}
            getOptionLabel={(o) => o.label}
            value={selectedVariant}
            onChange={(_, v) => setSelectedVariant(v)}
            isOptionEqualToValue={(o, v) => o.variant.id === v.variant.id}
            renderInput={(p) => <TextField {...p} label="Variante" required />}
          />

          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Autocomplete
                options={warehouses}
                getOptionLabel={(o) => `${o.code} · ${o.name}`}
                value={warehouses.find((w) => w.id === fromWh) ?? null}
                onChange={(_, v) => setFromWh(v?.id ?? "")}
                renderInput={(p) => (
                  <TextField
                    {...p}
                    label="Desde"
                    required
                    helperText={
                      selectedVariant
                        ? `Stock disponible: ${formatQty(sourceQty)}`
                        : "Selecciona una variante primero"
                    }
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Autocomplete
                options={warehouses.filter((w) => w.id !== fromWh)}
                getOptionLabel={(o) => `${o.code} · ${o.name}`}
                value={warehouses.find((w) => w.id === toWh) ?? null}
                onChange={(_, v) => setToWh(v?.id ?? "")}
                renderInput={(p) => <TextField {...p} label="Hacia" required />}
              />
            </Grid>
            <Grid item xs={12} sm={tracksBatches ? 6 : 12}>
              <TextField
                label="Cantidad a transferir"
                type="number"
                fullWidth
                required
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
              />
            </Grid>
            {tracksBatches && (
              <Grid item xs={12} sm={6}>
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
                      label="Lote origen"
                      required
                      helperText="El lote se crea (o suma) en la bodega destino con el mismo numero."
                    />
                  )}
                />
              </Grid>
            )}
            <Grid item xs={12}>
              <TextField
                label="Motivo"
                fullWidth
                multiline
                minRows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Trasvase semanal, reposicion, etc."
              />
            </Grid>
          </Grid>

          <Typography variant="caption" color="text.secondary">
            Se registran dos movimientos: una salida en la bodega de origen y una
            entrada en la destino, vinculadas por el motivo.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving}>
          {saving ? "Transfiriendo..." : "Transferir"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
