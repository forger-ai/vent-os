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
import { addDocumentPayment } from "../../api/documents";
import {
  type PaymentMethodRow,
  listPaymentMethods,
} from "../../api/payment_methods";
import { type DocumentOut } from "../../api/pos";
import { formatCLP } from "../../util/format";

interface AddPaymentDialogProps {
  open: boolean;
  document: DocumentOut | null;
  onClose: () => void;
  onSaved: (updated: DocumentOut) => void;
}

interface PaymentLine {
  payment_method_id: string;
  amount_clp: number;
  reference: string;
}

export default function AddPaymentDialog({
  open,
  document: doc,
  onClose,
  onSaved,
}: AddPaymentDialogProps) {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRow[]>([]);
  const [payments, setPayments] = useState<PaymentLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !doc) return;
    setError(null);
    listPaymentMethods(false)
      .then((pms) => {
        setPaymentMethods(pms);
        const cash = pms.find((m) => m.is_cash) ?? pms[0];
        if (cash) {
          setPayments([
            {
              payment_method_id: cash.id,
              amount_clp: doc.balance_due_clp,
              reference: "",
            },
          ]);
        }
      })
      .catch(() => setPaymentMethods([]));
  }, [open, doc]);

  if (!doc) return null;

  const paymentsTotal = payments.reduce(
    (acc, p) => acc + (Number(p.amount_clp) || 0),
    0,
  );
  const remaining = doc.balance_due_clp - paymentsTotal;

  const handleSubmit = async () => {
    setError(null);
    if (paymentsTotal <= 0) {
      setError("Ingresa al menos un pago mayor a 0.");
      return;
    }
    if (paymentsTotal - doc.balance_due_clp > 1) {
      setError(
        `El abono (${formatCLP(paymentsTotal)}) excede el saldo pendiente (${formatCLP(doc.balance_due_clp)}).`,
      );
      return;
    }
    setSaving(true);
    try {
      const updated = await addDocumentPayment(doc.id, {
        payments: payments
          .filter((p) => p.payment_method_id && p.amount_clp > 0)
          .map((p) => ({
            payment_method_id: p.payment_method_id,
            amount_clp: p.amount_clp,
            reference: p.reference.trim() || null,
          })),
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar el pago.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Registrar pago
        <Typography variant="body2" color="text.secondary">
          Doc #{doc.folio} · Saldo pendiente {formatCLP(doc.balance_due_clp)}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

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
                    amount_clp: Math.max(0, remaining),
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

          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="caption" color="text.secondary">
              Abono: {formatCLP(paymentsTotal)} de {formatCLP(doc.balance_due_clp)}
            </Typography>
            {Math.abs(remaining) <= 1 ? (
              <Chip size="small" color="success" label="Saldar completo" />
            ) : remaining > 0 ? (
              <Chip
                size="small"
                color="info"
                label={`Queda saldo ${formatCLP(remaining)}`}
              />
            ) : (
              <Chip size="small" color="error" label={`Excede ${formatCLP(-remaining)}`} />
            )}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving}>
          {saving ? "Registrando..." : "Registrar pago"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
