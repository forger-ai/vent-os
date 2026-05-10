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
import StarIcon from "@mui/icons-material/Star";
import { ApiError } from "../../api/client";
import {
  type WarehouseRow,
  deactivateWarehouse,
  listWarehouses,
} from "../../api/warehouses";
import WarehouseDialog from "./WarehouseDialog";

export default function BodegasTab() {
  const [rows, setRows] = useState<WarehouseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WarehouseRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listWarehouses(showInactive);
      setRows(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las bodegas.");
    } finally {
      setLoading(false);
    }
  }, [showInactive]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaved = (saved: WarehouseRow) => {
    setDialogOpen(false);
    setEditing(null);
    setToast(`Bodega ${saved.code} guardada.`);
    load();
  };

  const handleDeactivate = async (row: WarehouseRow) => {
    if (!confirm(`Desactivar bodega ${row.code} - ${row.name}?`)) return;
    try {
      await deactivateWarehouse(row.id);
      setToast(`Bodega ${row.code} desactivada.`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo desactivar la bodega.");
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="body2" color="text.secondary">
          Cada bodega mantiene su propio stock por variante. La que esta marcada como
          default es la que recibe ajustes por defecto.
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Switch
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            size="small"
          />
          <Typography variant="body2">Incluir inactivas</Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            Nueva bodega
          </Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Box>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell width={100}>Codigo</TableCell>
              <TableCell>Nombre</TableCell>
              <TableCell>Direccion</TableCell>
              <TableCell align="right">Variantes con stock</TableCell>
              <TableCell width={60}></TableCell>
              <TableCell width={100}></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((w) => (
              <TableRow key={w.id} sx={{ opacity: w.is_active ? 1 : 0.5 }}>
                <TableCell>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Chip size="small" label={w.code} variant="outlined" />
                    {w.is_default && (
                      <Tooltip title="Por defecto">
                        <StarIcon fontSize="small" color="warning" />
                      </Tooltip>
                    )}
                  </Stack>
                </TableCell>
                <TableCell>{w.name}</TableCell>
                <TableCell>{w.address ?? "—"}</TableCell>
                <TableCell align="right">{w.variants_with_stock}</TableCell>
                <TableCell>
                  {!w.is_active && <Chip size="small" label="Inactiva" />}
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5}>
                    <Tooltip title="Editar">
                      <IconButton
                        size="small"
                        onClick={() => {
                          setEditing(w);
                          setDialogOpen(true);
                        }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {w.is_active && (
                      <Tooltip title="Desactivar">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeactivate(w)}
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
                    No hay bodegas. Crea la primera para empezar.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>

      <WarehouseDialog
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
