import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import { ApiError } from "../../api/client";
import { type ProductDetail, getProduct } from "../../api/products";
import { type VariantRow, deactivateVariant, listVariants } from "../../api/variants";
import { type StockLevelRow, stockByVariant } from "../../api/stock";
import { formatCLP, formatQty, formatVariantTitle } from "../../util/format";
import VariantDialog from "./VariantDialog";

interface ProductDetailDrawerProps {
  productId: string | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

type TabKey = "variantes" | "stock";

export default function ProductDetailDrawer({
  productId,
  open,
  onClose,
  onChanged,
}: ProductDetailDrawerProps) {
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [stockRows, setStockRows] = useState<Record<string, StockLevelRow[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("variantes");
  const [variantDialogOpen, setVariantDialogOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<VariantRow | null>(null);

  const load = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    setError(null);
    try {
      const [p, vs] = await Promise.all([
        getProduct(productId),
        listVariants(productId, true),
      ]);
      setProduct(p);
      setVariants(vs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el producto.");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    if (open && productId) {
      load();
      setTab("variantes");
    }
  }, [open, productId, load]);

  useEffect(() => {
    if (tab !== "stock") return;
    const fetchAll = async () => {
      const next: Record<string, StockLevelRow[]> = {};
      for (const v of variants) {
        try {
          next[v.id] = await stockByVariant(v.id);
        } catch {
          next[v.id] = [];
        }
      }
      setStockRows(next);
    };
    fetchAll();
  }, [tab, variants]);

  const handleVariantSaved = () => {
    setVariantDialogOpen(false);
    setEditingVariant(null);
    load();
    onChanged();
  };

  const handleDeactivateVariant = async (v: VariantRow) => {
    if (!confirm(`Desactivar variante ${v.sku}?`)) return;
    try {
      await deactivateVariant(v.id);
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo desactivar la variante.");
    }
  };

  if (!productId) return null;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: "100%", md: 720 } } } }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <Box sx={{ p: 2, display: "flex", alignItems: "center", gap: 1 }}>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6" fontWeight={700}>
              {product?.name ?? "..."}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" mt={0.5}>
              {product?.category && (
                <Chip size="small" label={product.category} variant="outlined" />
              )}
              {product?.brand && (
                <Chip size="small" label={product.brand} variant="outlined" />
              )}
              {product?.product_type === "service" && (
                <Chip size="small" label="Servicio" />
              )}
              {product?.tracks_batches && (
                <Chip size="small" label="Lotes" color="warning" variant="outlined" />
              )}
              {!product?.is_active && (
                <Chip size="small" label="Inactivo" color="default" />
              )}
            </Stack>
          </Box>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
        <Divider />

        <Tabs value={tab} onChange={(_, v) => setTab(v as TabKey)} sx={{ px: 2 }}>
          <Tab value="variantes" label={`Variantes (${variants.length})`} />
          <Tab value="stock" label="Stock por bodega" />
        </Tabs>
        <Divider />

        <Box sx={{ flexGrow: 1, overflow: "auto", p: 2 }}>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {loading && (
            <Stack alignItems="center" sx={{ py: 4 }}>
              <CircularProgress size={24} />
            </Stack>
          )}

          {!loading && tab === "variantes" && product && (
            <Stack spacing={2}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="subtitle2" color="text.secondary">
                  Cada variante es un item vendible con su propio SKU, precio y stock.
                </Typography>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => {
                    setEditingVariant(null);
                    setVariantDialogOpen(true);
                  }}
                >
                  Nueva variante
                </Button>
              </Stack>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>SKU</TableCell>
                    <TableCell>Atributos</TableCell>
                    <TableCell align="right">Precio</TableCell>
                    <TableCell align="right">Stock</TableCell>
                    <TableCell align="right">Min</TableCell>
                    <TableCell></TableCell>
                    <TableCell width={80}></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {variants.map((v) => (
                    <TableRow key={v.id} sx={{ opacity: v.is_active ? 1 : 0.5 }}>
                      <TableCell>
                        <Typography variant="body2" fontWeight={500}>
                          {v.sku}
                        </Typography>
                        {v.barcode && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {v.barcode}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {v.attributes.length === 0 ? (
                          <Typography variant="caption" color="text.secondary">—</Typography>
                        ) : (
                          <Stack direction="row" spacing={0.5} flexWrap="wrap" gap={0.5}>
                            {v.attributes.map((a) => (
                              <Chip
                                key={`${v.id}-${a.name}`}
                                size="small"
                                label={`${a.name}: ${a.value}`}
                                variant="outlined"
                              />
                            ))}
                          </Stack>
                        )}
                      </TableCell>
                      <TableCell align="right">{formatCLP(v.price_clp)}</TableCell>
                      <TableCell align="right">
                        {product.product_type === "service" ? (
                          "—"
                        ) : v.low_stock ? (
                          <Chip
                            size="small"
                            color="error"
                            label={formatQty(v.total_stock_qty, product.unit)}
                          />
                        ) : (
                          formatQty(v.total_stock_qty, product.unit)
                        )}
                      </TableCell>
                      <TableCell align="right">
                        {product.product_type === "service" ? "—" : formatQty(v.stock_min)}
                      </TableCell>
                      <TableCell>
                        {!v.is_active && <Chip size="small" label="Inactiva" />}
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5}>
                          <Tooltip title="Editar variante">
                            <IconButton
                              size="small"
                              onClick={() => {
                                setEditingVariant(v);
                                setVariantDialogOpen(true);
                              }}
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          {v.is_active && (
                            <Tooltip title="Desactivar variante">
                              <IconButton
                                size="small"
                                color="error"
                                onClick={() => handleDeactivateVariant(v)}
                              >
                                <DeleteOutlineIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Stack>
          )}

          {!loading && tab === "stock" && product && (
            <Stack spacing={3}>
              {product.product_type === "service" && (
                <Alert severity="info">
                  Los servicios no manejan stock.
                </Alert>
              )}
              {product.product_type === "product" &&
                variants.map((v) => (
                  <Stack key={v.id} spacing={1}>
                    <Typography variant="subtitle2" fontWeight={600}>
                      {formatVariantTitle(product.name, v.attributes, v.display_name)} ·{" "}
                      <Typography component="span" variant="caption" color="text.secondary">
                        {v.sku}
                      </Typography>
                    </Typography>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Bodega</TableCell>
                          <TableCell align="right">Stock</TableCell>
                          <TableCell align="right">Minimo</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(stockRows[v.id] ?? []).map((s) => (
                          <TableRow key={s.id}>
                            <TableCell>
                              <Stack direction="row" alignItems="center" spacing={1}>
                                <Chip size="small" label={s.warehouse_code} />
                                <Typography variant="body2">{s.warehouse_name}</Typography>
                              </Stack>
                            </TableCell>
                            <TableCell align="right">
                              {s.low_stock ? (
                                <Chip
                                  size="small"
                                  color="error"
                                  label={formatQty(s.qty, product.unit)}
                                />
                              ) : (
                                formatQty(s.qty, product.unit)
                              )}
                            </TableCell>
                            <TableCell align="right">{formatQty(v.stock_min)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Stack>
                ))}
              <Alert severity="info" variant="outlined">
                Para ajustar stock o ver historial de movimientos, anda a la pestana
                "Inventario".
              </Alert>
            </Stack>
          )}
        </Box>
      </Box>

      {product && (
        <VariantDialog
          open={variantDialogOpen}
          productId={product.id}
          productName={product.name}
          initial={editingVariant}
          onClose={() => {
            setVariantDialogOpen(false);
            setEditingVariant(null);
          }}
          onSaved={handleVariantSaved}
        />
      )}
    </Drawer>
  );
}
