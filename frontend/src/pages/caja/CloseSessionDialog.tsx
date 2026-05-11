import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { ApiError } from "../../api/client";
import { type CashSessionRow, closeSession } from "../../api/cash";
import { formatCLP } from "../../util/format";

interface CloseSessionDialogProps {
  open: boolean;
  session: CashSessionRow | null;
  onClose: () => void;
  onClosed: (cs: CashSessionRow) => void;
}

export default function CloseSessionDialog({
  open,
  session,
  onClose,
  onClosed,
}: CloseSessionDialogProps) {
  const [closingAmount, setClosingAmount] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !session) return;
    setError(null);
    setNotes("");
    const expected = session.opening_amount_clp + session.summary.cash_total_clp;
    setClosingAmount(expected);
  }, [open, session]);

  if (!session) return null;

  const expected = session.opening_amount_clp + session.summary.cash_total_clp;
  const difference = closingAmount - expected;

  const handleSubmit = async () => {
    setError(null);
    setSaving(true);
    try {
      const cs = await closeSession(session.id, {
        closing_amount_clp: closingAmount,
        notes: notes.trim() || null,
      });
      onClosed(cs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cerrar la caja.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Cerrar caja</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Box>
            <Typography variant="body2" color="text.secondary">
              Bodega
            </Typography>
            <Typography variant="body1" fontWeight={500}>
              {session.warehouse_code} · {session.warehouse_name}
            </Typography>
          </Box>

          <Grid container spacing={2}>
            <Grid item xs={6}>
              <Typography variant="caption" color="text.secondary">
                Monto inicial
              </Typography>
              <Typography variant="h6">{formatCLP(session.opening_amount_clp)}</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="caption" color="text.secondary">
                Efectivo recibido ({session.summary.documents_count} docs)
              </Typography>
              <Typography variant="h6">{formatCLP(session.summary.cash_total_clp)}</Typography>
            </Grid>
            <Grid item xs={12}>
              <Typography variant="caption" color="text.secondary">
                Esperado en caja (solo efectivo)
              </Typography>
              <Typography variant="h5" fontWeight={700}>
                {formatCLP(expected)}
              </Typography>
              {session.summary.non_cash_total_clp > 0 && (
                <Typography variant="caption" color="text.secondary" display="block">
                  Pagos electrónicos: {formatCLP(session.summary.non_cash_total_clp)} (no afectan caja)
                </Typography>
              )}
            </Grid>
          </Grid>

          <TextField
            label="Monto contado en caja (CLP)"
            type="number"
            fullWidth
            value={closingAmount}
            onChange={(e) => setClosingAmount(Math.max(0, Number(e.target.value)))}
            slotProps={{ htmlInput: { min: 0, step: 1 } }}
            helperText="Dinero efectivamente presente al cerrar"
          />

          <Box>
            <Typography variant="caption" color="text.secondary">
              Diferencia
            </Typography>
            <Typography
              variant="h6"
              color={
                difference === 0
                  ? "success.main"
                  : difference > 0
                  ? "warning.main"
                  : "error.main"
              }
            >
              {difference >= 0 ? "+" : ""}
              {formatCLP(difference)}
              {difference > 0 && " (sobrante)"}
              {difference < 0 && " (faltante)"}
              {difference === 0 && " (cuadrada)"}
            </Typography>
          </Box>

          <TextField
            label="Notas (opcional)"
            fullWidth
            multiline
            minRows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          {session.summary.cancelled_count > 0 && (
            <Alert severity="info" variant="outlined">
              Hubo {session.summary.cancelled_count} documento(s) anulado(s) durante esta sesión.
              Su monto no cuenta en el esperado.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving}>
          {saving ? "Cerrando..." : "Cerrar caja"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
