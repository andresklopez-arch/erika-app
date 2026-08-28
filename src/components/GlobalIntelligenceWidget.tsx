"use client";
import { usePathname } from "next/navigation";
import IntelligenceNotifications from "./IntelligenceNotifications";

// La versión flotante (arriba, centrada) se oculta específicamente en la
// pantalla del POS ("/"): ahí vive la versión "inline", compacta, dentro de
// la barra inferior de POSModule.tsx (junto a "Terminal Nube") para no
// encimarse con el carrito ni el buscador de productos. En el resto de la
// app (Dashboard, Inventario, etc.) sigue apareciendo flotante como antes.
export default function GlobalIntelligenceWidget() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return <IntelligenceNotifications />;
}
