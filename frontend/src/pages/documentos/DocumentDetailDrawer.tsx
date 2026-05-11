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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import BlockIcon from "@mui/icons-material/Block";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import { ApiError } from "../../api/client";
import {
  type DocumentOut,
  type DocumentRow,
  cancelDocument,
  getDocument,
  listCreditNotesFor,
} from "../../api/documents";
import { cancelQuote } from "../../api/quotes";
import { formatCLP, formatQty } from "../../util/format";
import ConvertQuoteDialog from "./ConvertQuoteDialog";
import CreditNoteDialog from "./CreditNoteDialog";

interface DocumentDetailDrawerProps {
  documentId: string | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  boleta: "Boleta",
  factura: "Factura",
  nota_venta: "Nota de venta",
  nota_credito: "Nota de credito",
};

const STATUS_COLOR: Record<string, "success" | "default" | "error"> = {
  issued: "success",
  draft: "default",
  cancelled: "error",
};

const STATUS_LABEL: Record<string, string> = {
  issued: "Emitido",
  draft: "Borrador",
  cancelled: "Anulado",
};

export default function DocumentDetailDrawer({
  documentId,
  open,
  onClose,
  onChanged,
}: DocumentDetailDrawerProps) {
  const [doc, setDoc] = useState<DocumentOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [childNCs, setChildNCs] = useState<DocumentRow[]>([]);
  const [creditOpen, setCreditOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);

  const load = useCallback(async () => {
    if (!documentId) return;
    setLoading(true);
    setError(null);
    try {
      const d = await getDocument(documentId);
      setDoc(d);
      if (d.document_type !== "nota_credito") {
        try {
          const ncs = await listCreditNotesFor(d.id);
          setChildNCs(ncs);
        } catch {
          setChildNCs([]);
        }
      } else {
        setChildNCs([]);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el documento.");
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (open && documentId) load();
  }, [open, documentId, load]);

  const handleCancel = async () => {
    if (!doc) return;
    if (
      !confirm(
        `Anular ${TYPE_LABEL[doc.document_type]} #${doc.folio}? El stock vendido vuelve al inventario.`,
      )
    ) {
      return;
    }
    setCancelling(true);
    try {
      const updated = await cancelDocument(doc.id);
      setDoc(updated);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo anular.");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: "100%", md: 640 } } } }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <Box sx={{ p: 2, display: "flex", alignItems: "center", gap: 1 }}>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="overline" color="text.secondary">
              {doc ? TYPE_LABEL[doc.document_type] : "Documento"}
            </Typography>
            <Typography variant="h5" fontWeight={700}>
              {doc ? `Folio #${doc.folio}` : "..."}
            </Typography>
            {doc && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                <Chip
                  size="small"
                  label={STATUS_LABEL[doc.status] ?? doc.status}
                  color={STATUS_COLOR[doc.status] ?? "default"}
                />
                <Typography variant="caption" color="text.secondary">
                  {doc.issued_at}
                </Typography>
                {doc.warehouse_code && (
                  <Chip size="small" label={doc.warehouse_code} variant="outlined" />
                )}
              </Stack>
            )}
          </Box>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
        <Divider />

        <Box sx={{ flexGrow: 1, overflow: "auto", p: 2 }}>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {loading && (
            <Stack alignItems="center" sx={{ py: 4 }}>
              <CircularProgress size={24} />
            </Stack>
          )}

          {!loading && doc && (
            <Stack spacing={2}>
              {doc.customer_name && (
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Cliente
                  </Typography>
                  <Typography variant="body1" fontWeight={500}>
                    {doc.customer_name}
                  </Typography>
                  {doc.customer_rut && (
                    <Typography variant="body2" color="text.secondary">
                      RUT {doc.customer_rut}
                    </Typography>
                  )}
                </Box>
              )}

              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Item</TableCell>
                    <TableCell align="right">Cant.</TableCell>
                    <TableCell align="right">Precio</TableCell>
                    <TableCell align="right">Dto.</TableCell>
                    <TableCell align="right">Total</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {doc.items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell>
                        <Typography variant="body2">{it.name_snapshot}</Typography>
                        {it.sku_snapshot && (
                          <Typography variant="caption" color="text.secondary">
                            SKU {it.sku_snapshot}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">{formatQty(it.quantity)}</TableCell>
                      <TableCell align="right">{formatCLP(it.unit_price_clp)}</TableCell>
                      <TableCell align="right">
                        {it.discount_clp > 0 ? formatCLP(it.discount_clp) : "—"}
                      </TableCell>
                      <TableCell align="right">{formatCLP(it.line_total_clp)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Divider />

              <Stack alignItems="flex-end" spacing={0.5}>
                <Typography variant="body2" color="text.secondary">
                  Neto: {formatCLP(doc.subtotal_clp)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  IVA: {formatCLP(doc.iva_clp)}
                </Typography>
                <Typography variant="h6" fontWeight={700}>
                  Total: {formatCLP(doc.total_clp)}
                </Typography>
                {doc.returned_total_clp > 0 && (
                  <>
                    <Typography variant="body2" color="warning.main">
                      Devuelto via NC: −{formatCLP(doc.returned_total_clp)}
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      Efectivo neto: {formatCLP(doc.effective_total_clp)}
                    </Typography>
                  </>
                )}
                {doc.parent_folio && (
                  <Typography variant="caption" color="text.secondary">
                    NC sobre {TYPE_LABEL[doc.parent_document_type ?? ""] ?? doc.parent_document_type} #{doc.parent_folio}
                  </Typography>
                )}
                {doc.document_type === "cotizacion" && doc.valid_until && (
                  <Typography variant="caption" color={doc.is_expired ? "error.main" : "text.secondary"}>
                    Valida hasta {doc.valid_until}{doc.is_expired && " (vencida)"}
                  </Typography>
                )}
                {doc.converted_to_folio && (
                  <Typography variant="caption" color="success.main">
                    Convertida en {TYPE_LABEL[doc.converted_to_type ?? ""] ?? doc.converted_to_type} #{doc.converted_to_folio}
                  </Typography>
                )}
              </Stack>

              {childNCs.length > 0 && (
                <>
                  <Divider />
                  <Stack spacing={0.5}>
                    <Typography variant="caption" color="text.secondary">
                      Notas de credito emitidas sobre este documento
                    </Typography>
                    {childNCs.map((nc) => (
                      <Stack
                        key={nc.id}
                        direction="row"
                        justifyContent="space-between"
                        alignItems="center"
                      >
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Chip
                            size="small"
                            color="warning"
                            label={`NC #${nc.folio}`}
                          />
                          <Typography variant="caption" color="text.secondary">
                            {nc.issued_at} · {STATUS_LABEL[nc.status] ?? nc.status}
                          </Typography>
                        </Stack>
                        <Typography variant="body2">−{formatCLP(nc.total_clp)}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                </>
              )}

              {doc.payments.length > 0 && (
                <>
                  <Divider />
                  <Stack spacing={0.5}>
                    <Typography variant="caption" color="text.secondary">
                      Forma de pago
                    </Typography>
                    {doc.payments.map((p) => (
                      <Stack
                        key={p.id}
                        direction="row"
                        justifyContent="space-between"
                        alignItems="center"
                      >
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Chip
                            size="small"
                            label={p.code}
                            color={p.is_cash ? "success" : "default"}
                            variant="outlined"
                          />
                          <Typography variant="body2">
                            {p.name}
                            {p.reference ? ` · ${p.reference}` : ""}
                          </Typography>
                        </Stack>
                        <Typography variant="body2" fontWeight={500}>
                          {formatCLP(p.amount_clp)}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                </>
              )}

              {doc.notes && (
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Notas
                  </Typography>
                  <Typography variant="body2">{doc.notes}</Typography>
                </Box>
              )}
            </Stack>
          )}
        </Box>

        {doc && doc.status === "issued" && (
          <>
            <Divider />
            <Box sx={{ p: 2 }}>
              <Stack spacing={1}>
                {doc.document_type === "cotizacion" && !doc.converted_to_document_id && (
                  <>
                    <Button
                      variant="contained"
                      color="success"
                      fullWidth
                      startIcon={<CheckIcon />}
                      onClick={() => setConvertOpen(true)}
                    >
                      Convertir en venta
                    </Button>
                    <Button
                      variant="outlined"
                      color="error"
                      fullWidth
                      startIcon={<BlockIcon />}
                      onClick={async () => {
                        if (!confirm("Descartar esta cotizacion?")) return;
                        setCancelling(true);
                        try {
                          const updated = await cancelQuote(doc.id);
                          setDoc(updated);
                          onChanged();
                        } catch (err) {
                          setError(
                            err instanceof ApiError
                              ? err.message
                              : "No se pudo descartar.",
                          );
                        } finally {
                          setCancelling(false);
                        }
                      }}
                      disabled={cancelling}
                    >
                      Descartar cotizacion
                    </Button>
                  </>
                )}
                {doc.document_type !== "cotizacion" &&
                  doc.document_type !== "nota_credito" && (
                    <Button
                      variant="contained"
                      color="warning"
                      fullWidth
                      startIcon={<AssignmentReturnIcon />}
                      onClick={() => setCreditOpen(true)}
                      disabled={cancelling}
                    >
                      Emitir nota de credito (devolucion)
                    </Button>
                  )}
                {doc.document_type !== "cotizacion" && (
                  <Button
                    variant="outlined"
                    color="error"
                    fullWidth
                    startIcon={<BlockIcon />}
                    disabled={cancelling}
                    onClick={handleCancel}
                  >
                    {cancelling ? "Anulando..." : "Anular documento (rapido)"}
                  </Button>
                )}
                {doc.document_type !== "cotizacion" && (
                  <Typography variant="caption" color="text.secondary" textAlign="center">
                    Anular: error operativo, revierte todo. Nota de credito:
                    devolucion parcial/total, deja el documento original como historico.
                  </Typography>
                )}
              </Stack>
            </Box>
          </>
        )}
      </Box>

      {doc && (
        <CreditNoteDialog
          open={creditOpen}
          document={doc}
          onClose={() => setCreditOpen(false)}
          onCreated={() => {
            setCreditOpen(false);
            load();
            onChanged();
          }}
        />
      )}

      {doc && (
        <ConvertQuoteDialog
          open={convertOpen}
          quote={doc}
          onClose={() => setConvertOpen(false)}
          onConverted={() => {
            setConvertOpen(false);
            load();
            onChanged();
          }}
        />
      )}
    </Drawer>
  );
}
