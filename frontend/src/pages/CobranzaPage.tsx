import { useCallback, useEffect, useMemo, useState } from "react";
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
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PaidIcon from "@mui/icons-material/Paid";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  DataGrid,
  type GridColDef,
  type GridPaginationModel,
} from "@mui/x-data-grid";
import { ApiError } from "../api/client";
import { type CustomerRow, listCustomers } from "../api/customers";
import {
  type PaymentStatus,
  type ReceivableRow,
  type ReceivablesStats,
  getReceivablesStats,
  listReceivables,
} from "../api/receivables";
import { type WarehouseRow, listWarehouses } from "../api/warehouses";
import { formatCLP } from "../util/format";
import DocumentDetailDrawer from "./documentos/DocumentDetailDrawer";

const STATUS_COLOR: Record<PaymentStatus, "warning" | "error" | "info" | "success"> = {
  pending: "warning",
  partial: "info",
  overdue: "error",
  paid: "success",
};

const STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: "Pendiente",
  partial: "Parcial",
  overdue: "Vencido",
  paid: "Pagado",
};

export default function CobranzaPage() {
  const [stats, setStats] = useState<ReceivablesStats | null>(null);
  const [rows, setRows] = useState<ReceivableRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [status, setStatus] = useState<PaymentStatus | "">("");
  const [pagination, setPagination] = useState<GridPaginationModel>({
    page: 0,
    pageSize: 25,
  });
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [page, s] = await Promise.all([
        listReceivables({
          warehouse_id: warehouseId ?? undefined,
          customer_id: customerId ?? undefined,
          status: status || undefined,
          limit: pagination.pageSize,
          offset: pagination.page * pagination.pageSize,
        }),
        getReceivablesStats(warehouseId ?? undefined, customerId ?? undefined),
      ]);
      setRows(page.items);
      setTotal(page.total);
      setStats(s);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar la cobranza.");
    } finally {
      setLoading(false);
    }
  }, [warehouseId, customerId, status, pagination]);

  useEffect(() => {
    listWarehouses(false)
      .then(setWarehouses)
      .catch(() => {});
    listCustomers({ limit: 500 })
      .then((p) => setCustomers(p.items))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const columns: GridColDef<ReceivableRow>[] = useMemo(
    () => [
      {
        field: "issued_at",
        headerName: "Emitido",
        width: 110,
      },
      {
        field: "due_date",
        headerName: "Vence",
        width: 110,
        renderCell: (p) =>
          p.row.due_date ? (
            <Stack>
              <Typography variant="body2">{p.row.due_date}</Typography>
              {p.row.days_to_due !== null && (
                <Typography
                  variant="caption"
                  color={
                    p.row.is_overdue
                      ? "error.main"
                      : (p.row.days_to_due ?? 999) <= 7
                      ? "warning.main"
                      : "text.secondary"
                  }
                >
                  {p.row.is_overdue
                    ? `${-p.row.days_to_due!} d vencido`
                    : `${p.row.days_to_due} d`}
                </Typography>
              )}
            </Stack>
          ) : (
            <Typography variant="caption" color="text.secondary">
              —
            </Typography>
          ),
      },
      {
        field: "document_type",
        headerName: "Tipo",
        width: 120,
        renderCell: (p) => (
          <Chip
            size="small"
            label={`${p.row.document_type === "factura" ? "Factura" : p.row.document_type === "boleta" ? "Boleta" : p.row.document_type === "nota_venta" ? "N. venta" : "Guía"} #${p.row.folio}`}
            variant="outlined"
          />
        ),
      },
      {
        field: "customer_name",
        headerName: "Cliente",
        flex: 1.4,
        minWidth: 200,
        renderCell: (p) => (
          <Stack>
            <Typography variant="body2" noWrap>
              {p.row.customer_name ?? "Consumidor final"}
            </Typography>
            {p.row.customer_rut && (
              <Typography variant="caption" color="text.secondary">
                {p.row.customer_rut}
              </Typography>
            )}
          </Stack>
        ),
      },
      {
        field: "total_clp",
        headerName: "Total",
        width: 110,
        align: "right",
        headerAlign: "right",
        renderCell: (p) => formatCLP(p.row.total_clp),
      },
      {
        field: "paid_total_clp",
        headerName: "Pagado",
        width: 110,
        align: "right",
        headerAlign: "right",
        renderCell: (p) => formatCLP(p.row.paid_total_clp),
      },
      {
        field: "balance_due_clp",
        headerName: "Saldo",
        width: 130,
        align: "right",
        headerAlign: "right",
        renderCell: (p) => (
          <Typography variant="body2" fontWeight={600}>
            {formatCLP(p.row.balance_due_clp)}
          </Typography>
        ),
      },
      {
        field: "payment_status",
        headerName: "Estado",
        width: 110,
        renderCell: (p) => (
          <Chip
            size="small"
            color={STATUS_COLOR[p.row.payment_status]}
            label={STATUS_LABEL[p.row.payment_status]}
          />
        ),
      },
      {
        field: "actions",
        headerName: "",
        width: 60,
        sortable: false,
        filterable: false,
        renderCell: (p) => (
          <Tooltip title="Ver detalle / registrar pago">
            <IconButton size="small" onClick={() => setDetailId(p.row.id)}>
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [],
  );

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Cobranza
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Documentos con saldo pendiente: facturas, notas de venta y guías.
            Ordenadas por vencimiento; las vencidas primero.
          </Typography>
        </Box>
        <Tooltip title="Recargar">
          <IconButton onClick={load} disabled={loading}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      {stats && (
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <Card sx={{ flex: 1 }}>
            <CardContent>
              <Stack direction="row" spacing={1} alignItems="center">
                <PaidIcon color="primary" />
                <Typography variant="overline" color="text.secondary">
                  Total adeudado
                </Typography>
              </Stack>
              <Typography variant="h4" fontWeight={700}>
                {formatCLP(stats.total_due_clp)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {stats.open_count} documento(s) con saldo
              </Typography>
            </CardContent>
          </Card>
          <Card sx={{ flex: 1 }}>
            <CardContent>
              <Typography variant="overline" color="error.main">
                Vencido
              </Typography>
              <Typography variant="h5" fontWeight={700} color="error.main">
                {formatCLP(stats.overdue_total_clp)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {stats.overdue_count} documento(s) vencido(s)
              </Typography>
            </CardContent>
          </Card>
          <Card sx={{ flex: 1 }}>
            <CardContent>
              <Typography variant="overline" color="warning.main">
                Vence en 7 días
              </Typography>
              <Typography variant="h5" fontWeight={700}>
                {formatCLP(stats.due_within_7_clp)}
              </Typography>
            </CardContent>
          </Card>
          <Card sx={{ flex: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Vence en 30 días
              </Typography>
              <Typography variant="h5" fontWeight={700}>
                {formatCLP(stats.due_within_30_clp)}
              </Typography>
            </CardContent>
          </Card>
        </Stack>
      )}

      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <Autocomplete
          options={warehouses}
          getOptionLabel={(o) => `${o.code} · ${o.name}`}
          value={warehouses.find((w) => w.id === warehouseId) ?? null}
          onChange={(_, v) => setWarehouseId(v?.id ?? null)}
          renderInput={(p) => <TextField {...p} label="Bodega" size="small" />}
          sx={{ minWidth: 200 }}
        />
        <Autocomplete
          options={customers}
          getOptionLabel={(o) => `${o.razon_social}${o.rut ? ` · ${o.rut}` : ""}`}
          value={customers.find((c) => c.id === customerId) ?? null}
          onChange={(_, v) => setCustomerId(v?.id ?? null)}
          renderInput={(p) => <TextField {...p} label="Cliente" size="small" />}
          sx={{ minWidth: 280, flexGrow: 1 }}
        />
        <TextField
          select
          label="Estado"
          size="small"
          value={status}
          onChange={(e) => setStatus(e.target.value as PaymentStatus | "")}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">Todos</MenuItem>
          <MenuItem value="pending">Pendiente</MenuItem>
          <MenuItem value="partial">Parcial</MenuItem>
          <MenuItem value="overdue">Vencido</MenuItem>
        </TextField>
      </Stack>

      <Box sx={{ height: 540 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          rowCount={total}
          loading={loading}
          paginationMode="server"
          paginationModel={pagination}
          onPaginationModelChange={setPagination}
          pageSizeOptions={[25, 50, 100]}
          disableRowSelectionOnClick
          onRowDoubleClick={(p) => setDetailId(p.row.id)}
        />
      </Box>

      <DocumentDetailDrawer
        documentId={detailId}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        onChanged={load}
      />
    </Stack>
  );
}
