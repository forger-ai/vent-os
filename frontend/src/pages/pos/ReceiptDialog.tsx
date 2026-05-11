import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import PrintIcon from "@mui/icons-material/Print";
import type { DocumentOut } from "../../api/pos";
import { formatCLP, formatQty } from "../../util/format";

interface ReceiptDialogProps {
  open: boolean;
  document: DocumentOut | null;
  onClose: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  boleta: "Boleta",
  factura: "Factura",
  nota_venta: "Nota de venta",
};

export default function ReceiptDialog({ open, document: doc, onClose }: ReceiptDialogProps) {
  if (!doc) return null;
  const datetime = doc.issued_at;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Documento emitido
        <Typography variant="body2" color="text.secondary">
          {TYPE_LABEL[doc.document_type] ?? doc.document_type} - Folio #{doc.folio}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Box
          id="vent-os-receipt"
          sx={{
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            p: 2,
            backgroundColor: "background.paper",
          }}
        >
          <Stack spacing={1}>
            <Typography variant="h6" fontWeight={700} align="center">
              {TYPE_LABEL[doc.document_type] ?? doc.document_type} #{doc.folio}
            </Typography>
            <Typography variant="body2" align="center" color="text.secondary">
              {datetime}
              {doc.warehouse_code ? ` · ${doc.warehouse_code}` : ""}
            </Typography>
            {doc.customer_name && (
              <Typography variant="body2" align="center">
                {doc.customer_name}
                {doc.customer_rut ? ` · ${doc.customer_rut}` : ""}
              </Typography>
            )}
            <Divider />
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Detalle</TableCell>
                  <TableCell align="right">Cant.</TableCell>
                  <TableCell align="right">Precio</TableCell>
                  <TableCell align="right">Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {doc.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Typography variant="body2">{item.name_snapshot}</Typography>
                      {item.sku_snapshot && (
                        <Typography variant="caption" color="text.secondary">
                          {item.sku_snapshot}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">{formatQty(item.quantity)}</TableCell>
                    <TableCell align="right">{formatCLP(item.unit_price_clp)}</TableCell>
                    <TableCell align="right">{formatCLP(item.line_total_clp)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Divider />
            <Stack spacing={0.5} alignItems="flex-end">
              <Typography variant="body2" color="text.secondary">
                Neto: {formatCLP(doc.subtotal_clp)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                IVA: {formatCLP(doc.iva_clp)}
              </Typography>
              <Typography variant="h6" fontWeight={700}>
                Total: {formatCLP(doc.total_clp)}
              </Typography>
            </Stack>
            {doc.payments.length > 0 && (
              <>
                <Divider />
                <Stack spacing={0.5}>
                  <Typography variant="body2" fontWeight={600}>
                    Forma de pago
                  </Typography>
                  {doc.payments.map((p) => (
                    <Stack key={p.id} direction="row" justifyContent="space-between">
                      <Typography variant="body2">
                        {p.name}
                        {p.reference ? ` · ${p.reference}` : ""}
                      </Typography>
                      <Typography variant="body2">{formatCLP(p.amount_clp)}</Typography>
                    </Stack>
                  ))}
                </Stack>
              </>
            )}
            {doc.notes && (
              <>
                <Divider />
                <Typography variant="caption" color="text.secondary">
                  {doc.notes}
                </Typography>
              </>
            )}
          </Stack>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => window.print()} startIcon={<PrintIcon />}>
          Imprimir
        </Button>
        <Button variant="contained" onClick={onClose}>
          Cerrar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
