import { Alert, Box, Stack, Typography } from "@mui/material";

export default function ProductosPage() {
  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5" fontWeight={700}>
          Productos
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Catalogo con SKU, precio, unidad, IVA y stock actual.
        </Typography>
      </Box>
      <Alert severity="info">
        Sin productos cargados. La administracion de catalogo se implementara
        en una proxima version.
      </Alert>
    </Stack>
  );
}
