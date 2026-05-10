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
  type TaxCodeRow,
  deactivateTaxCode,
  listTaxCodes,
} from "../../api/tax_codes";
import TaxCodeDialog from "./TaxCodeDialog";

const formatPercent = (v: number) =>
  new Intl.NumberFormat("es-CL", { style: "percent", maximumFractionDigits: 2 }).format(v);

export default function ImpuestosTab() {
  const [rows, setRows] = useState<TaxCodeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TaxCodeRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listTaxCodes(showInactive);
      setRows(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los impuestos.");
    } finally {
      setLoading(false);
    }
  }, [showInactive]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaved = (row: TaxCodeRow) => {
    setDialogOpen(false);
    setEditing(null);
    setToast(`Impuesto ${row.code} guardado.`);
    load();
  };

  const handleDeactivate = async (r: TaxCodeRow) => {
    if (!confirm(`Desactivar impuesto ${r.code}?`)) return;
    try {
      await deactivateTaxCode(r.id);
      setToast(`Impuesto ${r.code} desactivado.`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo desactivar.");
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="body2" color="text.secondary">
          Impuestos adicionales (ILA, bebidas azucaradas, especificos) que se aplican
          sobre el IVA. Cada variante puede tener cero, uno o varios codigos asignados.
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
            Nuevo impuesto
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
              <TableCell align="right">Tasa</TableCell>
              <TableCell align="right">Variantes asignadas</TableCell>
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
                <TableCell>
                  <Typography variant="body2" fontWeight={500}>{r.name}</Typography>
                  {r.description && (
                    <Typography variant="caption" color="text.secondary">
                      {r.description}
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="right">{formatPercent(r.rate)}</TableCell>
                <TableCell align="right">{r.variants_count}</TableCell>
                <TableCell>{!r.is_active && <Chip size="small" label="Inactivo" />}</TableCell>
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
                    No hay impuestos configurados. Crea el primero.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>

      <TaxCodeDialog
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
