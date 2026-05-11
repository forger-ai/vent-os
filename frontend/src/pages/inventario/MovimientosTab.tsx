import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Chip,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  DataGrid,
  type GridColDef,
  type GridPaginationModel,
} from "@mui/x-data-grid";
import { ApiError } from "../../api/client";
import {
  type ListMovementsParams,
  type MovementRow,
  type StockMovementKind,
  listMovements,
} from "../../api/stock";
import { type WarehouseRow, listWarehouses } from "../../api/warehouses";
import { formatQty } from "../../util/format";

const KIND_COLORS: Record<StockMovementKind, "success" | "error" | "info"> = {
  entrada: "success",
  salida: "error",
  ajuste: "info",
};

export default function MovimientosTab() {
  const [rows, setRows] = useState<MovementRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [kind, setKind] = useState<StockMovementKind | "">("");
  const [pagination, setPagination] = useState<GridPaginationModel>({
    page: 0,
    pageSize: 50,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: ListMovementsParams = {
        warehouse_id: warehouseId ?? undefined,
        kind: kind || undefined,
        limit: pagination.pageSize,
        offset: pagination.page * pagination.pageSize,
        order: "desc",
      };
      const page = await listMovements(params);
      setRows(page.items);
      setTotal(page.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el historial.");
    } finally {
      setLoading(false);
    }
  }, [warehouseId, kind, pagination]);

  useEffect(() => {
    listWarehouses(false)
      .then(setWarehouses)
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const columns: GridColDef<MovementRow>[] = useMemo(
    () => [
      {
        field: "occurred_at",
        headerName: "Fecha",
        width: 170,
        renderCell: (p) =>
          new Date(p.row.occurred_at).toLocaleString("es-CL", { hour12: false }),
      },
      {
        field: "kind",
        headerName: "Tipo",
        width: 110,
        renderCell: (p) => (
          <Chip size="small" label={p.row.kind} color={KIND_COLORS[p.row.kind]} />
        ),
      },
      {
        field: "variant_display",
        headerName: "Variante",
        flex: 1.4,
        minWidth: 220,
        renderCell: (p) => (
          <Stack>
            <Typography variant="body2" fontWeight={500} noWrap>
              {p.row.variant_display}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              SKU {p.row.variant_sku}
            </Typography>
          </Stack>
        ),
      },
      {
        field: "warehouse_code",
        headerName: "Bodega",
        width: 100,
        renderCell: (p) => <Chip size="small" label={p.row.warehouse_code} variant="outlined" />,
      },
      {
        field: "lot_number",
        headerName: "Lote",
        width: 120,
        valueGetter: (_, row) => row.lot_number ?? "—",
      },
      {
        field: "quantity",
        headerName: "Delta",
        width: 100,
        align: "right",
        headerAlign: "right",
        renderCell: (p) => {
          const v = p.row.quantity;
          const color = v > 0 ? "success.main" : v < 0 ? "error.main" : "text.primary";
          return (
            <Typography variant="body2" fontWeight={500} color={color}>
              {v > 0 ? "+" : ""}
              {formatQty(v)}
            </Typography>
          );
        },
      },
      {
        field: "qty_after",
        headerName: "Stock después",
        width: 130,
        align: "right",
        headerAlign: "right",
        renderCell: (p) => formatQty(p.row.qty_after),
      },
      {
        field: "reason",
        headerName: "Motivo",
        flex: 1,
        minWidth: 160,
        valueGetter: (_, row) => row.reason ?? "—",
      },
    ],
    [],
  );

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="center">
        <Autocomplete
          options={warehouses}
          getOptionLabel={(o) => `${o.code} · ${o.name}`}
          value={warehouses.find((w) => w.id === warehouseId) ?? null}
          onChange={(_, v) => setWarehouseId(v?.id ?? null)}
          renderInput={(p) => <TextField {...p} label="Bodega" size="small" />}
          sx={{ minWidth: 240 }}
        />
        <TextField
          select
          label="Tipo"
          size="small"
          value={kind}
          onChange={(e) => setKind(e.target.value as StockMovementKind | "")}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">Todos</MenuItem>
          <MenuItem value="entrada">Entrada</MenuItem>
          <MenuItem value="salida">Salida</MenuItem>
          <MenuItem value="ajuste">Ajuste</MenuItem>
        </TextField>
        <Tooltip title="Recargar">
          <IconButton onClick={load} disabled={loading}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Box sx={{ height: 540 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          rowCount={total}
          loading={loading}
          paginationMode="server"
          paginationModel={pagination}
          onPaginationModelChange={setPagination}
          disableRowSelectionOnClick
          pageSizeOptions={[25, 50, 100]}
        />
      </Box>
    </Stack>
  );
}
