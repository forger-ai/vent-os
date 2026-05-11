import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  IconButton,
  MenuItem,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ClearAllIcon from "@mui/icons-material/ClearAll";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import PointOfSaleIcon from "@mui/icons-material/PointOfSale";
import RemoveIcon from "@mui/icons-material/Remove";
import { ApiError } from "../api/client";
import { type CustomerRow, listCustomers } from "../api/customers";
import {
  type CartProduct,
  type DocumentOut,
  type DocumentType,
  type TaxCodeBrief,
  lookupPosProduct,
  posCheckout,
  searchPosProducts,
} from "../api/pos";
import { type PriceListRow, listPriceLists } from "../api/price_lists";
import { type WarehouseRow, listWarehouses } from "../api/warehouses";
import { formatCLP } from "../util/format";
import ReceiptDialog from "./pos/ReceiptDialog";

interface CartLine {
  product: CartProduct;
  quantity: number;
  line_discount_clp: number;
}

const IVA_RATE = 0.19;

interface Totals {
  subtotal: number;
  iva: number;
  additional: number;
  globalDiscount: number;
  total: number;
}

const computeTotals = (lines: CartLine[], globalDiscount: number): Totals => {
  let subtotal = 0;
  let iva = 0;
  let additional = 0;
  for (const line of lines) {
    const gross = line.product.effective_price_clp * line.quantity - line.line_discount_clp;
    if (gross <= 0) continue;
    const net = line.product.iva_affected ? gross / (1 + IVA_RATE) : gross;
    subtotal += net;
    iva += gross - net;
    for (const tc of line.product.tax_codes) {
      additional += net * tc.rate;
    }
  }
  const total = Math.max(0, subtotal + iva + additional - globalDiscount);
  return { subtotal, iva, additional, globalDiscount, total };
};

