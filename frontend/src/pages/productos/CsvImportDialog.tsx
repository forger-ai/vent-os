import { useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import UploadIcon from "@mui/icons-material/Upload";
import { ApiError } from "../../api/client";
import {
  type ImportReport,
  importProductsCsv,
} from "../../api/csv";

interface CsvImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export default function CsvImportDialog({ open, onClose, onImported }: CsvImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setFile(null);
    setReport(null);
    setError(null);
    setDryRun(true);
  };

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    setFile(f);
    setReport(null);
    setError(null);
  };

  const handleRun = async () => {
    if (!file) return;
    setRunning(true);
    setError(null);
    try {
      const r = await importProductsCsv(file, dryRun);
      setReport(r);
      if (!r.dry_run && r.errors === 0) {
        onImported();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo procesar el archivo.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        onClose();
        reset();
      }}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>Importar productos desde CSV</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Formato esperado: el mismo del export (una fila por variante). Columnas
            obligatorias: <code>product_name</code>, <code>sku</code>, <code>price_clp</code>.
          </Typography>
          <Stack direction="row" spacing={2} alignItems="center">
            <Button
              variant="outlined"
              startIcon={<UploadIcon />}
              onClick={() => inputRef.current?.click()}
            >
              Seleccionar archivo
            </Button>
            <input
              ref={inputRef}
              type="file"
              hidden
              accept=".csv,text/csv"
              onChange={handleSelect}
            />
            {file && (
              <Chip label={file.name} onDelete={() => setFile(null)} variant="outlined" />
            )}
          </Stack>

          <FormControlLabel
            control={
              <Switch
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
              />
            }
            label={
              <Stack>
                <Typography variant="body2">
                  {dryRun ? "Dry-run (no escribe)" : "Aplicar cambios"}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Recomendado: corre primero en dry-run, revisa errores, y recien
                  aplica.
                </Typography>
              </Stack>
            }
          />

          {error && <Alert severity="error">{error}</Alert>}

          {report && (
            <Stack spacing={1}>
              <Alert
                severity={
                  report.errors > 0
                    ? "warning"
                    : report.dry_run
                    ? "info"
                    : "success"
                }
              >
                {report.dry_run
                  ? "Vista previa (no se escribio nada)."
                  : "Cambios aplicados."}{" "}
                Total filas: <strong>{report.total_rows}</strong> · Productos
                creados: <strong>{report.created_products}</strong> · actualizados:{" "}
                <strong>{report.updated_products}</strong> · Variantes creadas:{" "}
                <strong>{report.created_variants}</strong> · actualizadas:{" "}
                <strong>{report.updated_variants}</strong> · Errores:{" "}
                <strong>{report.errors}</strong>
              </Alert>
              {report.errors > 0 && !report.dry_run && (
                <Alert severity="error">
                  Hubo errores: no se aplico ningun cambio. Corrige y vuelve a
                  intentar.
                </Alert>
              )}

              <Box sx={{ maxHeight: 320, overflow: "auto" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell width={60}>Fila</TableCell>
                      <TableCell>SKU</TableCell>
                      <TableCell>Producto</TableCell>
                      <TableCell>Resultado</TableCell>
                      <TableCell>Mensaje</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.rows.map((r, idx) => (
                      <TableRow key={`${r.row}-${idx}`}>
                        <TableCell>{r.row}</TableCell>
                        <TableCell>{r.sku ?? "—"}</TableCell>
                        <TableCell>{r.product_name ?? "—"}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            color={
                              r.action === "error"
                                ? "error"
                                : r.action === "created"
                                ? "success"
                                : "default"
                            }
                            label={r.action}
                          />
                        </TableCell>
                        <TableCell>
                          {r.message ?? <Typography variant="caption" color="text.secondary">—</Typography>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => {
            onClose();
            reset();
          }}
          disabled={running}
        >
          Cerrar
        </Button>
        <Button
          variant="contained"
          onClick={handleRun}
          disabled={!file || running}
        >
          {running
            ? "Procesando..."
            : dryRun
            ? "Validar (dry-run)"
            : "Aplicar cambios"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
