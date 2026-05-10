import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { ApiError } from "../../api/client";
import {
  type CountReport,
  type StockLevelRow,
  applyCount,
  listStockLevels,
} from "../../api/stock";
import { type WarehouseRow, listWarehouses } from "../../api/warehouses";
import { formatQty } from "../../util/format";

interface CountDialogProps {
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
}

interface CountState {
  level: StockLevelRow;
  counted: number | null;
}

export default function CountDialog({ open, onClose, onApplied }: CountDialogProps) {
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [rows, setRows] = useState<CountState[]>([]);
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<CountReport | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setReport(null);
    setRows([]);
    setReason("");
    listWarehouses(false)
      .then((ws) => {
        setWarehouses(ws);
        const def = ws.find((w) => w.is_default) ?? ws[0];
        if (def) setWarehouseId(def.id);
      })
      .catch(() => {});
  }, [open]);

  const loadStock = useCallback(async () => {
    if (!warehouseId) return;
    setLoading(true);
    setError(null);
    try {
      const list = await listStockLevels({
        warehouse_id: warehouseId,
        q: query.trim() || undefined,
        limit: 500,
      });
      // Exclude products with batches — they need per-batch adjustment.
      const filtered = list.filter((r) => !r.tracks_batches);
      setRows(filtered.map((l) => ({ level: l, counted: null })));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el stock.");
    } finally {
      setLoading(false);
    }
  }, [warehouseId, query]);

  useEffect(() => {
    if (open) loadStock();
  }, [open, loadStock]);

  const setCounted = (variantId: string, value: number | null) => {
    setRows((prev) =>
      prev.map((r) => (r.level.variant_id === variantId ? { ...r, counted: value } : r)),
    );
  };

  const handleApply = async () => {
    const entries = rows
      .filter((r) => r.counted !== null && r.counted !== undefined && !Number.isNaN(r.counted))
      .map((r) => ({ variant_id: r.level.variant_id, counted_qty: r.counted as number }));
    if (entries.length === 0) {
      setError("Ingresa al menos un conteo.");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const r = await applyCount({
        warehouse_id: warehouseId,
        entries,
        reason: reason.trim() || null,
      });
      setReport(r);
      if (r.errors === 0) {
        onApplied();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo aplicar el conteo.");
    } finally {
      setRunning(false);
    }
  };

  const filledCount = rows.filter((r) => r.counted !== null && !Number.isNaN(r.counted)).length;
  const diffCount = rows.filter(
    (r) =>
      r.counted !== null &&
      !Number.isNaN(r.counted) &&
      (r.counted as number) !== r.level.qty,
  ).length;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>Conteo fisico de inventario</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <Autocomplete
              options={warehouses}
              getOptionLabel={(o) => `${o.code} · ${o.name}`}
              value={warehouses.find((w) => w.id === warehouseId) ?? null}
              onChange={(_, v) => setWarehouseId(v?.id ?? "")}
              renderInput={(p) => <TextField {...p} label="Bodega" size="small" />}
              sx={{ minWidth: 240 }}
            />
            <TextField
              label="Buscar variante"
              size="small"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              sx={{ minWidth: 240, flexGrow: 1 }}
            />
            <TextField
              label="Motivo"
              size="small"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Conteo mensual"
              sx={{ minWidth: 200, flexGrow: 1 }}
            />
          </Stack>

          <Typography variant="caption" color="text.secondary">
            {filledCount} variantes con cantidad ingresada · {diffCount} con
            diferencia respecto al sistema. Las variantes vacias se ignoran. Los
            productos con lotes no aparecen aqui (ajustalos desde la pestana Lotes).
          </Typography>

          {report && (
            <Alert
              severity={
                report.errors > 0
                  ? "warning"
                  : report.adjusted > 0
                  ? "success"
                  : "info"
              }
            >
              Ajustadas: <strong>{report.adjusted}</strong> · Sin cambios:{" "}
              <strong>{report.unchanged}</strong> · Saltadas:{" "}
              <strong>{report.skipped}</strong> · Errores:{" "}
              <strong>{report.errors}</strong>
            </Alert>
          )}

          <Box sx={{ maxHeight: 460, overflow: "auto" }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Variante</TableCell>
                  <TableCell align="right">Esperado</TableCell>
                  <TableCell align="right">Contado</TableCell>
                  <TableCell align="right">Diferencia</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map(({ level, counted }) => {
                  const diff =
                    counted === null || Number.isNaN(counted)
                      ? null
                      : counted - level.qty;
                  return (
                    <TableRow key={level.id} hover>
                      <TableCell>
                        <Stack>
                          <Typography variant="body2" fontWeight={500}>
                            {level.variant_display}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            SKU {level.variant_sku}
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell align="right">{formatQty(level.qty)}</TableCell>
                      <TableCell align="right">
                        <TextField
                          size="small"
                          type="number"
                          value={counted === null ? "" : counted}
                          onChange={(e) =>
                            setCounted(
                              level.variant_id,
                              e.target.value === "" ? null : Number(e.target.value),
                            )
                          }
                          sx={{ width: 110 }}
                          slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        {diff === null ? (
                          <Typography variant="caption" color="text.secondary">—</Typography>
                        ) : diff === 0 ? (
                          <Chip size="small" label="OK" />
                        ) : (
                          <Chip
                            size="small"
                            color={diff < 0 ? "error" : "success"}
                            label={`${diff > 0 ? "+" : ""}${diff}`}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!loading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} align="center">
                      <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                        Sin variantes en esta bodega.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={running}>
          Cerrar
        </Button>
        <Button
          variant="contained"
          onClick={handleApply}
          disabled={filledCount === 0 || running}
        >
          {running ? "Aplicando..." : `Aplicar conteo (${filledCount})`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
