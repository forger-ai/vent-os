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
import DownloadIcon from "@mui/icons-material/Download";
import EditIcon from "@mui/icons-material/Edit";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RefreshIcon from "@mui/icons-material/Refresh";
import UploadIcon from "@mui/icons-material/Upload";
import {
  DataGrid,
  type GridColDef,
  type GridPaginationModel,
  type GridSortModel,
} from "@mui/x-data-grid";
import { ApiError } from "../api/client";
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
import { downloadProductsCsv } from "../api/csv";
import { formatCLPRange, formatQty } from "../util/format";
import ProductDialog from "./productos/ProductDialog";
import ProductDetailDrawer from "./productos/ProductDetailDrawer";
import CsvImportDialog from "./productos/CsvImportDialog";

const PAGE_SIZE_OPTIONS = [25, 50, 100];

type SortField = NonNullable<ListProductsParams["sort"]>;

const SORT_FIELD_BY_COLUMN: Record<string, SortField> = {
  name: "name",
  category: "category",
  brand: "brand",
};

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

  const [detailId, setDetailId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

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

  const openDetail = (id: string) => {
    setDetailId(id);
    setDrawerOpen(true);
  };

  const handleSaved = (saved: ProductDetail) => {
    setDialogOpen(false);
    setEditing(null);
    setToast(`Producto "${saved.name}" guardado.`);
    fetchPage();
    refreshFilters();
  };

  const handleDeactivate = async (row: ProductRow) => {
    if (
      !confirm(
        `Desactivar "${row.name}" y todas sus variantes? Los historicos se conservan.`,
      )
    ) {
      return;
    }
    try {
      await deactivateProduct(row.id);
      setToast(`"${row.name}" desactivado.`);
      fetchPage();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo desactivar.");
    }
  };

  const columns: GridColDef<ProductRow>[] = useMemo(
    () => [
      {
        field: "name",
        headerName: "Producto",
        flex: 1.5,
        minWidth: 240,
        sortable: true,
        renderCell: (params) => (
          <Stack direction="row" alignItems="center" spacing={1} sx={{ width: "100%" }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
              {params.row.name}
            </Typography>
            {params.row.tracks_batches && (
              <Tooltip title="Maneja lotes y vencimientos">
                <Chip size="small" label="Lotes" color="warning" variant="outlined" />
              </Tooltip>
            )}
            {params.row.product_type === "service" && (
              <Chip size="small" label="Servicio" variant="outlined" />
            )}
            {!params.row.is_active && (
              <Chip size="small" label="Inactivo" color="default" />
            )}
          </Stack>
        ),
      },
      {
        field: "category",
        headerName: "Categoría",
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
        field: "variant_count",
        headerName: "Variantes",
        width: 110,
        sortable: false,
        align: "right",
        headerAlign: "right",
      },
      {
        field: "price_range",
        headerName: "Precio",
        width: 160,
        sortable: false,
        align: "right",
        headerAlign: "right",
        renderCell: (params) =>
          formatCLPRange(params.row.min_price_clp, params.row.max_price_clp),
      },
      {
        field: "total_stock_qty",
        headerName: "Stock total",
        width: 130,
        sortable: false,
        align: "right",
        headerAlign: "right",
        renderCell: (params) => {
          if (params.row.product_type === "service") {
            return <Typography variant="body2" color="text.secondary">—</Typography>;
          }
          const text = formatQty(params.row.total_stock_qty, params.row.unit);
          return params.row.low_stock ? (
            <Chip label={text} color="error" size="small" />
          ) : (
            <Typography variant="body2">{text}</Typography>
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
        width: 140,
        sortable: false,
        filterable: false,
        renderCell: (params) => (
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Variantes y stock">
              <IconButton size="small" onClick={() => openDetail(params.row.id)}>
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Editar producto">
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
            Cada producto puede tener una o varias variantes (talla, color, etc.) con su
            propio SKU, precio y stock por bodega.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Tooltip title="Recargar">
            <IconButton onClick={fetchPage} disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            disabled={exporting}
            onClick={async () => {
              setExporting(true);
              try {
                await downloadProductsCsv(showInactive);
              } catch {
                setError("No se pudo exportar el catálogo.");
              } finally {
                setExporting(false);
              }
            }}
          >
            Exportar CSV
          </Button>
          <Button
            variant="outlined"
            startIcon={<UploadIcon />}
            onClick={() => setCsvImportOpen(true)}
          >
            Importar CSV
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Nuevo producto
          </Button>
        </Stack>
      </Stack>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="center">
        <TextField
          label="Buscar"
          placeholder="Nombre, SKU o código de barras"
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
            <TextField {...params} label="Categoría" size="small" sx={{ minWidth: 160 }} />
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
          onRowDoubleClick={(params) => openDetail(params.row.id)}
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

      <ProductDetailDrawer
        productId={detailId}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
        }}
        onChanged={() => {
          fetchPage();
          refreshFilters();
        }}
      />

      <CsvImportDialog
        open={csvImportOpen}
        onClose={() => setCsvImportOpen(false)}
        onImported={() => {
          setToast("Catálogo actualizado desde CSV.");
          fetchPage();
          refreshFilters();
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
