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
import { type CashSessionRow, currentSession } from "../api/cash";
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
import {
  type PaymentMethodRow,
  listPaymentMethods,
} from "../api/payment_methods";
import { type PriceListRow, listPriceLists } from "../api/price_lists";
import { createQuote } from "../api/quotes";
import { type WarehouseRow, listWarehouses } from "../api/warehouses";
import { formatCLP } from "../util/format";
import ReceiptDialog from "./pos/ReceiptDialog";

interface CartLine {
  product: CartProduct;
  quantity: number;
  line_discount_clp: number;
}

interface PaymentLine {
  payment_method_id: string;
  amount_clp: number;
  reference: string;
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
  const [validUntil, setValidUntil] = useState<string>("");
  const [shippingAddress, setShippingAddress] = useState<string>("");
  const [shippingNotes, setShippingNotes] = useState<string>("");
  const [carrierName, setCarrierName] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");

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
  const [cashSession, setCashSession] = useState<CashSessionRow | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRow[]>([]);
  const [payments, setPayments] = useState<PaymentLine[]>([]);

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
    listPaymentMethods(false)
      .then(setPaymentMethods)
      .catch(() => setPaymentMethods([]));
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

  // Detect the warehouse's open cash session.
  useEffect(() => {
    if (!warehouseId) {
      setCashSession(null);
      return;
    }
    currentSession(warehouseId)
      .then(setCashSession)
      .catch(() => setCashSession(null));
  }, [warehouseId, receipt]);

  const totals = useMemo(() => computeTotals(cart, globalDiscount), [cart, globalDiscount]);

  const cashMethod = useMemo(
    () => paymentMethods.find((m) => m.is_cash) ?? paymentMethods[0] ?? null,
    [paymentMethods],
  );

  // Auto-suggest single cash payment for the full total when the cart changes
  // and the user hasn't customized payments.
  useEffect(() => {
    if (!cashMethod) return;
    if (payments.length === 0 && totals.total > 0) {
      setPayments([
        { payment_method_id: cashMethod.id, amount_clp: totals.total, reference: "" },
      ]);
      return;
    }
    if (payments.length === 1 && cart.length > 0) {
      // Single-line payment: keep it synced with the cart total
      setPayments([{ ...payments[0], amount_clp: totals.total }]);
    }
  }, [cart, totals.total, cashMethod]); // eslint-disable-line react-hooks/exhaustive-deps

