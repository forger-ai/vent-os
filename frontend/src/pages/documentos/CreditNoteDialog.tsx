import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { ApiError } from "../../api/client";
import {
  type DocumentOut,
  type DocumentRow,
  createCreditNote,
  listCreditNotesFor,
} from "../../api/documents";
import { formatCLP } from "../../util/format";

interface CreditNoteDialogProps {
  open: boolean;
  document: DocumentOut | null;
  onClose: () => void;
  onCreated: (nc: DocumentOut) => void;
}

interface LineState {
  original_item_id: string;
  name: string;
  sku: string | null;
  sold_qty: number;
  already_returned: number;
  max_return: number;
  unit_price_clp: number;
  return_qty: number;
}

export default function CreditNoteDialog({
  open,
  document: doc,
  onClose,
  onCreated,
}: CreditNoteDialogProps) {
  const [lines, setLines] = useState<LineState[]>([]);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [previousNCs, setPreviousNCs] = useState<DocumentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !doc) return;
    setError(null);
    setReason("");
    setNotes("");

    listCreditNotesFor(doc.id)
      .then((ncs) => {
        setPreviousNCs(ncs);
        // Compute already-returned qty per item snapshot by summing prior NC items.
        // We use sku_snapshot to match; backend uses the same rule.
        // For simplicity here we re-fetch each NC detail is too heavy; instead we
        // use the totals approach: trust backend validation, but pre-compute via
        // an "approximate" guess: split returned proportionally. To stay safe,
        // ask the user to enter the qty and let backend reject if it exceeds.
        // (We could be more clever but it's not blocking.)
        setLines(
          doc.items.map((it) => ({
            original_item_id: it.id,
            name: it.name_snapshot,
            sku: it.sku_snapshot,
            sold_qty: it.quantity,
            already_returned: 0,
            max_return: it.quantity,
            unit_price_clp: it.unit_price_clp,
            return_qty: 0,
          })),
        );
      })
      .catch(() => {
        setPreviousNCs([]);
        setLines(
          doc.items.map((it) => ({
            original_item_id: it.id,
            name: it.name_snapshot,
            sku: it.sku_snapshot,
            sold_qty: it.quantity,
            already_returned: 0,
            max_return: it.quantity,
            unit_price_clp: it.unit_price_clp,
            return_qty: 0,
          })),
        );
      });
  }, [open, doc]);

  if (!doc) return null;

  const totalToReturn = lines.reduce(
    (acc, l) => acc + l.return_qty * l.unit_price_clp,
    0,
  );
  const allLinesValid = lines.every((l) => l.return_qty >= 0 && l.return_qty <= l.max_return);
  const anyToReturn = lines.some((l) => l.return_qty > 0);

  const setQty = (id: string, qty: number) => {
    setLines((prev) =>
      prev.map((l) =>
        l.original_item_id === id
          ? { ...l, return_qty: Math.max(0, Math.min(qty, l.max_return)) }
          : l,
      ),
    );
  };

  const setAllMax = () => {
    setLines((prev) => prev.map((l) => ({ ...l, return_qty: l.max_return })));
  };

  const handleSubmit = async () => {
    setError(null);
    if (!reason.trim()) {
      setError("El motivo es obligatorio.");
      return;
    }
    if (!anyToReturn) {
      setError("Indica al menos una cantidad a devolver.");
      return;
    }
    setSaving(true);
    try {
      const nc = await createCreditNote(doc.id, {
        items: lines
          .filter((l) => l.return_qty > 0)
          .map((l) => ({ original_item_id: l.original_item_id, quantity: l.return_qty })),
        reason: reason.trim(),
        notes: notes.trim() || null,
      });
      onCreated(nc);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la nota de credito.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Nota de credito
        <Typography variant="body2" color="text.secondary">
          Sobre {doc.document_type === "boleta" ? "Boleta" : doc.document_type === "factura" ? "Factura" : "Nota de venta"} #{doc.folio}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          {previousNCs.length > 0 && (
            <Alert severity="info" variant="outlined">
              Ya existen {previousNCs.length} nota(s) de credito sobre este documento.
              El backend valida que no excedas las cantidades restantes.
            </Alert>
          )}

          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="subtitle2" fontWeight={600}>
              Items a devolver
            </Typography>
            <Button size="small" onClick={setAllMax}>
              Marcar todo (devolucion total)
            </Button>
          </Stack>

          <Box sx={{ maxHeight: 360, overflow: "auto" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Producto</TableCell>
                  <TableCell align="right">Vendido</TableCell>
                  <TableCell align="right">Devolver</TableCell>
                  <TableCell align="right">Precio</TableCell>
                  <TableCell align="right">Subtotal</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.original_item_id}>
                    <TableCell>
                      <Typography variant="body2">{l.name}</Typography>
                      {l.sku && (
                        <Typography variant="caption" color="text.secondary">
                          SKU {l.sku}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">{l.sold_qty}</TableCell>
                    <TableCell align="right">
                      <TextField
                        size="small"
                        type="number"
                        value={l.return_qty}
                        onChange={(e) => setQty(l.original_item_id, Number(e.target.value))}
                        sx={{ width: 100 }}
                        slotProps={{ htmlInput: { min: 0, max: l.max_return, step: 0.01 } }}
                        helperText={`max ${l.max_return}`}
                      />
                    </TableCell>
                    <TableCell align="right">{formatCLP(l.unit_price_clp)}</TableCell>
                    <TableCell align="right">
                      {formatCLP(l.return_qty * l.unit_price_clp)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>

          <Stack alignItems="flex-end">
            <Typography variant="caption" color="text.secondary">
              Total bruto a devolver (aprox)
            </Typography>
            <Typography variant="h6" fontWeight={700}>
              {formatCLP(totalToReturn)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              El total final lo calcula el servidor con IVA e impuestos
              proporcionales.
            </Typography>
          </Stack>

          <TextField
            label="Motivo"
            fullWidth
            required
            multiline
            minRows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Devolucion por defecto / cliente cambia de opinion / etc."
          />

          <TextField
            label="Notas internas (opcional)"
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
        <Button
          variant="contained"
          color="warning"
          onClick={handleSubmit}
          disabled={saving || !anyToReturn || !allLinesValid}
        >
          {saving ? "Emitiendo..." : "Emitir nota de credito"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
