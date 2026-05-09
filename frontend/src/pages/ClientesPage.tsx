import { Alert, Box, Stack, Typography } from "@mui/material";

export default function ClientesPage() {
  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5" fontWeight={700}>
          Clientes
        </Typography>
        <Typography variant="body2" color="text.secondary">
          RUT, razon social, giro y tipo de documento por defecto (boleta o
          factura).
        </Typography>
      </Box>
      <Alert severity="info">
        Sin clientes cargados. La administracion de clientes se implementara en
        una proxima version.
      </Alert>
    </Stack>
  );
}
