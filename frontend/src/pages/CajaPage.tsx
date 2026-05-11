import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
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
import LockOpenIcon from "@mui/icons-material/LockOpen";
import LockIcon from "@mui/icons-material/Lock";
import RefreshIcon from "@mui/icons-material/Refresh";
import { ApiError } from "../api/client";
import {
  type CashSessionRow,
  type CashSessionStatus,
  listSessions,
} from "../api/cash";
import { type WarehouseRow, listWarehouses } from "../api/warehouses";
import { formatCLP } from "../util/format";
import OpenSessionDialog from "./caja/OpenSessionDialog";
import CloseSessionDialog from "./caja/CloseSessionDialog";

const STATUS_LABEL: Record<CashSessionStatus, string> = {
  open: "Abierta",
  closed: "Cerrada",
};

const STATUS_COLOR: Record<CashSessionStatus, "success" | "default"> = {
  open: "success",
  closed: "default",
};

export default function CajaPage() {
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);

  const [openSession, setOpenSession] = useState<CashSessionRow | null>(null);
  const [history, setHistory] = useState<CashSessionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [openDialogOpen, setOpenDialogOpen] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);

  const loadWarehouses = useCallback(async () => {
    try {
      const ws = await listWarehouses(false);
      setWarehouses(ws);
      if (!warehouseId) {
        const def = ws.find((w) => w.is_default) ?? ws[0];
        if (def) setWarehouseId(def.id);
      }
    } catch {
      // best-effort
    }
  }, [warehouseId]);

  const load = useCallback(async () => {
    if (!warehouseId) return;
    setLoading(true);
    setError(null);
    try {
      const page = await listSessions({
        warehouse_id: warehouseId,
        limit: 50,
        order: "desc",
      });
      const open = page.items.find((s) => s.status === "open") ?? null;
      setOpenSession(open);
      setHistory(page.items.filter((s) => s.status === "closed"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar la caja.");
    } finally {
      setLoading(false);
    }
  }, [warehouseId]);

  useEffect(() => {
    loadWarehouses();
  }, [loadWarehouses]);

  useEffect(() => {
    load();
  }, [load]);

  const handleOpened = (cs: CashSessionRow) => {
    setOpenDialogOpen(false);
    setToast(`Caja ${cs.warehouse_code} abierta.`);
    load();
  };

  const handleClosed = (cs: CashSessionRow) => {
    setCloseDialogOpen(false);
    setToast(`Caja ${cs.warehouse_code} cerrada.`);
    load();
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Caja
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Apertura y cierre de caja por bodega con monto inicial, conteo final y
            diferencia. Las ventas emitidas en POS se asocian automáticamente a la
            caja abierta de la bodega correspondiente.
          </Typography>
        </Box>
        <Tooltip title="Recargar">
          <IconButton onClick={load} disabled={loading}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      <Stack direction="row" spacing={2}>
        <Autocomplete
          options={warehouses}
          getOptionLabel={(o) => `${o.code} · ${o.name}`}
          value={warehouses.find((w) => w.id === warehouseId) ?? null}
          onChange={(_, v) => setWarehouseId(v?.id ?? null)}
          renderInput={(p) => <TextField {...p} label="Bodega" size="small" />}
          sx={{ minWidth: 280 }}
        />
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      {/* Current session card */}
      <Card>
        <CardContent>
          {openSession ? (
            <>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip
                      icon={<LockOpenIcon />}
                      color="success"
                      label="Caja abierta"
                    />
                    <Typography variant="body2" color="text.secondary">
                      desde {new Date(openSession.opened_at).toLocaleString("es-CL")}
                    </Typography>
                    {openSession.opened_by && (
                      <Typography variant="body2" color="text.secondary">
                        · {openSession.opened_by}
                      </Typography>
                    )}
                  </Stack>
                </Box>
                <Button
                  variant="contained"
                  color="error"
                  startIcon={<LockIcon />}
                  onClick={() => setCloseDialogOpen(true)}
                >
                  Cerrar caja
                </Button>
              </Stack>

              <Divider sx={{ my: 2 }} />

              <Grid container spacing={2}>
                <Grid item xs={6} md={3}>
                  <Typography variant="caption" color="text.secondary">
                    Monto inicial
                  </Typography>
                  <Typography variant="h6">
                    {formatCLP(openSession.opening_amount_clp)}
                  </Typography>
                </Grid>
                <Grid item xs={6} md={3}>
                  <Typography variant="caption" color="text.secondary">
                    Documentos
                  </Typography>
                  <Typography variant="h6">{openSession.summary.documents_count}</Typography>
                </Grid>
                <Grid item xs={6} md={3}>
                  <Typography variant="caption" color="text.secondary">
                    Ventas en sesión
                  </Typography>
                  <Typography variant="h6">
                    {formatCLP(openSession.summary.sales_total_clp)}
                  </Typography>
                </Grid>
                <Grid item xs={6} md={3}>
                  <Typography variant="caption" color="text.secondary">
                    Esperado en caja (solo efectivo)
                  </Typography>
                  <Typography variant="h5" fontWeight={700}>
                    {formatCLP(
                      openSession.opening_amount_clp + openSession.summary.cash_total_clp,
                    )}
                  </Typography>
                </Grid>
              </Grid>

              {openSession.summary.payments_by_method.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    Desglose por método de pago
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" gap={0.5} mt={0.5}>
                    {openSession.summary.payments_by_method.map((b) => (
                      <Chip
                        key={b.payment_method_id}
                        size="small"
                        color={b.is_cash ? "success" : "default"}
                        variant={b.is_cash ? "filled" : "outlined"}
                        label={`${b.code}: ${formatCLP(b.amount_clp)}`}
                      />
                    ))}
                  </Stack>
                </Box>
              )}

              {openSession.summary.cancelled_count > 0 && (
                <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
                  {openSession.summary.cancelled_count} documento(s) anulado(s) en
                  esta sesión (no cuentan en el esperado).
                </Alert>
              )}
            </>
          ) : (
            <Stack alignItems="center" spacing={2} sx={{ py: 3 }}>
              <Chip icon={<LockIcon />} label="Sin caja abierta" />
              <Typography variant="body2" color="text.secondary">
                No hay caja abierta en esta bodega. Ábrela antes de empezar a vender
                para que las ventas se asocien.
              </Typography>
              <Button
                variant="contained"
                startIcon={<LockOpenIcon />}
                onClick={() => setOpenDialogOpen(true)}
                disabled={!warehouseId}
              >
                Abrir caja
              </Button>
            </Stack>
          )}
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            Historial
          </Typography>
          <Box sx={{ maxHeight: 480, overflow: "auto" }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Abierta</TableCell>
                  <TableCell>Cerrada</TableCell>
                  <TableCell>Cajero</TableCell>
                  <TableCell align="right">Inicial</TableCell>
                  <TableCell align="right">Ventas</TableCell>
                  <TableCell align="right">Esperado</TableCell>
                  <TableCell align="right">Contado</TableCell>
                  <TableCell align="right">Diferencia</TableCell>
                  <TableCell>Estado</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {history.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={9} align="center">
                      <Typography variant="caption" color="text.secondary" sx={{ py: 2 }}>
                        Sin sesiones cerradas todavía.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {history.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{new Date(s.opened_at).toLocaleString("es-CL")}</TableCell>
                    <TableCell>
                      {s.closed_at ? new Date(s.closed_at).toLocaleString("es-CL") : "—"}
                    </TableCell>
                    <TableCell>{s.opened_by ?? "—"}</TableCell>
                    <TableCell align="right">{formatCLP(s.opening_amount_clp)}</TableCell>
                    <TableCell align="right">{formatCLP(s.summary.sales_total_clp)}</TableCell>
                    <TableCell align="right">
                      {s.expected_amount_clp !== null ? formatCLP(s.expected_amount_clp) : "—"}
                    </TableCell>
                    <TableCell align="right">
                      {s.closing_amount_clp !== null ? formatCLP(s.closing_amount_clp) : "—"}
                    </TableCell>
                    <TableCell align="right">
                      {s.difference_clp === null ? (
                        "—"
                      ) : (
                        <Typography
                          variant="body2"
                          fontWeight={500}
                          color={
                            s.difference_clp === 0
                              ? "success.main"
                              : s.difference_clp > 0
                              ? "warning.main"
                              : "error.main"
                          }
                        >
                          {s.difference_clp >= 0 ? "+" : ""}
                          {formatCLP(s.difference_clp)}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={STATUS_COLOR[s.status]}
                        label={STATUS_LABEL[s.status]}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </CardContent>
      </Card>

      <OpenSessionDialog
        open={openDialogOpen}
        defaultWarehouseId={warehouseId ?? undefined}
        onClose={() => setOpenDialogOpen(false)}
        onOpened={handleOpened}
      />

      <CloseSessionDialog
        open={closeDialogOpen}
        session={openSession}
        onClose={() => setCloseDialogOpen(false)}
        onClosed={handleClosed}
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
