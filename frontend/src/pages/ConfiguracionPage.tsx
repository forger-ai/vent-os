import { useState } from "react";
import { Box, Stack, Tab, Tabs, Typography } from "@mui/material";
import ImpuestosTab from "./configuracion/ImpuestosTab";
import MetodosPagoTab from "./configuracion/MetodosPagoTab";
import PreciosTab from "./configuracion/PreciosTab";

type TabKey = "impuestos" | "precios" | "metodos_pago";

const TABS: { key: TabKey; label: string }[] = [
  { key: "impuestos", label: "Impuestos" },
  { key: "precios", label: "Listas de precios" },
  { key: "metodos_pago", label: "Métodos de pago" },
];

export default function ConfiguracionPage() {
  const [tab, setTab] = useState<TabKey>("impuestos");

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5" fontWeight={700}>
          Configuración
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Códigos de impuestos adicionales (ILA, específicos, azucaradas) y listas de
          precios alternativas (minorista, mayorista, VIP).
        </Typography>
      </Box>

      <Tabs value={tab} onChange={(_, v) => setTab(v as TabKey)}>
        {TABS.map((t) => (
          <Tab key={t.key} value={t.key} label={t.label} />
        ))}
      </Tabs>

      <Box sx={{ pt: 1 }}>
        {tab === "impuestos" && <ImpuestosTab />}
        {tab === "precios" && <PreciosTab />}
        {tab === "metodos_pago" && <MetodosPagoTab />}
      </Box>
    </Stack>
  );
}
