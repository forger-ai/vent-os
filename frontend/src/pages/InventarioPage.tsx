import { Alert, Box, Stack, Typography } from "@mui/material";

export default function InventarioPage() {
  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5" fontWeight={700}>
          Inventario
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Movimientos de entrada, salida y ajuste de stock con motivo y
          documento opcional.
        </Typography>
      </Box>
      <Alert severity="info">
        Sin movimientos registrados. El control de inventario se implementara
        en una proxima version.
      </Alert>
    </Stack>
  );
}
