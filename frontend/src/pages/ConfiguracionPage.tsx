import { useState } from "react";
import { Box, Stack, Tab, Tabs, Typography } from "@mui/material";
import ImpuestosTab from "./configuracion/ImpuestosTab";
import PreciosTab from "./configuracion/PreciosTab";

type TabKey = "impuestos" | "precios";

const TABS: { key: TabKey; label: string }[] = [
  { key: "impuestos", label: "Impuestos" },
  { key: "precios", label: "Listas de precios" },
];

export default function ConfiguracionPage() {
  const [tab, setTab] = useState<TabKey>("impuestos");

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5" fontWeight={700}>
          Configuracion
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Codigos de impuestos adicionales (ILA, especificos, azucaradas) y listas de
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
      </Box>
    </Stack>
  );
}
