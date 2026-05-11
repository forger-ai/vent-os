import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Chip,
  FormControlLabel,
  IconButton,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import RefreshIcon from "@mui/icons-material/Refresh";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import TuneIcon from "@mui/icons-material/Tune";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { Button } from "@mui/material";
import { ApiError } from "../../api/client";
import {
  type StockLevelRow,
  listStockLevels,
} from "../../api/stock";
import { type WarehouseRow, listWarehouses } from "../../api/warehouses";
import { formatQty } from "../../util/format";
import StockAdjustDialog from "./StockAdjustDialog";
import TransferDialog from "./TransferDialog";
import CountDialog from "./CountDialog";

export default function StockTab() {
  const [rows, setRows] = useState<StockLevelRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adjustLevel, setAdjustLevel] = useState<StockLevelRow | null>(null);
  const [transferLevel, setTransferLevel] = useState<StockLevelRow | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [countOpen, setCountOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listStockLevels({
        q: query.trim() || undefined,
        warehouse_id: warehouseId ?? undefined,
        low_stock_only: lowStockOnly || undefined,
        limit: 500,
      });
      setRows(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el stock.");
    } finally {
      setLoading(false);
    }
  }, [query, warehouseId, lowStockOnly]);

  useEffect(() => {
    listWarehouses(false)
      .then(setWarehouses)
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const columns: GridColDef<StockLevelRow>[] = useMemo(
    () => [
      {
        field: "variant_display",
        headerName: "Variante",
        flex: 1.5,
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
        field: "warehouse",
        headerName: "Bodega",
        width: 200,
        renderCell: (p) => (
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip size="small" label={p.row.warehouse_code} variant="outlined" />
            <Typography variant="body2">{p.row.warehouse_name}</Typography>
          </Stack>
        ),
      },
      {
        field: "qty",
        headerName: "Stock",
        width: 130,
        align: "right",
        headerAlign: "right",
        renderCell: (p) =>
          p.row.low_stock ? (
            <Chip size="small" color="error" label={formatQty(p.row.qty)} />
          ) : (
            <Typography variant="body2">{formatQty(p.row.qty)}</Typography>
          ),
      },
      {
        field: "stock_min",
        headerName: "Mínimo",
        width: 100,
        align: "right",
        headerAlign: "right",
        renderCell: (p) => formatQty(p.row.stock_min),
      },
      {
        field: "tracks_batches",
        headerName: "Lotes",
        width: 90,
        renderCell: (p) =>
          p.row.tracks_batches ? (
            <Chip size="small" label="Si" color="warning" variant="outlined" />
          ) : (
            <Typography variant="caption" color="text.secondary">—</Typography>
          ),
      },
      {
        field: "actions",
        headerName: "",
        width: 130,
        sortable: false,
        filterable: false,
        renderCell: (p) => (
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Ajustar stock">
              <IconButton size="small" onClick={() => setAdjustLevel(p.row)}>
                <TuneIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Transferir a otra bodega">
              <IconButton
                size="small"
                onClick={() => {
                  setTransferLevel(p.row);
                  setTransferOpen(true);
                }}
              >
                <SwapHorizIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        ),
      },
    ],
    [],
  );

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="center">
        <TextField
          label="Buscar"
          placeholder="SKU, nombre o código de barras"
          size="small"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ minWidth: 280, flexGrow: 1 }}
        />
        <Autocomplete
          options={warehouses}
          getOptionLabel={(o) => `${o.code} · ${o.name}`}
          value={warehouses.find((w) => w.id === warehouseId) ?? null}
          onChange={(_, v) => setWarehouseId(v?.id ?? null)}
          renderInput={(p) => <TextField {...p} label="Bodega" size="small" />}
          sx={{ minWidth: 240 }}
        />
        <FormControlLabel
          control={
            <Switch
              checked={lowStockOnly}
              onChange={(e) => setLowStockOnly(e.target.checked)}
            />
          }
          label="Solo stock bajo"
        />
        <Tooltip title="Recargar">
          <IconButton onClick={load} disabled={loading}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      <Stack direction="row" spacing={1}>
        <Button
          variant="outlined"
          startIcon={<SwapHorizIcon />}
          onClick={() => {
            setTransferLevel(null);
            setTransferOpen(true);
          }}
        >
          Transferir entre bodegas
        </Button>
        <Button
          variant="outlined"
          startIcon={<FactCheckIcon />}
          onClick={() => setCountOpen(true)}
        >
          Conteo fisico
        </Button>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Box sx={{ height: 540 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          loading={loading}
          disableRowSelectionOnClick
          getRowId={(r) => r.id}
          pageSizeOptions={[25, 50, 100]}
          initialState={{ pagination: { paginationModel: { pageSize: 50, page: 0 } } }}
        />
      </Box>

      <StockAdjustDialog
        open={adjustLevel !== null}
        level={adjustLevel}
        onClose={() => setAdjustLevel(null)}
        onSaved={() => {
          setAdjustLevel(null);
          setToast("Stock ajustado.");
          load();
        }}
      />

      <TransferDialog
        open={transferOpen}
        initialLevel={transferLevel}
        onClose={() => {
          setTransferOpen(false);
          setTransferLevel(null);
        }}
        onSaved={() => {
          setTransferOpen(false);
          setTransferLevel(null);
          setToast("Transferencia completada.");
          load();
        }}
      />

      <CountDialog
        open={countOpen}
        onClose={() => setCountOpen(false)}
        onApplied={() => {
          setToast("Conteo aplicado.");
          load();
        }}
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
