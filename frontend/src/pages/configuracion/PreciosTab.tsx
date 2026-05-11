import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ClearIcon from "@mui/icons-material/Clear";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import StarIcon from "@mui/icons-material/Star";
import { ApiError } from "../../api/client";
import {
  type PriceListEntryRow,
  type PriceListRow,
  deactivatePriceList,
  listEntries,
  listPriceLists,
  removeEntry,
  setEntry,
} from "../../api/price_lists";
import { formatCLP } from "../../util/format";
import PriceListDialog from "./PriceListDialog";

const formatPercent = (override: number, base: number): string => {
  if (!base) return "—";
  const diff = (override - base) / base;
  const sign = diff >= 0 ? "+" : "";
  return `${sign}${(diff * 100).toFixed(1)}%`;
};

export default function PreciosTab() {
  const [lists, setLists] = useState<PriceListRow[]>([]);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [entries, setEntries] = useState<PriceListEntryRow[]>([]);
  const [query, setQuery] = useState("");
  const [onlyOverrides, setOnlyOverrides] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [editingRow, setEditingRow] = useState<PriceListEntryRow | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [editingList, setEditingList] = useState<PriceListRow | null>(null);

  const loadLists = useCallback(async () => {
    try {
      const list = await listPriceLists(showInactive);
      setLists(list);
      if (!selectedListId && list.length > 0) {
        const def = list.find((l) => l.is_default) ?? list[0];
        setSelectedListId(def.id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las listas.");
    }
  }, [showInactive, selectedListId]);

  const loadEntries = useCallback(async () => {
    if (!selectedListId) {
      setEntries([]);
      return;
    }
    setLoadingEntries(true);
    setError(null);
    try {
      const list = await listEntries(selectedListId, onlyOverrides, query.trim());
      setEntries(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los precios.");
    } finally {
      setLoadingEntries(false);
    }
  }, [selectedListId, onlyOverrides, query]);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const selectedList = lists.find((l) => l.id === selectedListId) ?? null;

  const handleListSaved = (row: PriceListRow) => {
    setListDialogOpen(false);
    setEditingList(null);
    setToast(`Lista ${row.code} guardada.`);
    loadLists();
  };

  const handleDeactivateList = async (row: PriceListRow) => {
    if (!confirm(`Desactivar lista ${row.code}?`)) return;
    try {
      await deactivatePriceList(row.id);
      setToast(`Lista ${row.code} desactivada.`);
      loadLists();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo desactivar la lista.");
    }
  };

  const handleStartEdit = (row: PriceListEntryRow) => {
    if (selectedList?.is_default) return;
    setEditingRow(row);
    setEditValue(
      String(row.override_price_clp !== null ? row.override_price_clp : row.base_price_clp),
    );
  };

  const handleSaveEdit = async () => {
    if (!editingRow || !selectedListId) return;
    const num = Number(editValue);
    if (Number.isNaN(num) || num < 0) {
      setError("Precio invalido.");
      return;
    }
    try {
      await setEntry(selectedListId, editingRow.variant_id, num);
      setEditingRow(null);
      loadEntries();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el precio.");
    }
  };

  const handleRemove = async (row: PriceListEntryRow) => {
    if (!selectedListId) return;
    if (!confirm(`Quitar override de ${row.variant_sku}? Quedara con el precio base.`)) {
      return;
    }
    try {
      await removeEntry(selectedListId, row.variant_id);
      loadEntries();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo quitar el override.");
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="center">
        <Autocomplete
          options={lists}
          getOptionLabel={(o) => `${o.code} · ${o.name}`}
          value={selectedList}
          onChange={(_, v) => setSelectedListId(v?.id ?? null)}
          renderInput={(p) => <TextField {...p} label="Lista de precios" size="small" />}
          sx={{ minWidth: 280 }}
        />
        <FormControlLabel
          control={
            <Switch
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
          }
          label="Incluir inactivas"
        />
        <Box sx={{ flexGrow: 1 }} />
        <Button
          variant="outlined"
          startIcon={<EditIcon />}
          disabled={!selectedList}
          onClick={() => {
            setEditingList(selectedList);
            setListDialogOpen(true);
          }}
        >
          Editar lista
        </Button>
        {selectedList && !selectedList.is_default && (
          <Button
            variant="text"
            color="error"
            startIcon={<DeleteOutlineIcon />}
            onClick={() => selectedList && handleDeactivateList(selectedList)}
          >
            Desactivar
          </Button>
        )}
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditingList(null);
            setListDialogOpen(true);
          }}
        >
          Nueva lista
        </Button>
      </Stack>

      {selectedList?.is_default && (
        <Alert severity="info" variant="outlined">
          Esta es la lista por defecto. Sus precios siempre coinciden con el precio base
          de cada variante; no admite overrides aquí. Edita la variante para cambiar el
          precio base.
        </Alert>
      )}

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="center">
        <TextField
          label="Buscar variante"
          size="small"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ minWidth: 280, flexGrow: 1 }}
          placeholder="SKU o nombre"
        />
        <FormControlLabel
          control={
            <Switch
              checked={onlyOverrides}
              onChange={(e) => setOnlyOverrides(e.target.checked)}
              disabled={selectedList?.is_default}
            />
          }
          label="Solo con override"
        />
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Box>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Variante</TableCell>
              <TableCell align="right">Precio base</TableCell>
              <TableCell align="right">Precio en esta lista</TableCell>
              <TableCell>Diferencia</TableCell>
              <TableCell>Fuente</TableCell>
              <TableCell width={120}></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {entries.map((row) => {
              const isEditing = editingRow?.variant_id === row.variant_id;
              return (
                <TableRow key={row.variant_id}>
                  <TableCell>
                    <Stack>
                      <Typography variant="body2" fontWeight={500}>
                        {row.variant_display}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        SKU {row.variant_sku}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell align="right">{formatCLP(row.base_price_clp)}</TableCell>
                  <TableCell align="right">
                    {isEditing ? (
                      <TextField
                        size="small"
                        type="number"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveEdit();
                          if (e.key === "Escape") setEditingRow(null);
                        }}
                        autoFocus
                        sx={{ width: 130 }}
                        slotProps={{ htmlInput: { min: 0, step: 1 } }}
                      />
                    ) : (
                      <Typography variant="body2" fontWeight={500}>
                        {formatCLP(row.effective_price_clp)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.source === "list" && row.override_price_clp !== null && (
                      <Typography
                        variant="caption"
                        color={
                          row.override_price_clp > row.base_price_clp
                            ? "warning.main"
                            : "success.main"
                        }
                      >
                        {formatPercent(row.override_price_clp, row.base_price_clp)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.source === "list" ? (
                      <Chip size="small" color="primary" label="Override" />
                    ) : (
                      <Chip size="small" label="Base" variant="outlined" />
                    )}
                  </TableCell>
                  <TableCell>
                    {selectedList?.is_default ? null : isEditing ? (
                      <Stack direction="row" spacing={0.5}>
                        <Tooltip title="Guardar">
                          <IconButton size="small" color="primary" onClick={handleSaveEdit}>
                            <StarIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Cancelar">
                          <IconButton size="small" onClick={() => setEditingRow(null)}>
                            <ClearIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    ) : (
                      <Stack direction="row" spacing={0.5}>
                        <Tooltip title="Editar precio">
                          <IconButton size="small" onClick={() => handleStartEdit(row)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {row.source === "list" && (
                          <Tooltip title="Quitar override (vuelve al base)">
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => handleRemove(row)}
                            >
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Stack>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {!loadingEntries && entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    Sin variantes para mostrar.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>

      <PriceListDialog
        open={listDialogOpen}
        initial={editingList}
        onClose={() => {
          setListDialogOpen(false);
          setEditingList(null);
        }}
        onSaved={handleListSaved}
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
