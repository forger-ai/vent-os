import { Alert, Box, Stack, Typography } from "@mui/material";

export default function PosPage() {
  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5" fontWeight={700}>
          Punto de venta
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Carrito con busqueda de productos, calculo de IVA y seleccion de
          cliente para emitir documento.
        </Typography>
      </Box>
      <Alert severity="info">
        El flujo de venta se implementara en una proxima version. Esta es la
        base de la pantalla.
      </Alert>
    </Stack>
  );
}
