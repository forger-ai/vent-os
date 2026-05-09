import { Alert, Box, Stack, Typography } from "@mui/material";

export default function DocumentosPage() {
  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5" fontWeight={700}>
          Documentos
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Boletas, facturas y notas de venta registradas localmente con folio
          interno.
        </Typography>
      </Box>
      <Alert severity="warning">
        Esta version <strong>no emite documentos electronicos al SII</strong>.
        Los documentos se registran de forma local con folio interno.
      </Alert>
    </Stack>
  );
}
