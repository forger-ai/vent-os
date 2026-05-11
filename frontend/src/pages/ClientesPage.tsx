import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  DataGrid,
  type GridColDef,
  type GridPaginationModel,
  type GridSortModel,
} from "@mui/x-data-grid";
import { ApiError } from "../api/client";
import {
  type CustomerDocumentType,
  type CustomerRow,
  type ListCustomersParams,
  deleteCustomer,
  listCustomers,
} from "../api/customers";
import ClientDialog from "./clientes/ClientDialog";

type SortField = NonNullable<ListCustomersParams["sort"]>;

const SORT_BY_COLUMN: Record<string, SortField> = {
  razon_social: "razon_social",
  rut: "rut",
  comuna: "comuna",
  ciudad: "ciudad",
};

export default function ClientesPage() {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [docType, setDocType] = useState<CustomerDocumentType | "">("");
  const [pagination, setPagination] = useState<GridPaginationModel>({
    page: 0,
    pageSize: 25,
  });
  const [sortModel, setSortModel] = useState<GridSortModel>([
    { field: "razon_social", sort: "asc" },
  ]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sortEntry = sortModel[0];
      const sort: SortField | undefined = sortEntry
        ? SORT_BY_COLUMN[sortEntry.field]
        : undefined;

      const page = await listCustomers({
        q: query.trim() || undefined,
        default_document_type: docType || undefined,
        sort,
        order: sortEntry?.sort === "desc" ? "desc" : "asc",
        limit: pagination.pageSize,
        offset: pagination.page * pagination.pageSize,
      });
      setRows(page.items);
      setTotal(page.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los clientes.");
    } finally {
      setLoading(false);
    }
  }, [query, docType, pagination, sortModel]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  const handleSaved = (saved: CustomerRow) => {
    setDialogOpen(false);
    setEditing(null);
    setToast(`Cliente "${saved.razon_social}" guardado.`);
    fetchPage();
  };

  const handleDelete = async (row: CustomerRow) => {
    if (
      !confirm(
        `Eliminar a "${row.razon_social}"? Los documentos historicos se conservan sin asociar.`,
      )
    ) {
      return;
    }
    try {
      await deleteCustomer(row.id);
      setToast(`${row.razon_social} eliminado.`);
      fetchPage();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo eliminar.");
    }
  };

  const columns: GridColDef<CustomerRow>[] = useMemo(
    () => [
      {
        field: "razon_social",
        headerName: "Razon social",
        flex: 1.5,
        minWidth: 240,
        renderCell: (p) => (
          <Stack>
            <Typography variant="body2" fontWeight={500}>
              {p.row.razon_social}
            </Typography>
            {p.row.giro && (
              <Typography variant="caption" color="text.secondary">
                {p.row.giro}
              </Typography>
            )}
          </Stack>
        ),
      },
      {
        field: "rut",
        headerName: "RUT",
        width: 140,
        valueGetter: (_, row) => row.rut ?? "—",
      },
      {
        field: "default_document_type",
        headerName: "Documento",
        width: 110,
        renderCell: (p) => (
          <Chip
            size="small"
            label={p.row.default_document_type === "factura" ? "Factura" : "Boleta"}
            color={p.row.default_document_type === "factura" ? "primary" : "default"}
            variant="outlined"
          />
        ),
      },
      {
        field: "comuna",
        headerName: "Comuna",
        width: 140,
        valueGetter: (_, row) => row.comuna ?? "—",
      },
      {
        field: "phone",
        headerName: "Telefono",
        width: 140,
        valueGetter: (_, row) => row.phone ?? "—",
      },
      {
        field: "documents_count",
        headerName: "Docs",
        width: 80,
        align: "right",
        headerAlign: "right",
      },
      {
        field: "actions",
        headerName: "",
        width: 110,
        sortable: false,
        filterable: false,
        renderCell: (p) => (
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Editar">
              <IconButton
                size="small"
                onClick={() => {
                  setEditing(p.row);
                  setDialogOpen(true);
                }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Eliminar">
              <IconButton size="small" color="error" onClick={() => handleDelete(p.row)}>
                <DeleteOutlineIcon fontSize="small" />
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
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Clientes
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Ficha de clientes con RUT, razon social, giro y documento por defecto.
            Los con default "Factura" requieren RUT.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Tooltip title="Recargar">
            <IconButton onClick={fetchPage} disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            Nuevo cliente
          </Button>
        </Stack>
      </Stack>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <TextField
          label="Buscar"
          placeholder="Razon social, RUT o email"
          size="small"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ minWidth: 280, flexGrow: 1 }}
        />
        <TextField
          select
          label="Documento por defecto"
          size="small"
          value={docType}
          onChange={(e) => setDocType(e.target.value as CustomerDocumentType | "")}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">Todos</MenuItem>
          <MenuItem value="boleta">Boleta</MenuItem>
          <MenuItem value="factura">Factura</MenuItem>
        </TextField>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Box sx={{ height: 560 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          rowCount={total}
          loading={loading}
          paginationMode="server"
          sortingMode="server"
          paginationModel={pagination}
          onPaginationModelChange={setPagination}
          sortModel={sortModel}
          onSortModelChange={setSortModel}
          pageSizeOptions={[25, 50, 100]}
          disableRowSelectionOnClick
          onRowDoubleClick={(p) => {
            setEditing(p.row);
            setDialogOpen(true);
          }}
        />
      </Box>

      <ClientDialog
        open={dialogOpen}
        initial={editing}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
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
