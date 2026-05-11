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
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  DataGrid,
  type GridColDef,
  type GridPaginationModel,
} from "@mui/x-data-grid";
import { ApiError } from "../api/client";
import {
  type DocumentRow,
  type DocumentStatus,
  type DocumentType,
  type ListDocumentsParams,
  listDocuments,
} from "../api/documents";
import { type WarehouseRow, listWarehouses } from "../api/warehouses";
import { formatCLP } from "../util/format";
import DocumentDetailDrawer from "./documentos/DocumentDetailDrawer";

const TYPE_LABEL: Record<DocumentType, string> = {
  boleta: "Boleta",
  factura: "Factura",
  nota_venta: "Nota de venta",
  nota_credito: "Nota de credito",
  cotizacion: "Cotizacion",
};

const STATUS_COLOR: Record<DocumentStatus, "success" | "default" | "error"> = {
  issued: "success",
  draft: "default",
  cancelled: "error",
};

const STATUS_LABEL: Record<DocumentStatus, string> = {
  issued: "Emitido",
  draft: "Borrador",
  cancelled: "Anulado",
};

export default function DocumentosPage() {
  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [docType, setDocType] = useState<DocumentType | "">("");
  const [status, setStatus] = useState<DocumentStatus | "">("");
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [issuedFrom, setIssuedFrom] = useState<string>("");
  const [issuedTo, setIssuedTo] = useState<string>("");
  const [pagination, setPagination] = useState<GridPaginationModel>({
    page: 0,
    pageSize: 25,
  });
  const [detailId, setDetailId] = useState<string | null>(null);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: ListDocumentsParams = {
        q: query.trim() || undefined,
        document_type: docType || undefined,
        status: status || undefined,
        warehouse_id: warehouseId ?? undefined,
        issued_from: issuedFrom || undefined,
        issued_to: issuedTo || undefined,
        limit: pagination.pageSize,
        offset: pagination.page * pagination.pageSize,
        order: "desc",
      };
      const page = await listDocuments(params);
      setRows(page.items);
      setTotal(page.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los documentos.");
    } finally {
      setLoading(false);
    }
  }, [query, docType, status, warehouseId, issuedFrom, issuedTo, pagination]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  useEffect(() => {
    listWarehouses(false)
      .then(setWarehouses)
      .catch(() => {});
  }, []);

  const columns: GridColDef<DocumentRow>[] = useMemo(
    () => [
      {
        field: "issued_at",
        headerName: "Fecha",
        width: 110,
        valueGetter: (_, row) => row.issued_at,
      },
      {
        field: "document_type",
        headerName: "Tipo",
        width: 140,
        renderCell: (p) => (
          <Chip
            size="small"
            label={TYPE_LABEL[p.row.document_type]}
            color={
              p.row.document_type === "nota_credito"
                ? "warning"
                : p.row.document_type === "factura"
                ? "primary"
                : p.row.document_type === "cotizacion"
                ? "info"
                : "default"
            }
            variant={
              p.row.document_type === "nota_credito" ||
              p.row.document_type === "cotizacion"
                ? "filled"
                : "outlined"
            }
          />
        ),
      },
      {
        field: "folio",
        headerName: "Folio",
        width: 90,
        align: "right",
        headerAlign: "right",
      },
      {
        field: "customer_name",
        headerName: "Cliente",
        flex: 1.4,
        minWidth: 200,
        valueGetter: (_, row) => row.customer_name ?? "Consumidor final",
      },
      {
        field: "warehouse_code",
        headerName: "Bodega",
        width: 100,
        renderCell: (p) =>
          p.row.warehouse_code ? (
            <Chip size="small" label={p.row.warehouse_code} variant="outlined" />
          ) : (
            "—"
          ),
      },
      {
        field: "items_count",
        headerName: "Items",
        width: 80,
        align: "right",
        headerAlign: "right",
      },
      {
        field: "total_clp",
        headerName: "Total",
        width: 130,
        align: "right",
        headerAlign: "right",
        renderCell: (p) => formatCLP(p.row.total_clp),
      },
      {
        field: "status",
        headerName: "Estado",
        width: 110,
        renderCell: (p) => (
          <Chip
            size="small"
            color={STATUS_COLOR[p.row.status]}
            label={STATUS_LABEL[p.row.status] ?? p.row.status}
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
          <Tooltip title="Ver detalle">
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
            Documentos
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Boletas, facturas y notas de venta emitidas. Se registran con folio
            interno; esta version no emite electronicamente al SII.
          </Typography>
        </Box>
        <Tooltip title="Recargar">
          <IconButton onClick={fetchPage} disabled={loading}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <TextField
          label="Buscar"
          placeholder="Folio, cliente o RUT"
          size="small"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ minWidth: 240, flexGrow: 1 }}
        />
        <TextField
          select
          label="Tipo"
          size="small"
          value={docType}
          onChange={(e) => setDocType(e.target.value as DocumentType | "")}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">Todos</MenuItem>
          <MenuItem value="boleta">Boleta</MenuItem>
          <MenuItem value="factura">Factura</MenuItem>
          <MenuItem value="nota_venta">Nota de venta</MenuItem>
          <MenuItem value="nota_credito">Nota de credito</MenuItem>
          <MenuItem value="cotizacion">Cotizacion</MenuItem>
        </TextField>
        <TextField
          select
          label="Estado"
          size="small"
          value={status}
          onChange={(e) => setStatus(e.target.value as DocumentStatus | "")}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="">Todos</MenuItem>
          <MenuItem value="issued">Emitido</MenuItem>
          <MenuItem value="cancelled">Anulado</MenuItem>
        </TextField>
        <Autocomplete
          options={warehouses}
          getOptionLabel={(o) => `${o.code} · ${o.name}`}
          value={warehouses.find((w) => w.id === warehouseId) ?? null}
          onChange={(_, v) => setWarehouseId(v?.id ?? null)}
          renderInput={(p) => <TextField {...p} label="Bodega" size="small" />}
          sx={{ minWidth: 200 }}
        />
      </Stack>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <TextField
          label="Desde"
          type="date"
          size="small"
          value={issuedFrom}
          onChange={(e) => setIssuedFrom(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ minWidth: 160 }}
        />
        <TextField
          label="Hasta"
          type="date"
          size="small"
          value={issuedTo}
          onChange={(e) => setIssuedTo(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ minWidth: 160 }}
        />
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Box sx={{ height: 560 }}>
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
        onChanged={fetchPage}
      />
    </Stack>
  );
}
