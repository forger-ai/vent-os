import { useState } from "react";
import { Box, Stack, Tab, Tabs, Typography } from "@mui/material";
import BodegasTab from "./inventario/BodegasTab";
import LotesTab from "./inventario/LotesTab";
import MovimientosTab from "./inventario/MovimientosTab";
import StockTab from "./inventario/StockTab";
import ValuationTab from "./inventario/ValuationTab";

type TabKey = "stock" | "movimientos" | "bodegas" | "lotes" | "valorizacion";

const TABS: { key: TabKey; label: string }[] = [
  { key: "stock", label: "Stock" },
  { key: "movimientos", label: "Movimientos" },
  { key: "bodegas", label: "Bodegas" },
  { key: "lotes", label: "Lotes" },
  { key: "valorizacion", label: "Valorización" },
];

export default function InventarioPage() {
  const [tab, setTab] = useState<TabKey>("stock");

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5" fontWeight={700}>
          Inventario
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Stock por variante y bodega, historial de movimientos, gestión de bodegas y
          lotes con vencimientos.
        </Typography>
      </Box>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v as TabKey)}
        variant="scrollable"
        scrollButtons="auto"
      >
        {TABS.map((t) => (
          <Tab key={t.key} value={t.key} label={t.label} />
        ))}
      </Tabs>

      <Box sx={{ pt: 1 }}>
        {tab === "stock" && <StockTab />}
        {tab === "movimientos" && <MovimientosTab />}
        {tab === "bodegas" && <BodegasTab />}
        {tab === "lotes" && <LotesTab />}
        {tab === "valorizacion" && <ValuationTab />}
      </Box>
    </Stack>
  );
}
