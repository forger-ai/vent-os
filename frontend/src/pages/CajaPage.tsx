import { Alert, Box, Stack, Typography } from "@mui/material";

export default function CajaPage() {
  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5" fontWeight={700}>
          Caja
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Apertura y cierre de caja con resumen de ventas del turno.
        </Typography>
      </Box>
      <Alert severity="info">
        No hay caja abierta. La gestion de turno se implementara en una proxima
        version.
      </Alert>
    </Stack>
  );
}
