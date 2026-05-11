import { useEffect, useState } from "react";
import {
  AppBar,
  Box,
  Chip,
  CircularProgress,
  Container,
  Tab,
  Tabs,
  Toolbar,
  Typography,
} from "@mui/material";
import { get } from "./api/client";
import ProductosPage from "./pages/ProductosPage";
import ClientesPage from "./pages/ClientesPage";
import CobranzaPage from "./pages/CobranzaPage";
import HomePage from "./pages/HomePage";
import PosPage from "./pages/PosPage";
import DocumentosPage from "./pages/DocumentosPage";
import InventarioPage from "./pages/InventarioPage";
import CajaPage from "./pages/CajaPage";
import ConfiguracionPage from "./pages/ConfiguracionPage";

type HealthStatus = "loading" | "ok" | "error";

const TABS = [
  { id: "home", label: "Inicio" },
  { id: "pos", label: "POS" },
  { id: "productos", label: "Productos" },
  { id: "clientes", label: "Clientes" },
  { id: "documentos", label: "Documentos" },
  { id: "cobranza", label: "Cobranza" },
  { id: "inventario", label: "Inventario" },
  { id: "caja", label: "Caja" },
  { id: "config", label: "Configuracion" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function App() {
  const [status, setStatus] = useState<HealthStatus>("loading");
  const [tab, setTab] = useState<TabId>("home");

  useEffect(() => {
    get<{ status: string }>("/api/health")
      .then((data) => setStatus(data.status === "ok" ? "ok" : "error"))
      .catch(() => setStatus("error"));
  }, []);

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography variant="h6" fontWeight={700} sx={{ flexGrow: 0 }}>
            Vent OS
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ flexGrow: 1 }}
          >
            Punto de venta e inventario para tu Pyme
          </Typography>
          {status === "loading" && <CircularProgress size={18} />}
          {status === "ok" && (
            <Chip label="API conectada" color="success" size="small" variant="outlined" />
          )}
          {status === "error" && (
            <Chip label="API no disponible" color="error" size="small" variant="outlined" />
          )}
        </Toolbar>
        <Tabs
          value={tab}
          onChange={(_, value) => setTab(value as TabId)}
          variant="scrollable"
          scrollButtons="auto"
        >
          {TABS.map((t) => (
            <Tab key={t.id} value={t.id} label={t.label} />
          ))}
        </Tabs>
      </AppBar>

      <Container maxWidth="lg" sx={{ flexGrow: 1, py: 3 }}>
        {tab === "home" && <HomePage />}
        {tab === "pos" && <PosPage />}
        {tab === "productos" && <ProductosPage />}
        {tab === "clientes" && <ClientesPage />}
        {tab === "documentos" && <DocumentosPage />}
        {tab === "cobranza" && <CobranzaPage />}
        {tab === "inventario" && <InventarioPage />}
        {tab === "caja" && <CajaPage />}
        {tab === "config" && <ConfiguracionPage />}
      </Container>
    </Box>
  );
}
