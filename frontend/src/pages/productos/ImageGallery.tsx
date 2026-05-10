import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import StarIcon from "@mui/icons-material/Star";
import UploadIcon from "@mui/icons-material/Upload";
import { ApiError } from "../../api/client";
import {
  type ImageRow,
  deleteImage,
  listProductImages,
  setImagePrimary,
  uploadProductImage,
} from "../../api/images";

interface ImageGalleryProps {
  productId: string;
}

export default function ImageGallery({ productId }: ImageGalleryProps) {
  const [images, setImages] = useState<ImageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listProductImages(productId);
      setImages(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las imagenes.");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset for re-uploading the same file
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const isPrimary = images.length === 0; // first image auto-promotes
      await uploadProductImage(productId, file, isPrimary);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo subir la imagen.");
    } finally {
      setUploading(false);
    }
  };

  const handleSetPrimary = async (img: ImageRow) => {
    try {
      await setImagePrimary(img.id, true);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo marcar como principal.");
    }
  };

  const handleDelete = async (img: ImageRow) => {
    if (!confirm("Eliminar esta imagen?")) return;
    try {
      await deleteImage(img.id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo eliminar la imagen.");
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="body2" color="text.secondary">
          Imagenes del producto (PNG/JPG/WEBP/GIF, max 8 MB). La marcada como
          principal es la que aparece en listados.
        </Typography>
        <Button
          variant="outlined"
          startIcon={<UploadIcon />}
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Subiendo..." : "Subir imagen"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          hidden
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={handleFileChange}
        />
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: 1.5,
        }}
      >
        {images.map((img) => (
          <Box
            key={img.id}
            sx={{
              position: "relative",
              borderRadius: 1,
              overflow: "hidden",
              border: "1px solid",
              borderColor: img.is_primary ? "primary.main" : "divider",
              aspectRatio: "1 / 1",
              backgroundColor: "grey.100",
            }}
          >
            <img
              src={`${img.url}?ts=${img.id}`}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
            {img.is_primary && (
              <Chip
                size="small"
                color="primary"
                label="Principal"
                icon={<StarIcon />}
                sx={{ position: "absolute", top: 4, left: 4 }}
              />
            )}
            <Stack
              direction="row"
              spacing={0.5}
              sx={{
                position: "absolute",
                bottom: 4,
                right: 4,
              }}
            >
              {!img.is_primary && (
                <Tooltip title="Marcar como principal">
                  <IconButton
                    size="small"
                    onClick={() => handleSetPrimary(img)}
                    sx={{ backgroundColor: "background.paper" }}
                  >
                    <StarBorderIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip title="Eliminar">
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => handleDelete(img)}
                  sx={{ backgroundColor: "background.paper" }}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          </Box>
        ))}
        {!loading && images.length === 0 && (
          <Box sx={{ gridColumn: "1 / -1", py: 3, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              Sin imagenes. Sube una para mostrarla en el listado.
            </Typography>
          </Box>
        )}
      </Box>
    </Stack>
  );
}