  const paymentsTotal = useMemo(
    () => payments.reduce((acc, p) => acc + (Number(p.amount_clp) || 0), 0),
    [payments],
  );
  const paymentDelta = totals.total - paymentsTotal;

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
      setPosError(err instanceof ApiError ? err.message : "No se encontró el código.");
    }
  };

  // ── Checkout ────────────────────────────────────────────────────────────────
  const isQuote = documentType === "cotizacion";
  const isGuia = documentType === "guia_despacho";
  const hidesPayments = isQuote || isGuia;
  const allowsCredit =
    documentType === "factura" || documentType === "nota_venta";

  const handleCheckout = async () => {
    setPosError(null);
    if (cart.length === 0) {
      setPosError("El carrito está vacío.");
      return;
    }
    if (!warehouseId) {
      setPosError("Selecciona una bodega.");
      return;
    }
    if (!hidesPayments && documentType === "factura" && (!customer || !customer.rut)) {
      setPosError("Factura requiere un cliente con RUT.");
      return;
    }
    // Boleta: cuadre exacto. Factura/nota_venta: balance pendiente permitido,
    // solo no exceder. Guia/cotizacion: no captura pagos en este flujo.
    if (!hidesPayments) {
      if (allowsCredit) {
        if (paymentDelta < -1) {
          setPosError(
            `Los pagos exceden el total. Sobran ${formatCLP(-paymentDelta)}.`,
          );
          return;
        }
      } else if (Math.abs(paymentDelta) > 1) {
        setPosError(
          `Los pagos no cuadran con el total. Faltan ${formatCLP(Math.abs(paymentDelta))}.`,
        );
        return;
      }
    }
    setEmitting(true);
    try {
      let result;
      if (isQuote) {
        result = await createQuote({
          warehouse_id: warehouseId,
          customer_id: customer?.id ?? null,
          price_list_id: priceListId || null,
          valid_until: validUntil || null,
          global_discount_clp: globalDiscount || 0,
          notes: notes.trim() || null,
          items: cart.map((l) => ({
            variant_id: l.product.variant_id,
            quantity: l.quantity,
            line_discount_clp: l.line_discount_clp || 0,
          })),
        });
        setToast(`Cotización #${result.folio} creada`);
      } else {
        result = await posCheckout({
          document_type: documentType as
            | "boleta"
            | "factura"
            | "nota_venta"
            | "guia_despacho",
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
          payments: isGuia
            ? []
            : payments
                .filter((p) => p.payment_method_id && p.amount_clp > 0)
                .map((p) => ({
                  payment_method_id: p.payment_method_id,
                  amount_clp: p.amount_clp,
                  reference: p.reference.trim() || null,
                })),
          shipping_address: isGuia ? shippingAddress.trim() || null : null,
          shipping_notes: isGuia ? shippingNotes.trim() || null : null,
          carrier_name: isGuia ? carrierName.trim() || null : null,
          due_date: allowsCredit ? dueDate || null : null,
        });
        setToast(isGuia ? `Guía #${result.folio} emitida` : `Emitido folio ${result.folio}`);
      }
      setReceipt(result);
      setCart([]);
      setGlobalDiscount(0);
      setNotes("");
      setValidUntil("");
      setShippingAddress("");
      setShippingNotes("");
      setCarrierName("");
      setDueDate("");
      setPayments([]);
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
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Punto de venta
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Carrito con búsqueda por SKU/código de barras, cálculo de IVA e impuestos
            adicionales, y emisión local de boletas, facturas, notas de venta, guías y cotizaciones.
          </Typography>
        </Box>
        {warehouseId && (
          cashSession ? (
            <Chip
              color="success"
              label={`Caja abierta · ${cashSession.summary.documents_count} docs · ${formatCLP(cashSession.summary.sales_total_clp)}`}
            />
          ) : (
            <Chip
              color="warning"
              variant="outlined"
              label="Sin caja abierta · ábrela en la pestaña Caja"
            />
          )
        )}
      </Stack>

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
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="boleta">Boleta</MenuItem>
          <MenuItem value="factura">Factura</MenuItem>
          <MenuItem value="nota_venta">Nota de venta</MenuItem>
          <MenuItem value="cotizacion">Cotización</MenuItem>
          <MenuItem value="guia_despacho">Guía de despacho</MenuItem>
        </TextField>
        {isQuote && (
          <TextField
            type="date"
            label="Válida hasta"
            size="small"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ minWidth: 160 }}
          />
        )}
        {allowsCredit && (
          <TextField
            type="date"
            label="Vence el (opcional)"
            size="small"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ minWidth: 180 }}
            helperText="Si dejas saldo pendiente"
          />
        )}
      </Stack>

      {isGuia && (
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <TextField
            label="Dirección de entrega"
            size="small"
            value={shippingAddress}
            onChange={(e) => setShippingAddress(e.target.value)}
            sx={{ minWidth: 280, flexGrow: 1 }}
          />
          <TextField
            label="Transportista"
            size="small"
            value={carrierName}
            onChange={(e) => setCarrierName(e.target.value)}
            sx={{ minWidth: 180 }}
          />
          <TextField
            label="Notas de envío"
            size="small"
            value={shippingNotes}
            onChange={(e) => setShippingNotes(e.target.value)}
            sx={{ minWidth: 240, flexGrow: 1 }}
          />
        </Stack>
      )}

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
                  label="SKU o código de barras"
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
                placeholder="Por nombre, SKU o código"
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
                          Carrito vacío. Agrega productos desde la izquierda.
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

            {!hidesPayments && <Divider sx={{ my: 2 }} />}

            {!hidesPayments && <Stack spacing={1}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="subtitle2" fontWeight={600}>
                  Pagos
                </Typography>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() =>
                    setPayments((prev) => [
                      ...prev,
                      {
                        payment_method_id: paymentMethods[0]?.id ?? "",
                        amount_clp: Math.max(0, paymentDelta),
                        reference: "",
                      },
                    ])
                  }
                  disabled={paymentMethods.length === 0}
                >
                  Agregar pago
                </Button>
              </Stack>
              {payments.length === 0 && (
                <Typography variant="caption" color="text.secondary">
                  Sin pagos. Por defecto se emite todo como Efectivo.
                </Typography>
              )}
              {payments.map((p, idx) => (
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1}
                  key={idx}
                  alignItems="center"
                >
                  <TextField
                    select
                    size="small"
                    label="Método"
                    value={p.payment_method_id}
                    onChange={(e) =>
                      setPayments((prev) =>
                        prev.map((q, i) =>
                          i === idx ? { ...q, payment_method_id: e.target.value } : q,
                        ),
                      )
                    }
                    sx={{ minWidth: 180 }}
                  >
                    {paymentMethods.map((m) => (
                      <MenuItem key={m.id} value={m.id}>
                        {m.name}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="Monto"
                    size="small"
                    type="number"
                    value={p.amount_clp}
                    onChange={(e) =>
                      setPayments((prev) =>
                        prev.map((q, i) =>
                          i === idx
                            ? { ...q, amount_clp: Math.max(0, Number(e.target.value)) }
                            : q,
                        ),
                      )
                    }
                    sx={{ minWidth: 120 }}
                    slotProps={{ htmlInput: { min: 0, step: 1 } }}
                  />
                  <TextField
                    label="Referencia (opcional)"
                    size="small"
                    value={p.reference}
                    onChange={(e) =>
                      setPayments((prev) =>
                        prev.map((q, i) =>
                          i === idx ? { ...q, reference: e.target.value } : q,
                        ),
                      )
                    }
                    sx={{ flexGrow: 1, minWidth: 140 }}
                    placeholder="Voucher, últimos 4..."
                  />
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() =>
                      setPayments((prev) => prev.filter((_, i) => i !== idx))
                    }
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
              {payments.length > 0 && (
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="caption" color="text.secondary">
                    Pagado: {formatCLP(paymentsTotal)} de {formatCLP(totals.total)}
                  </Typography>
                  {Math.abs(paymentDelta) <= 1 ? (
                    <Chip size="small" color="success" label="Cuadra" />
                  ) : paymentDelta > 0 ? (
                    <Chip
                      size="small"
                      color={allowsCredit ? "info" : "warning"}
                      label={
                        allowsCredit
                          ? `Saldo pendiente: ${formatCLP(paymentDelta)}`
                          : `Faltan ${formatCLP(paymentDelta)}`
                      }
                    />
                  ) : (
                    <Chip
                      size="small"
                      color="error"
                      label={`Sobra ${formatCLP(-paymentDelta)}`}
                    />
                  )}
                </Stack>
              )}
            </Stack>}

            {posError && <Alert severity="error" sx={{ mt: 1 }}>{posError}</Alert>}

            <Button
              variant="contained"
              size="large"
              fullWidth
              startIcon={<PointOfSaleIcon />}
              disabled={cart.length === 0 || emitting}
              onClick={handleCheckout}
              sx={{ mt: 2 }}
              color={isQuote ? "info" : isGuia ? "secondary" : "primary"}
            >
              {emitting
                ? isQuote
                  ? "Creando..."
                  : "Emitiendo..."
                : isQuote
                ? "Crear cotización"
                : isGuia
                ? "Emitir guía de despacho"
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
