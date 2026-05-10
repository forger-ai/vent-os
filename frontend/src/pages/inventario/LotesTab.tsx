import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  IconButton,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import RefreshIcon from "@mui/icons-material/Refresh";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { ApiError } from "../../api/client";
import {
  type BatchRow,
  deleteBatch,
  listExpiringBatches,
  listVariantBatches,
} from "../../api/batches";
import {
  type ProductRow,
  listProducts,
} from "../../api/products";
import { type VariantRow, listVariants } from "../../api/variants";
import { formatQty, formatVariantTitle } from "../../util/format";
import BatchDialog from "./BatchDialog";

interface VariantOption {
  variant: VariantRow;
  product: ProductRow;
  label: string;
}

export default function LotesTab() {
  const [variantOptions, setVariantOptions] = useState<VariantOption[]>([]);
  const [selectedVariant, setSelectedVariant] = useState<VariantOption | null>(null);
  const [variantBatches, setVariantBatches] = useState<BatchRow[]>([]);
  const [expiring, setExpiring] = useState<BatchRow[]>([]);
  const [withinDays, setWithinDays] = useState<number>(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState<BatchRow | null>(null);

  const loadVariantOptions = useCallback(async () => {
    try {
      const page = await listProducts({
        is_active: true,
        limit: 500,
      });
      const trackingProducts = page.items.filter((p) => p.tracks_batches);
      const options: VariantOption[] = [];
      for (const p of trackingProducts) {
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

  const loadExpiring = useCallback(async () => {
    try {
      const list = await listExpiringBatches(withinDays);
      setExpiring(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar lotes proximos a vencer.");
    }
  }, [withinDays]);

  const loadVariantBatches = useCallback(async () => {
    if (!selectedVariant) {
      setVariantBatches([]);
      return;
    }
    setLoading(true);
    try {
      const list = await listVariantBatches(selectedVariant.variant.id);
      setVariantBatches(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los lotes.");
    } finally {
      setLoading(false);
    }
  }, [selectedVariant]);

  useEffect(() => {
    loadVariantOptions();
  }, [loadVariantOptions]);

  useEffect(() => {
    loadExpiring();
  }, [loadExpiring]);

  useEffect(() => {
    loadVariantBatches();
  }, [loadVariantBatches]);

  const handleSaved = () => {
    setDialogOpen(false);
    setEditingBatch(null);
    setToast("Lote guardado.");
    loadVariantBatches();
    loadExpiring();
  };

  const handleDelete = async (b: BatchRow) => {
    if (b.qty !== 0) {
      alert("Solo se puede eliminar un lote con stock 0. Ajusta a 0 primero desde Stock.");
      return;
    }
    if (!confirm(`Eliminar lote ${b.lot_number}?`)) return;
    try {
      await deleteBatch(b.id);
      setToast("Lote eliminado.");
      loadVariantBatches();
      loadExpiring();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo eliminar el lote.");
    }
  };

  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" alignItems="center" spacing={1}>
            <WarningAmberIcon color="warning" />
            <Typography variant="h6" fontWeight={600}>
              Por vencer
            </Typography>
          </Stack>
          <Stack direction="row" alignItems="center" spacing={1}>
            <TextField
              label="Proximos dias"
              type="number"
              size="small"
              value={withinDays}
              onChange={(e) => setWithinDays(Math.max(0, Number(e.target.value)))}
              sx={{ width: 130 }}
              slotProps={{ htmlInput: { min: 0, max: 365 } }}
            />
            <Tooltip title="Recargar">
              <IconButton onClick={loadExpiring}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>
        <Box>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Producto</TableCell>
                <TableCell>Lote</TableCell>
                <TableCell>Bodega</TableCell>
                <TableCell align="right">Stock</TableCell>
                <TableCell>Vence</TableCell>
                <TableCell align="right">Dias</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {expiring.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                      No hay lotes proximos a vencer en {withinDays} dias.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {expiring.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <Stack>
                      <Typography variant="body2" fontWeight={500}>
                        {b.product_name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        SKU {b.variant_sku}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>{b.lot_number}</TableCell>
                  <TableCell>
                    <Chip size="small" label={b.warehouse_code} variant="outlined" />
                  </TableCell>
                  <TableCell align="right">{formatQty(b.qty)}</TableCell>
                  <TableCell>{b.expiry_date ?? "—"}</TableCell>
                  <TableCell align="right">
                    {b.is_expired ? (
                      <Chip size="small" color="error" label="Vencido" />
                    ) : (
                      <Typography
                        variant="body2"
                        color={(b.days_to_expiry ?? 0) <= 7 ? "error.main" : "warning.main"}
                        fontWeight={500}
                      >
                        {b.days_to_expiry} d
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Stack>

      <Stack spacing={1}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="h6" fontWeight={600}>
            Lotes por variante
          </Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            disabled={!selectedVariant}
            onClick={() => {
              setEditingBatch(null);
              setDialogOpen(true);
            }}
          >
            Nuevo lote
          </Button>
        </Stack>
        <Autocomplete
          options={variantOptions}
          getOptionLabel={(o) => o.label}
          value={selectedVariant}
          onChange={(_, v) => setSelectedVariant(v)}
          renderInput={(p) => (
            <TextField
              {...p}
              label="Variante con lotes"
              size="small"
              helperText="Solo aparecen variantes de productos que manejan lotes."
            />
          )}
          isOptionEqualToValue={(o, v) => o.variant.id === v.variant.id}
        />

        {error && <Alert severity="error">{error}</Alert>}

        {selectedVariant && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Lote</TableCell>
                <TableCell>Bodega</TableCell>
                <TableCell>Vence</TableCell>
                <TableCell align="right">Stock</TableCell>
                <TableCell>Notas</TableCell>
                <TableCell width={80}></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {variantBatches.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                      Sin lotes para esta variante.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {variantBatches.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>
                      {b.lot_number}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={b.warehouse_code} variant="outlined" />
                  </TableCell>
                  <TableCell>
                    {b.expiry_date ?? <Typography variant="caption" color="text.secondary">—</Typography>}
                    {b.is_expired && (
                      <Chip size="small" color="error" label="Vencido" sx={{ ml: 1 }} />
                    )}
                  </TableCell>
                  <TableCell align="right">{formatQty(b.qty)}</TableCell>
                  <TableCell>
                    {b.notes ?? <Typography variant="caption" color="text.secondary">—</Typography>}
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5}>
                      <Tooltip title="Editar">
                        <IconButton
                          size="small"
                          onClick={() => {
                            setEditingBatch(b);
                            setDialogOpen(true);
                          }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Eliminar (requiere stock 0)">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDelete(b)}
                          disabled={b.qty !== 0}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Stack>

      <BatchDialog
        open={dialogOpen}
        variantId={selectedVariant?.variant.id ?? null}
        variantLabel={selectedVariant?.label ?? ""}
        initial={editingBatch}
        onClose={() => {
          setDialogOpen(false);
          setEditingBatch(null);
        }}
        onSaved={handleSaved}
      />

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={3000}
        onClose={() => setToast(null)}
        message={toast ?? ""}
      />
    </Stack>
  );
}
