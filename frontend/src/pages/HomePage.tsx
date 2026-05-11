import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  IconButton,
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
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import PointOfSaleIcon from "@mui/icons-material/PointOfSale";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import RefreshIcon from "@mui/icons-material/Refresh";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { ApiError } from "../api/client";
import {
  type DashboardSummary,
  type PeriodKpis,
  getDashboardSummary,
} from "../api/dashboard";
import { type WarehouseRow, listWarehouses } from "../api/warehouses";
import { formatCLP, formatQty } from "../util/format";

interface KpiCardProps {
  title: string;
  kpi: PeriodKpis;
}

function KpiCard({ title, kpi }: KpiCardProps) {
  return (
    <Card sx={{ height: "100%" }}>
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          {title}
        </Typography>
        <Typography variant="h4" fontWeight={700}>
          {formatCLP(kpi.net_total_clp)}
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" mt={0.5}>
          <Typography variant="caption" color="text.secondary">
            {kpi.documents_count} documento(s)
          </Typography>
          {kpi.credits_total_clp > 0 && (
            <Typography variant="caption" color="warning.main">
              · NC −{formatCLP(kpi.credits_total_clp)}
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function HomePage() {
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getDashboardSummary({
        warehouse_id: warehouseId ?? undefined,
      });
      setSummary(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el dashboard.");
    } finally {
      setLoading(false);
    }
  }, [warehouseId]);

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
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Inicio
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Resumen de ventas del dia/semana/mes, sesiones de caja abiertas,
            documentos pendientes y alertas de stock.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Autocomplete
            options={warehouses}
            getOptionLabel={(o) => `${o.code} · ${o.name}`}
            value={warehouses.find((w) => w.id === warehouseId) ?? null}
            onChange={(_, v) => setWarehouseId(v?.id ?? null)}
            renderInput={(p) => (
              <TextField {...p} label="Bodega (todas si vacio)" size="small" />
            )}
            sx={{ minWidth: 240 }}
          />
          <Tooltip title="Recargar">
            <IconButton onClick={load} disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      {loading && !summary && (
        <Stack alignItems="center" sx={{ py: 4 }}>
          <CircularProgress size={28} />
        </Stack>
      )}

      {summary && (
        <>
          {/* KPI cards */}
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <KpiCard title="Ventas hoy" kpi={summary.today} />
            </Grid>
            <Grid item xs={12} md={4}>
              <KpiCard title="Ventas esta semana" kpi={summary.this_week} />
            </Grid>
            <Grid item xs={12} md={4}>
              <KpiCard title="Ventas este mes" kpi={summary.this_month} />
            </Grid>
          </Grid>

          {/* Pending counters */}
          <Grid container spacing={2}>
            <Grid item xs={6} md={3}>
              <Card>
                <CardContent>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <ReceiptLongIcon color="info" />
                    <Typography variant="overline" color="text.secondary">
                      Cotizaciones activas
                    </Typography>
                  </Stack>
                  <Typography variant="h4" fontWeight={700}>
                    {summary.quotes_active}
                  </Typography>
                  {summary.quotes_expired > 0 && (
                    <Typography variant="caption" color="warning.main">
                      {summary.quotes_expired} vencida(s)
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} md={3}>
              <Card>
                <CardContent>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <LocalShippingIcon color="secondary" />
                    <Typography variant="overline" color="text.secondary">
                      Guias sin facturar
                    </Typography>
                  </Stack>
                  <Typography variant="h4" fontWeight={700}>
                    {summary.guias_unbilled}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} md={3}>
              <Card>
                <CardContent>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <WarningAmberIcon
                      color={summary.low_stock.length > 0 ? "warning" : "disabled"}
                    />
                    <Typography variant="overline" color="text.secondary">
                      Productos con stock bajo
                    </Typography>
                  </Stack>
                  <Typography variant="h4" fontWeight={700}>
                    {summary.low_stock.length}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} md={3}>
              <Card>
                <CardContent>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <WarningAmberIcon
                      color={summary.expiring_batches.length > 0 ? "error" : "disabled"}
                    />
                    <Typography variant="overline" color="text.secondary">
                      Lotes por vencer
                    </Typography>
                  </Stack>
                  <Typography variant="h4" fontWeight={700}>
                    {summary.expiring_batches.length}
                  </Typography>
                  {summary.expired_batches_count > 0 && (
                    <Typography variant="caption" color="error.main">
                      {summary.expired_batches_count} ya vencido(s)
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Cash sessions open */}
          {summary.cash_sessions_open.length > 0 && (
            <Card>
              <CardContent>
                <Stack direction="row" spacing={1} alignItems="center" mb={1}>
                  <PointOfSaleIcon color="success" />
                  <Typography variant="subtitle1" fontWeight={600}>
                    Cajas abiertas
                  </Typography>
                </Stack>
                <Grid container spacing={2}>
                  {summary.cash_sessions_open.map((s) => (
                    <Grid item xs={12} md={6} key={s.id}>
                      <Box sx={{ p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Chip size="small" color="success" label={s.warehouse_code} />
                            <Typography variant="body2" fontWeight={500}>
                              {s.warehouse_name}
                            </Typography>
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            {s.documents_count} doc(s)
                          </Typography>
                        </Stack>
                        <Grid container spacing={1} sx={{ mt: 0.5 }}>
                          <Grid item xs={4}>
                            <Typography variant="caption" color="text.secondary">
                              Inicial
                            </Typography>
                            <Typography variant="body2">
                              {formatCLP(s.opening_amount_clp)}
                            </Typography>
                          </Grid>
                          <Grid item xs={4}>
                            <Typography variant="caption" color="text.secondary">
                              Efectivo
                            </Typography>
                            <Typography variant="body2">
                              {formatCLP(s.cash_total_clp)}
                            </Typography>
                          </Grid>
                          <Grid item xs={4}>
                            <Typography variant="caption" color="text.secondary">
                              Esperado
                            </Typography>
                            <Typography variant="body2" fontWeight={600}>
                              {formatCLP(s.expected_clp)}
                            </Typography>
                          </Grid>
                        </Grid>
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              </CardContent>
            </Card>
          )}

          {/* Two-column: top products + payments */}
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Card>
                <CardContent>
                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    Top productos del mes
                  </Typography>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Producto</TableCell>
                        <TableCell align="right">Vendido</TableCell>
                        <TableCell align="right">Total</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {summary.top_products_this_month.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} align="center">
                            <Typography variant="caption" color="text.secondary">
                              Sin ventas este mes todavia.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )}
                      {summary.top_products_this_month.map((p) => (
                        <TableRow key={p.variant_id}>
                          <TableCell>
                            <Typography variant="body2">{p.name}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {p.sku}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">{formatQty(p.qty)}</TableCell>
                          <TableCell align="right">{formatCLP(p.total_clp)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={6}>
              <Card>
                <CardContent>
                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    Pagos del mes por metodo
                  </Typography>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Metodo</TableCell>
                        <TableCell align="right">Monto</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {summary.payments_this_month.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={2} align="center">
                            <Typography variant="caption" color="text.secondary">
                              Sin pagos registrados.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )}
                      {summary.payments_this_month.map((b) => (
                        <TableRow key={b.payment_method_id}>
                          <TableCell>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Chip
                                size="small"
                                color={b.is_cash ? "success" : "default"}
                                variant="outlined"
                                label={b.code}
                              />
                              <Typography variant="body2">{b.name}</Typography>
                            </Stack>
                          </TableCell>
                          <TableCell align="right">{formatCLP(b.amount_clp)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Two-column: low stock + expiring batches */}
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Card>
                <CardContent>
                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    Stock bajo
                  </Typography>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Variante</TableCell>
                        <TableCell align="right">Stock</TableCell>
                        <TableCell align="right">Minimo</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {summary.low_stock.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} align="center">
                            <Typography variant="caption" color="success.main">
                              Sin alertas de stock bajo.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )}
                      {summary.low_stock.map((s) => (
                        <TableRow key={s.variant_id}>
                          <TableCell>
                            <Typography variant="body2">{s.display_name}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {s.sku}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Chip
                              size="small"
                              color="error"
                              label={formatQty(s.stock_qty)}
                            />
                          </TableCell>
                          <TableCell align="right">{formatQty(s.stock_min)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={6}>
              <Card>
                <CardContent>
                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    Lotes proximos a vencer
                  </Typography>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Lote</TableCell>
                        <TableCell>Bodega</TableCell>
                        <TableCell align="right">Stock</TableCell>
                        <TableCell align="right">Dias</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {summary.expiring_batches.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} align="center">
                            <Typography variant="caption" color="success.main">
                              Sin lotes proximos a vencer.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )}
                      {summary.expiring_batches.map((b) => (
                        <TableRow key={b.id}>
                          <TableCell>
                            <Typography variant="body2">{b.product_name}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {b.lot_number} · {b.variant_sku}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip size="small" label={b.warehouse_code} variant="outlined" />
                          </TableCell>
                          <TableCell align="right">{formatQty(b.qty)}</TableCell>
                          <TableCell align="right">
                            {b.days_to_expiry < 0 ? (
                              <Chip size="small" color="error" label="Vencido" />
                            ) : (
                              <Typography
                                variant="body2"
                                color={
                                  b.days_to_expiry <= 7 ? "error.main" : "warning.main"
                                }
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
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </>
      )}
    </Stack>
  );
}
