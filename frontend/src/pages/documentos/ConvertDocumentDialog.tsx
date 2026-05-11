import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { ApiError } from "../../api/client";
import {
  type PaymentMethodRow,
  listPaymentMethods,
} from "../../api/payment_methods";
import { convertDocument } from "../../api/documents";
import {
  type CheckoutPaymentInput,
  type DocumentOut,
  type DocumentType,
} from "../../api/pos";
import { formatCLP } from "../../util/format";

interface ConvertDocumentDialogProps {
  open: boolean;
  document: DocumentOut | null;
  onClose: () => void;
  onConverted: (newDoc: DocumentOut) => void;
}

interface PaymentLine {
  payment_method_id: string;
  amount_clp: number;
  reference: string;
}

export default function ConvertDocumentDialog({
  open,
  document: src,
  onClose,
  onConverted,
}: ConvertDocumentDialogProps) {
  const [targetType, setTargetType] = useState<DocumentType>("boleta");
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRow[]>([]);
  const [payments, setPayments] = useState<PaymentLine[]>([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !src) return;
    setError(null);
    setTargetType("boleta");
    const label =
      src.document_type === "cotizacion" ? "cotización" : "guía de despacho";
    setNotes(`Convertido desde ${label} #${src.folio}`);
    listPaymentMethods(false)
      .then((pms) => {
        setPaymentMethods(pms);
        const cash = pms.find((m) => m.is_cash) ?? pms[0];
        if (cash) {
          setPayments([
            { payment_method_id: cash.id, amount_clp: src.total_clp, reference: "" },
          ]);
        }
      })
      .catch(() => setPaymentMethods([]));
  }, [open, src]);

  if (!src) return null;
  const sourceLabel =
    src.document_type === "cotizacion" ? "cotización" : "guía de despacho";

  const paymentsTotal = payments.reduce(
    (acc, p) => acc + (Number(p.amount_clp) || 0),
    0,
  );
  const delta = src.total_clp - paymentsTotal;
  const hasRut = src.customer_rut && src.customer_rut.trim();
  const canFactura = Boolean(hasRut);

  const handleSubmit = async () => {
    setError(null);
    if (targetType === "factura" && !canFactura) {
      setError("Factura requiere cliente con RUT.");
      return;
    }
    if (Math.abs(delta) > 1) {
      setError(`Los pagos no cuadran. Faltan ${formatCLP(Math.abs(delta))}.`);
      return;
    }
    setSaving(true);
    try {
      const body = {
        document_type: targetType,
        notes: notes.trim() || null,
        payments: payments
          .filter((p) => p.payment_method_id && p.amount_clp > 0)
          .map(
            (p): CheckoutPaymentInput => ({
              payment_method_id: p.payment_method_id,
              amount_clp: p.amount_clp,
              reference: p.reference.trim() || null,
            }),
          ),
      };
      const newDoc = await convertDocument(src.id, body);
      onConverted(newDoc);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `No se pudo convertir la ${sourceLabel}.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Convertir {sourceLabel} en venta
        <Typography variant="body2" color="text.secondary">
          {sourceLabel} #{src.folio} · Total {formatCLP(src.total_clp)}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            select
            label="Tipo de venta"
            value={targetType}
            onChange={(e) => setTargetType(e.target.value as DocumentType)}
            fullWidth
          >
            <MenuItem value="boleta">Boleta</MenuItem>
            <MenuItem value="factura" disabled={!canFactura}>
              Factura {!canFactura && "(requiere cliente con RUT)"}
            </MenuItem>
            <MenuItem value="nota_venta">Nota de venta</MenuItem>
          </TextField>

          <Stack direction="row" justifyContent="space-between" alignItems="center">
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
                    amount_clp: Math.max(0, delta),
                    reference: "",
                  },
                ])
              }
            >
              Agregar pago
            </Button>
          </Stack>

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
                label="Referencia"
                size="small"
                value={p.reference}
                onChange={(e) =>
                  setPayments((prev) =>
                    prev.map((q, i) =>
                      i === idx ? { ...q, reference: e.target.value } : q,
                    ),
                  )
                }
                sx={{ flexGrow: 1 }}
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
                Pagado: {formatCLP(paymentsTotal)} de {formatCLP(src.total_clp)}
              </Typography>
              {Math.abs(delta) <= 1 ? (
                <Chip size="small" color="success" label="Cuadra" />
              ) : (
                <Chip
                  size="small"
                  color={delta > 0 ? "warning" : "error"}
                  label={
                    delta > 0
                      ? `Faltan ${formatCLP(delta)}`
                      : `Sobra ${formatCLP(-delta)}`
                  }
                />
              )}
            </Stack>
          )}

          <TextField
            label="Notas"
            fullWidth
            multiline
            minRows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving}>
          {saving ? "Convirtiendo..." : "Convertir y emitir"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
