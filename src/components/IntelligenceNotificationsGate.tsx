"use client";
import { usePathname } from "next/navigation";
import IntelligenceNotifications from "./IntelligenceNotifications";

// Punto de Venta ("/") ya renderiza su propia instancia variant="inline"
// dentro de su barra de herramientas (ver POSModule.tsx). Este gate evita
// que layout.tsx TAMBIÉN monte la instancia flotante ahí -- si ambas
// llegaban a montarse a la vez, cada una abría su propia suscripción
// Realtime al mismo canal fijo ("erika-alerts-channel" en
// IntelligenceNotifications.tsx), lo que tronaba toda la app con la
// pantalla de error global (2026-08-26). Ocultar solo el JSX (return
// null condicional DENTRO del componente) no alcanzaba: los hooks de esa
// instancia igual se montaban y creaban el canal duplicado. La solución
// real es que la instancia flotante ni siquiera exista en esta ruta.
export default function IntelligenceNotificationsGate() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return <IntelligenceNotifications />;
}
