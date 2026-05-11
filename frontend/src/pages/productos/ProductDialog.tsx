import { useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { ApiError } from "../../api/client";
import {
  type AttributeInput,
  type ProductCreateInput,
  type ProductDetail,
  type ProductType,
  type ProductUnit,
  type ProductUpdateInput,
  createProduct,
  updateProduct,
} from "../../api/products";
import { listAttributeNames } from "../../api/variants";

interface ProductDialogProps {
  open: boolean;
  initial: ProductDetail | null;
  categories: string[];
  brands: string[];
  onClose: () => void;
  onSaved: (product: ProductDetail) => void;
}

const UNIT_OPTIONS: ProductUnit[] = ["unit", "kg", "g", "l", "ml", "m", "box"];

interface CreateFormState {
  name: string;
  description: string;
  category: string;
  brand: string;
  product_type: ProductType;
  unit: ProductUnit;
  iva_affected: boolean;
  tracks_batches: boolean;
  is_active: boolean;
  notes: string;
  sku: string;
  barcode: string;
  price_clp: number;
  cost_clp: number | "";
  stock_min: number;
  attributes: AttributeInput[];
}

interface UpdateFormState {
  name: string;
  description: string;
  category: string;
  brand: string;
  product_type: ProductType;
  unit: ProductUnit;
  iva_affected: boolean;
  tracks_batches: boolean;
  is_active: boolean;
  notes: string;
}

const emptyCreate: CreateFormState = {
  name: "",
  description: "",
  category: "",
  brand: "",
  product_type: "product",
  unit: "unit",
  iva_affected: true,
  tracks_batches: false,
  is_active: true,
  notes: "",
  sku: "",
  barcode: "",
  price_clp: 0,
  cost_clp: "",
  stock_min: 0,
  attributes: [],
};

const fromDetail = (p: ProductDetail): UpdateFormState => ({
  name: p.name,
  description: p.description ?? "",
  category: p.category ?? "",
  brand: p.brand ?? "",
  product_type: p.product_type,
  unit: p.unit,
  iva_affected: p.iva_affected,
  tracks_batches: p.tracks_batches,
  is_active: p.is_active,
  notes: p.notes ?? "",
});

export default function ProductDialog({
  open,
  initial,
  categories,
  brands,
  onClose,
  onSaved,
}: ProductDialogProps) {
  const editing = initial !== null;
  const [createForm, setCreateForm] = useState<CreateFormState>(emptyCreate);
  const [updateForm, setUpdateForm] = useState<UpdateFormState>(fromDetail({
    id: "",
    name: "",
    description: null,
    category: null,
    brand: null,
    product_type: "product",
    unit: "unit",
    iva_affected: true,
    tracks_batches: false,
    is_active: true,
    notes: null,
    variant_count: 0,
    min_price_clp: null,
    max_price_clp: null,
    total_stock_qty: 0,
    low_stock: false,
  }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [attributeNames, setAttributeNames] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (initial) {
      setUpdateForm(fromDetail(initial));
    } else {
      setCreateForm(emptyCreate);
    }
    listAttributeNames()
      .then(setAttributeNames)
      .catch(() => {});
  }, [open, initial]);

  const isService = editing
    ? updateForm.product_type === "service"
    : createForm.product_type === "service";

  const handleSubmit = async () => {
    setError(null);
    setSaving(true);
    try {
      if (editing && initial) {
        const body: ProductUpdateInput = {
          name: updateForm.name.trim(),
          description: updateForm.description.trim() || null,
          category: updateForm.category.trim() || null,
          brand: updateForm.brand.trim() || null,
          product_type: updateForm.product_type,
          unit: updateForm.unit,
          iva_affected: updateForm.iva_affected,
          tracks_batches: updateForm.tracks_batches,
          is_active: updateForm.is_active,
          notes: updateForm.notes.trim() || null,
        };
        if (!body.name) {
          setError("El nombre es obligatorio.");
          setSaving(false);
          return;
        }
        const saved = await updateProduct(initial.id, body);
        onSaved(saved);
      } else {
        if (!createForm.name.trim()) {
          setError("El nombre del producto es obligatorio.");
          setSaving(false);
          return;
        }
        if (!createForm.sku.trim()) {
          setError("El SKU de la primera variante es obligatorio.");
          setSaving(false);
          return;
        }
        const body: ProductCreateInput = {
          name: createForm.name.trim(),
          description: createForm.description.trim() || null,
          category: createForm.category.trim() || null,
          brand: createForm.brand.trim() || null,
          product_type: createForm.product_type,
          unit: createForm.unit,
          iva_affected: createForm.iva_affected,
          tracks_batches: createForm.tracks_batches,
          is_active: createForm.is_active,
          notes: createForm.notes.trim() || null,
          initial_variant: {
            sku: createForm.sku.trim(),
            barcode: createForm.barcode.trim() || null,
            display_name: null,
            price_clp: Number(createForm.price_clp) || 0,
            cost_clp:
              createForm.cost_clp === "" ? null : Number(createForm.cost_clp),
            stock_min: Number(createForm.stock_min) || 0,
            attributes: createForm.attributes
              .map((a) => ({ name: a.name.trim(), value: a.value.trim() }))
              .filter((a) => a.name && a.value),
          },
        };
        const saved = await createProduct(body);
        onSaved(saved);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el producto.");
    } finally {
      setSaving(false);
    }
  };

  // --- editing view ---
  if (editing) {
    const setU = <K extends keyof UpdateFormState>(k: K, v: UpdateFormState[K]) =>
      setUpdateForm((p) => ({ ...p, [k]: v }));
    return (
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle>Editar producto</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  label="Nombre"
                  fullWidth
                  required
                  value={updateForm.name}
                  onChange={(e) => setU("name", e.target.value)}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Descripcion"
                  fullWidth
                  multiline
                  minRows={2}
                  value={updateForm.description}
                  onChange={(e) => setU("description", e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Autocomplete
                  freeSolo
                  options={categories}
                  value={updateForm.category}
                  onInputChange={(_, value) => setU("category", value)}
                  renderInput={(params) => <TextField {...params} label="Categoría" fullWidth />}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Autocomplete
                  freeSolo
                  options={brands}
                  value={updateForm.brand}
                  onInputChange={(_, value) => setU("brand", value)}
                  renderInput={(params) => <TextField {...params} label="Marca" fullWidth />}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Tipo"
                  select
                  fullWidth
                  value={updateForm.product_type}
                  onChange={(e) => setU("product_type", e.target.value as ProductType)}
                >
                  <MenuItem value="product">Producto</MenuItem>
                  <MenuItem value="service">Servicio</MenuItem>
                </TextField>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Unidad"
                  select
                  fullWidth
                  value={updateForm.unit}
                  onChange={(e) => setU("unit", e.target.value as ProductUnit)}
                  disabled={updateForm.product_type === "service"}
                >
                  {UNIT_OPTIONS.map((u) => (
                    <MenuItem key={u} value={u}>
                      {u}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={4}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={updateForm.iva_affected}
                      onChange={(e) => setU("iva_affected", e.target.checked)}
                    />
                  }
                  label={updateForm.iva_affected ? "Afecto a IVA" : "Exento de IVA"}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={updateForm.tracks_batches}
                      onChange={(e) => setU("tracks_batches", e.target.checked)}
                      disabled={updateForm.product_type === "service"}
                    />
                  }
                  label={
                    updateForm.tracks_batches
                      ? "Maneja lotes y vencimientos"
                      : "Sin lotes"
                  }
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={updateForm.is_active}
                      onChange={(e) => setU("is_active", e.target.checked)}
                    />
                  }
                  label={updateForm.is_active ? "Activo" : "Inactivo"}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Notas internas"
                  fullWidth
                  multiline
                  minRows={2}
                  value={updateForm.notes}
                  onChange={(e) => setU("notes", e.target.value)}
                />
              </Grid>
            </Grid>
            <Alert severity="info" variant="outlined">
              Para gestionar las variantes (SKU, precio, stock, atributos) abre el detalle del producto.
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="contained" onClick={handleSubmit} disabled={saving}>
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  // --- create view ---
  const setC = <K extends keyof CreateFormState>(k: K, v: CreateFormState[K]) =>
    setCreateForm((p) => ({ ...p, [k]: v }));

  const setAttr = (idx: number, key: "name" | "value", value: string) => {
    setCreateForm((prev) => {
      const next = prev.attributes.map((a, i) => (i === idx ? { ...a, [key]: value } : a));
      return { ...prev, attributes: next };
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Nuevo producto</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Typography variant="subtitle2" fontWeight={600}>
            Datos generales
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                label="Nombre"
                fullWidth
                required
                value={createForm.name}
                onChange={(e) => setC("name", e.target.value)}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Descripcion"
                fullWidth
                multiline
                minRows={2}
                value={createForm.description}
                onChange={(e) => setC("description", e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Autocomplete
                freeSolo
                options={categories}
                value={createForm.category}
                onInputChange={(_, value) => setC("category", value)}
                renderInput={(params) => <TextField {...params} label="Categoría" fullWidth />}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Autocomplete
                freeSolo
                options={brands}
                value={createForm.brand}
                onInputChange={(_, value) => setC("brand", value)}
                renderInput={(params) => <TextField {...params} label="Marca" fullWidth />}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                label="Tipo"
                select
                fullWidth
                value={createForm.product_type}
                onChange={(e) => setC("product_type", e.target.value as ProductType)}
              >
                <MenuItem value="product">Producto</MenuItem>
                <MenuItem value="service">Servicio</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                label="Unidad"
                select
                fullWidth
                value={createForm.unit}
                onChange={(e) => setC("unit", e.target.value as ProductUnit)}
                disabled={isService}
              >
                {UNIT_OPTIONS.map((u) => (
                  <MenuItem key={u} value={u}>
                    {u}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControlLabel
                control={
                  <Switch
                    checked={createForm.iva_affected}
                    onChange={(e) => setC("iva_affected", e.target.checked)}
                  />
                }
                label={createForm.iva_affected ? "Afecto a IVA" : "Exento"}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={createForm.tracks_batches}
                    onChange={(e) => setC("tracks_batches", e.target.checked)}
                    disabled={isService}
                  />
                }
                label={
                  createForm.tracks_batches
                    ? "Maneja lotes y vencimientos"
                    : "Sin lotes"
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={createForm.is_active}
                    onChange={(e) => setC("is_active", e.target.checked)}
                  />
                }
                label={createForm.is_active ? "Activo" : "Inactivo"}
              />
            </Grid>
          </Grid>

          <Divider />

          <Typography variant="subtitle2" fontWeight={600}>
            Primera variante (requerida)
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Cada producto necesita al menos una variante con su SKU y precio. Si tu
            producto tiene un solo modelo, completa esta y listo. Si tiene varios
            (talla/color), podras agregar mas variantes desde el detalle.
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <TextField
                label="SKU"
                fullWidth
                required
                value={createForm.sku}
                onChange={(e) => setC("sku", e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                label="Código de barras"
                fullWidth
                value={createForm.barcode}
                onChange={(e) => setC("barcode", e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                label="Stock mínimo"
                type="number"
                fullWidth
                value={createForm.stock_min}
                onChange={(e) => setC("stock_min", Number(e.target.value))}
                slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
                disabled={isService}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Precio (CLP)"
                type="number"
                fullWidth
                value={createForm.price_clp}
                onChange={(e) => setC("price_clp", Number(e.target.value))}
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Costo (CLP)"
                type="number"
                fullWidth
                value={createForm.cost_clp}
                onChange={(e) =>
                  setC("cost_clp", e.target.value === "" ? "" : Number(e.target.value))
                }
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
                helperText="Opcional"
              />
            </Grid>
          </Grid>

          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="body2" fontWeight={500}>
              Atributos de esta variante
            </Typography>
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() =>
                setCreateForm((p) => ({
                  ...p,
                  attributes: [...p.attributes, { name: "", value: "" }],
                }))
              }
            >
              Agregar
            </Button>
          </Stack>
          {createForm.attributes.length === 0 && (
            <Typography variant="caption" color="text.secondary">
              Sin atributos. Util si despues vas a crear mas variantes (talla, color, etc.)
            </Typography>
          )}
          {createForm.attributes.map((attr, idx) => (
            <Stack direction="row" spacing={1} key={idx} alignItems="center">
              <Autocomplete
                freeSolo
                options={attributeNames}
                value={attr.name}
                onInputChange={(_, value) => setAttr(idx, "name", value)}
                sx={{ flex: 1 }}
                renderInput={(params) => (
                  <TextField {...params} label="Nombre (Talla, Color, ...)" size="small" />
                )}
              />
              <TextField
                label="Valor"
                size="small"
                sx={{ flex: 1 }}
                value={attr.value}
                onChange={(e) => setAttr(idx, "value", e.target.value)}
              />
              <Tooltip title="Quitar">
                <IconButton
                  onClick={() =>
                    setCreateForm((p) => ({
                      ...p,
                      attributes: p.attributes.filter((_, i) => i !== idx),
                    }))
                  }
                  size="small"
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving}>
          {saving ? "Creando..." : "Crear producto"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
