import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  MenuItem,
  Snackbar,
  Stack,
  Switch,
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
import {
  type ListProductsParams,
  type ProductDetail,
  type ProductPage,
  type ProductRow,
  type ProductType,
  deactivateProduct,
  getProduct,
  listBrands,
  listCategories,
  listProducts,
} from "../api/products";
import { ApiError } from "../api/client";
import ProductDialog from "./productos/ProductDialog";

const PAGE_SIZE_OPTIONS = [25, 50, 100];

type SortField = NonNullable<ListProductsParams["sort"]>;

const SORT_FIELD_BY_COLUMN: Record<string, SortField> = {
  sku: "sku",
  name: "name",
  category: "category",
  brand: "brand",
  price_clp: "price",
  stock_qty: "stock",
};

const formatCLP = (value: number): string =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(value);

export default function ProductosPage() {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [brand, setBrand] = useState<string | null>(null);
  const [productType, setProductType] = useState<ProductType | "">("");
  const [showInactive, setShowInactive] = useState(false);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [pagination, setPagination] = useState<GridPaginationModel>({
    page: 0,
    pageSize: 25,
  });
  const [sortModel, setSortModel] = useState<GridSortModel>([
    { field: "name", sort: "asc" },
  ]);

  const [categories, setCategories] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProductDetail | null>(null);

  const refreshFilters = useCallback(async () => {
    try {
      const [cats, brs] = await Promise.all([listCategories(), listBrands()]);
      setCategories(cats);
      setBrands(brs);
    } catch {
      // filtros opcionales — no bloquean la pantalla
    }
  }, []);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sortEntry = sortModel[0];
      const sort: SortField | undefined = sortEntry
        ? SORT_FIELD_BY_COLUMN[sortEntry.field]
        : undefined;

      const params: ListProductsParams = {
        q: query.trim() || undefined,
        category: category ?? undefined,
        brand: brand ?? undefined,
        product_type: productType || undefined,
        is_active: showInactive ? undefined : true,
        low_stock_only: lowStockOnly || undefined,
        sort,
        order: sortEntry?.sort === "desc" ? "desc" : "asc",
        limit: pagination.pageSize,
        offset: pagination.page * pagination.pageSize,
      };
      const page: ProductPage = await listProducts(params);
      setRows(page.items);
      setTotal(page.total);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("No se pudieron cargar los productos.");
      }
    } finally {
      setLoading(false);
    }
  }, [
    query,
    category,
    brand,
    productType,
    showInactive,
    lowStockOnly,
    pagination,
    sortModel,
  ]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  useEffect(() => {
    refreshFilters();
  }, [refreshFilters]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = async (id: string) => {
    try {
      const detail = await getProduct(id);
      setEditing(detail);
      setDialogOpen(true);
    } catch {
      setError("No se pudo cargar el producto.");
    }
  };

  const handleSaved = (saved: ProductDetail) => {
    setDialogOpen(false);
    setEditing(null);
    setToast(`Producto ${saved.sku} guardado.`);
    fetchPage();
    refreshFilters();
  };

  const handleDeactivate = async (row: ProductRow) => {
    if (!confirm(`Desactivar "${row.name}"? Quedara oculto pero su historico se conserva.`)) {
      return;
    }
    try {
      await deactivateProduct(row.id);
      setToast(`${row.sku} desactivado.`);
      fetchPage();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo desactivar.");
    }
  };

  const columns: GridColDef<ProductRow>[] = useMemo(
    () => [
      {
        field: "sku",
        headerName: "SKU",
        width: 130,
        sortable: true,
      },
      {
        field: "name",
        headerName: "Nombre",
        flex: 1.5,
        minWidth: 200,
        sortable: true,
        renderCell: (params) => (
          <Stack direction="row" alignItems="center" spacing={1} sx={{ width: "100%" }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
              {params.row.name}
            </Typography>
            {params.row.product_type === "service" && (
              <Chip label="Servicio" size="small" variant="outlined" />
            )}
            {!params.row.is_active && (
              <Chip label="Inactivo" size="small" color="default" />
            )}
          </Stack>
        ),
      },
      {
        field: "category",
        headerName: "Categoria",
        width: 140,
        sortable: true,
        valueGetter: (_, row) => row.category ?? "—",
      },
      {
        field: "brand",
        headerName: "Marca",
        width: 130,
        sortable: true,
        valueGetter: (_, row) => row.brand ?? "—",
      },
      {
        field: "price_clp",
        headerName: "Precio",
        width: 120,
        sortable: true,
        align: "right",
        headerAlign: "right",
        valueFormatter: (value: number) => formatCLP(value),
      },
      {
        field: "stock_qty",
        headerName: "Stock",
        width: 110,
        sortable: true,
        align: "right",
        headerAlign: "right",
        renderCell: (params) => {
          if (params.row.product_type === "service") {
            return <Typography variant="body2" color="text.secondary">—</Typography>;
          }
          const value = `${params.row.stock_qty} ${params.row.unit}`;
          return params.row.low_stock ? (
            <Chip label={value} color="error" size="small" />
          ) : (
            <Typography variant="body2">{value}</Typography>
          );
        },
      },
      {
        field: "iva_affected",
        headerName: "IVA",
        width: 80,
        sortable: false,
        renderCell: (params) =>
          params.row.iva_affected ? (
            <Chip label="Afecto" size="small" variant="outlined" />
          ) : (
            <Chip label="Exento" size="small" variant="outlined" color="warning" />
          ),
      },
      {
        field: "actions",
        headerName: "",
        width: 110,
        sortable: false,
        filterable: false,
        renderCell: (params) => (
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Editar">
              <IconButton size="small" onClick={() => openEdit(params.row.id)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {params.row.is_active && (
              <Tooltip title="Desactivar">
                <IconButton
                  size="small"
                  onClick={() => handleDeactivate(params.row)}
                  color="error"
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        ),
      },
    ],
    [],
  );

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Productos
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Catalogo con SKU, codigo de barras, precio, costo, IVA y stock.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Tooltip title="Recargar">
            <IconButton onClick={fetchPage} disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Nuevo producto
          </Button>
        </Stack>
      </Stack>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="center">
        <TextField
          label="Buscar"
          placeholder="SKU, nombre o codigo de barras"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPagination((prev) => ({ ...prev, page: 0 }));
          }}
          size="small"
          sx={{ minWidth: 280, flexGrow: 1 }}
        />
        <Autocomplete
          options={categories}
          value={category}
          onChange={(_, value) => {
            setCategory(value);
            setPagination((prev) => ({ ...prev, page: 0 }));
          }}
          renderInput={(params) => (
            <TextField {...params} label="Categoria" size="small" sx={{ minWidth: 160 }} />
          )}
          sx={{ minWidth: 180 }}
        />
        <Autocomplete
          options={brands}
          value={brand}
          onChange={(_, value) => {
            setBrand(value);
            setPagination((prev) => ({ ...prev, page: 0 }));
          }}
          renderInput={(params) => (
            <TextField {...params} label="Marca" size="small" sx={{ minWidth: 160 }} />
          )}
          sx={{ minWidth: 180 }}
        />
        <TextField
          select
          label="Tipo"
          size="small"
          value={productType}
          onChange={(e) => {
            setProductType(e.target.value as ProductType | "");
            setPagination((prev) => ({ ...prev, page: 0 }));
          }}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="">Todos</MenuItem>
          <MenuItem value="product">Producto</MenuItem>
          <MenuItem value="service">Servicio</MenuItem>
        </TextField>
      </Stack>

      <Stack direction="row" spacing={3} alignItems="center">
        <FormControlLabel
          control={
            <Switch
              checked={showInactive}
              onChange={(e) => {
                setShowInactive(e.target.checked);
                setPagination((prev) => ({ ...prev, page: 0 }));
              }}
            />
          }
          label="Incluir inactivos"
        />
        <FormControlLabel
          control={
            <Switch
              checked={lowStockOnly}
              onChange={(e) => {
                setLowStockOnly(e.target.checked);
                setPagination((prev) => ({ ...prev, page: 0 }));
              }}
            />
          }
          label="Solo stock bajo"
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
          sortingMode="server"
          paginationModel={pagination}
          onPaginationModelChange={setPagination}
          sortModel={sortModel}
          onSortModelChange={setSortModel}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          disableRowSelectionOnClick
          onRowDoubleClick={(params) => openEdit(params.row.id)}
        />
      </Box>

      <ProductDialog
        open={dialogOpen}
        initial={editing}
        categories={categories}
        brands={brands}
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