export default function PosPage() {
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [priceLists, setPriceLists] = useState<PriceListRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [priceListId, setPriceListId] = useState<string>("");
  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [documentType, setDocumentType] = useState<DocumentType>("boleta");
  const [globalDiscount, setGlobalDiscount] = useState<number>(0);
  const [notes, setNotes] = useState<string>("");

  const [cart, setCart] = useState<CartLine[]>([]);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<CartProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [posError, setPosError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [emitting, setEmitting] = useState(false);
  const [receipt, setReceipt] = useState<DocumentOut | null>(null);

  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const [quickCode, setQuickCode] = useState("");

  // ── Boot ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    listWarehouses(false)
      .then((ws) => {
        setWarehouses(ws);
        const def = ws.find((w) => w.is_default) ?? ws[0];
        if (def) setWarehouseId(def.id);
      })
      .catch(() => {});
    listPriceLists(false)
      .then((pls) => {
        setPriceLists(pls);
        const def = pls.find((p) => p.is_default) ?? pls[0];
        if (def) setPriceListId(def.id);
      })
      .catch(() => {});
    listCustomers({ limit: 500 })
      .then((p) => setCustomers(p.items))
      .catch(() => {});
  }, []);

  // ── Search effect (debounced) ──────────────────────────────────────────────
  useEffect(() => {
    if (!searchText.trim() || !warehouseId) {
      setSearchResults([]);
      return;
    }
    const handle = setTimeout(() => {
      setSearching(true);
      searchPosProducts(searchText.trim(), warehouseId, priceListId || undefined)
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 200);
    return () => clearTimeout(handle);
  }, [searchText, warehouseId, priceListId]);

  // When the customer changes, pre-select their default doc type.
  useEffect(() => {
    if (customer && (customer.default_document_type === "boleta" || customer.default_document_type === "factura")) {
      setDocumentType(customer.default_document_type);
    }
  }, [customer]);

  const totals = useMemo(() => computeTotals(cart, globalDiscount), [cart, globalDiscount]);

  // ── Cart operations ─────────────────────────────────────────────────────────
  const addToCart = useCallback(
    (product: CartProduct) => {
      setCart((prev) => {
        const idx = prev.findIndex((l) => l.product.variant_id === product.variant_id);
        if (idx >= 0) {
          const next = prev.slice();
          next[idx] = { ...next[idx], quantity: next[idx].quantity + 1, product };
          return next;
        }
        return [...prev, { product, quantity: 1, line_discount_clp: 0 }];
      });
    },
    [],
  );

  const updateLine = (variantId: string, patch: Partial<CartLine>) => {
    setCart((prev) =>
      prev.map((l) => (l.product.variant_id === variantId ? { ...l, ...patch } : l)),
    );
  };

  const removeLine = (variantId: string) => {
    setCart((prev) => prev.filter((l) => l.product.variant_id !== variantId));
  };

  const clearCart = () => {
    if (cart.length === 0) return;
    if (!confirm("Vaciar el carrito?")) return;
    setCart([]);
    setGlobalDiscount(0);
    setNotes("");
  };

  // ── Quick code lookup (scan or type SKU/barcode + Enter) ────────────────────
  const handleQuickLookup = async () => {
    const code = quickCode.trim();
    if (!code || !warehouseId) return;
    setPosError(null);
    try {
      const product = await lookupPosProduct(code, warehouseId, priceListId || undefined);
      addToCart(product);
      setToast(`+${product.display_name}`);
      setQuickCode("");
      codeInputRef.current?.focus();
    } catch (err) {
      setPosError(err instanceof ApiError ? err.message : "No se encontro el codigo.");
    }
  };

  // ── Checkout ────────────────────────────────────────────────────────────────
  const handleCheckout = async () => {
    setPosError(null);
    if (cart.length === 0) {
      setPosError("El carrito esta vacio.");
      return;
    }
    if (!warehouseId) {
      setPosError("Selecciona una bodega.");
      return;
    }
    if (documentType === "factura" && (!customer || !customer.rut)) {
      setPosError("Factura requiere un cliente con RUT.");
      return;
    }
    setEmitting(true);
    try {
      const result = await posCheckout({
        document_type: documentType,
        warehouse_id: warehouseId,
        customer_id: customer?.id ?? null,
        price_list_id: priceListId || null,
        global_discount_clp: globalDiscount || 0,
        notes: notes.trim() || null,
        items: cart.map((l) => ({
          variant_id: l.product.variant_id,
          quantity: l.quantity,
          line_discount_clp: l.line_discount_clp || 0,
        })),
      });
      setReceipt(result);
      setCart([]);
      setGlobalDiscount(0);
      setNotes("");
      setToast(`Emitido folio ${result.folio}`);
    } catch (err) {
      setPosError(err instanceof ApiError ? err.message : "No se pudo emitir el documento.");
    } finally {
      setEmitting(false);
    }
  };

  const renderTaxChips = (taxes: TaxCodeBrief[]) => {
    if (taxes.length === 0) return null;
    return (
      <Stack direction="row" spacing={0.5} mt={0.5} flexWrap="wrap">
        {taxes.map((t) => (
          <Chip
            key={t.id}
            size="small"
            label={`${t.code} ${(t.rate * 100).toFixed(1)}%`}
            variant="outlined"
            color="warning"
          />
        ))}
      </Stack>
    );
  };

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5" fontWeight={700}>
          Punto de venta
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Carrito con busqueda por SKU/codigo de barras, calculo de IVA e impuestos
          adicionales, y emision local de boletas / facturas / notas de venta.
        </Typography>
      </Box>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <Autocomplete
          options={warehouses}
          getOptionLabel={(o) => `${o.code} · ${o.name}`}
          value={warehouses.find((w) => w.id === warehouseId) ?? null}
          onChange={(_, v) => setWarehouseId(v?.id ?? "")}
          renderInput={(p) => <TextField {...p} label="Bodega" size="small" />}
          sx={{ minWidth: 220 }}
        />
        <Autocomplete
          options={priceLists}
          getOptionLabel={(o) => `${o.code} · ${o.name}`}
          value={priceLists.find((p) => p.id === priceListId) ?? null}
          onChange={(_, v) => setPriceListId(v?.id ?? "")}
          renderInput={(p) => <TextField {...p} label="Lista de precios" size="small" />}
          sx={{ minWidth: 220 }}
        />
        <Autocomplete
          options={customers}
          getOptionLabel={(o) =>
            `${o.razon_social}${o.rut ? ` · ${o.rut}` : ""}`
          }
          value={customer}
          onChange={(_, v) => setCustomer(v)}
          isOptionEqualToValue={(o, v) => o.id === v.id}
          renderInput={(p) => (
            <TextField
              {...p}
              label={
                documentType === "factura"
                  ? "Cliente (requerido para factura)"
                  : "Cliente (opcional)"
              }
              size="small"
            />
          )}
          sx={{ minWidth: 280, flexGrow: 1 }}
        />
        <TextField
          select
          label="Documento"
          size="small"
          value={documentType}
          onChange={(e) => setDocumentType(e.target.value as DocumentType)}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="boleta">Boleta</MenuItem>
          <MenuItem value="factura">Factura</MenuItem>
          <MenuItem value="nota_venta">Nota de venta</MenuItem>
        </TextField>
      </Stack>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ alignItems: "stretch" }}>
        {/* Buscador / Quick code */}
        <Card sx={{ flex: 1.4 }}>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="subtitle2" fontWeight={600}>
                Agregar productos
              </Typography>
              <Stack direction="row" spacing={1}>
                <TextField
                  inputRef={codeInputRef}
                  label="SKU o codigo de barras"
                  size="small"
                  fullWidth
                  value={quickCode}
                  onChange={(e) => setQuickCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleQuickLookup();
                  }}
                  placeholder="Scan o tipea + Enter"
                />
                <Button onClick={handleQuickLookup} variant="outlined">
                  Agregar
                </Button>
              </Stack>
              <TextField
                label="Buscar"
                size="small"
                fullWidth
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Por nombre, SKU o codigo"
              />
              <Box sx={{ maxHeight: 380, overflow: "auto" }}>
                {searching && (
                  <Typography variant="caption" color="text.secondary">
                    Buscando...
                  </Typography>
                )}
                {!searching && searchResults.length === 0 && searchText.trim() && (
                  <Typography variant="caption" color="text.secondary">
                    Sin resultados.
                  </Typography>
                )}
                <Stack spacing={1}>
                  {searchResults.map((p) => (
                    <Card key={p.variant_id} variant="outlined">
                      <CardContent sx={{ py: 1, "&:last-child": { pb: 1 } }}>
                        <Stack
                          direction="row"
                          alignItems="center"
                          spacing={1}
                          justifyContent="space-between"
                        >
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="body2" fontWeight={500} noWrap>
                              {p.display_name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              SKU {p.sku} · Stock {p.stock_qty} {p.unit}
                            </Typography>
                            {renderTaxChips(p.tax_codes)}
                          </Box>
                          <Stack alignItems="flex-end" spacing={0.5}>
                            <Typography variant="body2" fontWeight={600}>
                              {formatCLP(p.effective_price_clp)}
                            </Typography>
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => addToCart(p)}
                              disabled={p.stock_qty <= 0}
                            >
                              <AddIcon />
                            </IconButton>
                          </Stack>
                        </Stack>
                      </CardContent>
                    </Card>
                  ))}
                </Stack>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        {/* Carrito */}
        <Card sx={{ flex: 1.6 }}>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="subtitle2" fontWeight={600}>
                Carrito ({cart.length})
              </Typography>
              <Button size="small" startIcon={<ClearAllIcon />} onClick={clearCart}>
                Vaciar
              </Button>
            </Stack>

            <Box sx={{ maxHeight: 360, overflow: "auto", mt: 1 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Producto</TableCell>
                    <TableCell align="right">Precio</TableCell>
                    <TableCell align="right">Cant.</TableCell>
                    <TableCell align="right">Descuento</TableCell>
                    <TableCell align="right">Total</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {cart.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} align="center">
                        <Typography variant="caption" color="text.secondary">
                          Carrito vacio. Agrega productos desde la izquierda.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                  {cart.map((line) => {
                    const gross =
                      line.product.effective_price_clp * line.quantity - line.line_discount_clp;
                    return (
                      <TableRow key={line.product.variant_id}>
                        <TableCell>
                          <Typography variant="body2" fontWeight={500} noWrap>
                            {line.product.display_name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {line.product.sku}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          {formatCLP(line.product.effective_price_clp)}
                        </TableCell>
                        <TableCell align="right">
                          <Stack direction="row" alignItems="center" justifyContent="flex-end">
                            <IconButton
                              size="small"
                              onClick={() =>
                                updateLine(line.product.variant_id, {
                                  quantity: Math.max(1, line.quantity - 1),
                                })
                              }
                            >
                              <RemoveIcon fontSize="small" />
                            </IconButton>
                            <TextField
                              size="small"
                              type="number"
                              value={line.quantity}
                              onChange={(e) =>
                                updateLine(line.product.variant_id, {
                                  quantity: Math.max(0.01, Number(e.target.value)),
                                })
                              }
                              sx={{ width: 70 }}
                              slotProps={{ htmlInput: { min: 0.01, step: 1 } }}
                            />
                            <IconButton
                              size="small"
                              onClick={() =>
                                updateLine(line.product.variant_id, {
                                  quantity: line.quantity + 1,
                                })
                              }
                            >
                              <AddIcon fontSize="small" />
                            </IconButton>
                          </Stack>
                        </TableCell>
                        <TableCell align="right">
                          <TextField
                            size="small"
                            type="number"
                            value={line.line_discount_clp}
                            onChange={(e) =>
                              updateLine(line.product.variant_id, {
                                line_discount_clp: Math.max(0, Number(e.target.value)),
                              })
                            }
                            sx={{ width: 90 }}
                            slotProps={{ htmlInput: { min: 0, step: 1 } }}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" fontWeight={500}>
                            {formatCLP(gross)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => removeLine(line.product.variant_id)}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>

            <Divider sx={{ my: 2 }} />

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems="center">
              <TextField
                label="Descuento global (CLP)"
                size="small"
                type="number"
                value={globalDiscount}
                onChange={(e) => setGlobalDiscount(Math.max(0, Number(e.target.value)))}
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
                sx={{ minWidth: 200 }}
              />
              <TextField
                label="Nota (opcional)"
                size="small"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                sx={{ flexGrow: 1 }}
              />
            </Stack>

            <Stack alignItems="flex-end" spacing={0.5} sx={{ mt: 2 }}>
              <Typography variant="body2" color="text.secondary">
                Neto: {formatCLP(totals.subtotal)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                IVA: {formatCLP(totals.iva)}
              </Typography>
              {totals.additional > 0 && (
                <Typography variant="body2" color="warning.main">
                  Impuestos adicionales: {formatCLP(totals.additional)}
                </Typography>
              )}
              {totals.globalDiscount > 0 && (
                <Typography variant="body2" color="text.secondary">
                  Descuento: −{formatCLP(totals.globalDiscount)}
                </Typography>
              )}
              <Typography variant="h5" fontWeight={700}>
                Total: {formatCLP(totals.total)}
              </Typography>
            </Stack>

            {posError && <Alert severity="error" sx={{ mt: 1 }}>{posError}</Alert>}

            <Button
              variant="contained"
              size="large"
              fullWidth
              startIcon={<PointOfSaleIcon />}
              disabled={cart.length === 0 || emitting}
              onClick={handleCheckout}
              sx={{ mt: 2 }}
            >
              {emitting
                ? "Emitiendo..."
                : `Emitir ${
                    documentType === "factura"
                      ? "factura"
                      : documentType === "nota_venta"
                      ? "nota de venta"
                      : "boleta"
                  }`}
            </Button>
          </CardContent>
        </Card>
      </Stack>

      <ReceiptDialog
        open={receipt !== null}
        document={receipt}
        onClose={() => setReceipt(null)}
      />

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={2000}
        onClose={() => setToast(null)}
        message={toast ?? ""}
      />
    </Stack>
  );
}
