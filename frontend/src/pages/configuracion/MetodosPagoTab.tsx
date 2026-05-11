import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import { ApiError } from "../../api/client";
import {
  type PaymentMethodRow,
  deactivatePaymentMethod,
  listPaymentMethods,
} from "../../api/payment_methods";
import PaymentMethodDialog from "./PaymentMethodDialog";

export default function MetodosPagoTab() {
  const [rows, setRows] = useState<PaymentMethodRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentMethodRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listPaymentMethods(showInactive));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los metodos.");
    } finally {
      setLoading(false);
    }
  }, [showInactive]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaved = (row: PaymentMethodRow) => {
    setDialogOpen(false);
    setEditing(null);
    setToast(`Metodo ${row.code} guardado.`);
    load();
  };

  const handleDeactivate = async (r: PaymentMethodRow) => {
    if (!confirm(`Desactivar metodo ${r.code}?`)) return;
    try {
      await deactivatePaymentMethod(r.id);
      setToast(`${r.code} desactivado.`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo desactivar.");
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="body2" color="text.secondary">
          Metodos de pago aceptados en el POS. Los marcados como "efectivo" cuentan
          en el cierre de caja; los demas no afectan el cajon.
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Switch
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            size="small"
          />
          <Typography variant="body2">Incluir inactivos</Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            Nuevo metodo
          </Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Box>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Codigo</TableCell>
              <TableCell>Nombre</TableCell>
              <TableCell>Tipo</TableCell>
              <TableCell align="right">Orden</TableCell>
              <TableCell width={70}></TableCell>
              <TableCell width={100}></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} sx={{ opacity: r.is_active ? 1 : 0.5 }}>
                <TableCell>
                  <Chip size="small" label={r.code} variant="outlined" />
                </TableCell>
                <TableCell>{r.name}</TableCell>
                <TableCell>
                  {r.is_cash ? (
                    <Chip size="small" color="success" label="Efectivo" />
                  ) : (
                    <Chip size="small" label="Electronico" variant="outlined" />
                  )}
                </TableCell>
                <TableCell align="right">{r.sort_order}</TableCell>
                <TableCell>
                  {!r.is_active && <Chip size="small" label="Inactivo" />}
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5}>
                    <Tooltip title="Editar">
                      <IconButton
                        size="small"
                        onClick={() => {
                          setEditing(r);
                          setDialogOpen(true);
                        }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {r.is_active && (
                      <Tooltip title="Desactivar">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeactivate(r)}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    Sin metodos. Crea el primero.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>

      <PaymentMethodDialog
        open={dialogOpen}
        initial={editing}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        onSaved={handleSaved}
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
