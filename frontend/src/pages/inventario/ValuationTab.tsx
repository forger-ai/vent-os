import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Card,
  CardContent,
  Chip,
  IconButton,
  MenuItem,
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
import RefreshIcon from "@mui/icons-material/Refresh";
import { ApiError } from "../../api/client";
import {
  type ValuationMode,
  type ValuationReport,
  getValuation,
} from "../../api/stock";
import { type WarehouseRow, listWarehouses } from "../../api/warehouses";
import { formatCLP, formatQty } from "../../util/format";

export default function ValuationTab() {
  const [mode, setMode] = useState<ValuationMode>("cost");
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [report, setReport] = useState<ValuationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getValuation({
        mode,
        warehouse_id: warehouseId ?? undefined,
        top_n: 50,
      });
      setReport(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo calcular la valorizacion.");
    } finally {
      setLoading(false);
    }
  }, [mode, warehouseId]);

  useEffect(() => {
    listWarehouses(false)
      .then(setWarehouses)
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="center">
        <TextField
          select
          label="Valorizar a"
          size="small"
          value={mode}
          onChange={(e) => setMode(e.target.value as ValuationMode)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="cost">Costo (cost_clp)</MenuItem>
          <MenuItem value="price">Precio de venta</MenuItem>
        </TextField>
        <Autocomplete
          options={warehouses}
          getOptionLabel={(o) => `${o.code} · ${o.name}`}
          value={warehouses.find((w) => w.id === warehouseId) ?? null}
          onChange={(_, v) => setWarehouseId(v?.id ?? null)}
          renderInput={(p) => <TextField {...p} label="Bodega" size="small" />}
          sx={{ minWidth: 240 }}
        />
        <Tooltip title="Recalcular">
          <IconButton onClick={load} disabled={loading}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      {report && (
        <>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <Card sx={{ flex: 1 }}>
              <CardContent>
                <Typography variant="overline" color="text.secondary">
                  Valor total {mode === "cost" ? "al costo" : "a precio de venta"}
                </Typography>
                <Typography variant="h4" fontWeight={700}>
                  {formatCLP(report.total_value_clp)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatQty(report.total_units)} unidades en stock
                </Typography>
              </CardContent>
            </Card>
            {mode === "cost" && report.total_variants_without_cost > 0 && (
              <Card sx={{ flex: 1 }}>
                <CardContent>
                  <Typography variant="overline" color="warning.main">
                    Variantes sin costo
                  </Typography>
                  <Typography variant="h5" fontWeight={700}>
                    {report.total_variants_without_cost}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Cargales cost_clp para incluirlas en la valorizacion al costo.
                  </Typography>
                </CardContent>
              </Card>
            )}
          </Stack>

          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <Card sx={{ flex: 1 }}>
              <CardContent>
                <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                  Por bodega
                </Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Bodega</TableCell>
                      <TableCell align="right">Unidades</TableCell>
                      <TableCell align="right">Valor</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.by_warehouse.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} align="center">
                          <Typography variant="caption" color="text.secondary">
                            Sin stock que valorizar.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                    {report.by_warehouse.map((b) => (
                      <TableRow key={b.label}>
                        <TableCell>
                          <Stack direction="row" alignItems="center" spacing={1}>
                            {b.code && <Chip size="small" label={b.code} variant="outlined" />}
                            <Typography variant="body2">{b.label}</Typography>
                          </Stack>
                        </TableCell>
                        <TableCell align="right">{formatQty(b.units)}</TableCell>
                        <TableCell align="right">{formatCLP(b.value_clp)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card sx={{ flex: 1 }}>
              <CardContent>
                <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                  Por categoria
                </Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Categoria</TableCell>
                      <TableCell align="right">Unidades</TableCell>
                      <TableCell align="right">Valor</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.by_category.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} align="center">
                          <Typography variant="caption" color="text.secondary">
                            Sin datos.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                    {report.by_category.map((b) => (
                      <TableRow key={b.label}>
                        <TableCell>{b.label}</TableCell>
                        <TableCell align="right">{formatQty(b.units)}</TableCell>
                        <TableCell align="right">{formatCLP(b.value_clp)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </Stack>

          <Card>
            <CardContent>
              <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                Top variantes por valor
              </Typography>
              <Box sx={{ maxHeight: 400, overflow: "auto" }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Variante</TableCell>
                      <TableCell>Categoria</TableCell>
                      <TableCell align="right">Unidades</TableCell>
                      <TableCell align="right">
                        {mode === "cost" ? "Costo unit." : "Precio unit."}
                      </TableCell>
                      <TableCell align="right">Valor total</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.top_variants.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} align="center">
                          <Typography variant="caption" color="text.secondary">
                            Sin variantes para valorizar.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                    {report.top_variants.map((v) => (
                      <TableRow key={v.variant_id}>
                        <TableCell>
                          <Stack>
                            <Typography variant="body2" fontWeight={500}>
                              {v.variant_display}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              SKU {v.variant_sku}
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>{v.category ?? "—"}</TableCell>
                        <TableCell align="right">{formatQty(v.units)}</TableCell>
                        <TableCell align="right">{formatCLP(v.unit_value_clp)}</TableCell>
                        <TableCell align="right">{formatCLP(v.total_value_clp)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </CardContent>
          </Card>
        </>
      )}
    </Stack>
  );
}
