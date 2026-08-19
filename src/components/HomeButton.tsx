"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "./AuthProvider";

export default function HomeButton() {
  const pathname = usePathname();
  const { currentUser } = useAuth();

  // No mostrar el botón si ya estamos en el Punto de Venta (Home)
  if (pathname === "/") return null;
  // Tampoco mostrarlo si el usuario no tiene permiso de POS: "/" ahora
  // exige permiso "pos" (antes cualquier usuario autenticado podía entrar
  // ahí sin importar sus permisos), así que ofrecer este botón a alguien
  // sin acceso solo lo llevaría a una pantalla de "Acceso Restringido".
  const canAccessHome =
    currentUser?.role === "admin" || currentUser?.permissions?.pos === true;
  if (!canAccessHome) return null;

  return (
    <div style={{ marginBottom: "15px", display: "flex", justifyContent: "flex-end" }}>
      <Link href="/">
        <button
          className="btn-primary"
          style={{
            background: "rgba(255,255,255,0.1)",
            color: "white",
            border: "1px solid var(--glass-border)",
            padding: "8px 15px",
            fontSize: "0.9rem",
          }}
        >
          🏠 Ir a Punto de Venta (Home)
        </button>
      </Link>
    </div>
  );
}
