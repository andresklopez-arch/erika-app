"use client";
import { useAuth } from "./AuthProvider";
import { usePathname } from "next/navigation";

export default function Sidebar() {
  const { currentUser } = useAuth();
  const pathname = usePathname();

  if (!currentUser) return null;

  const isAdmin = currentUser.role === "admin";
  const p = currentUser.permissions || {};

  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === "/";
    }
    return pathname ? pathname.startsWith(href) : false;
  };

  return (
    <aside className="glass-panel sidebar-container">
      <div className="flex-center" style={{ flexDirection: "column", textAlign: "center" }}>
        <img src="/erika_avatar.png" alt="ERIKA" className="avatar" />
        <div className="title-container">
          <h2 style={{ color: "var(--color-primary)" }}>ERIKA</h2>
          <span style={{ fontSize: "0.8rem", color: "var(--color-secondary)" }}>Sistema Online</span>
        </div>
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "20px" }}>
        {(isAdmin || p.pos) && (
          <a href="/" className={isActive("/") ? "active" : ""}>
            <span className="icon">🛒</span>
            <span className="nav-text">Punto de Venta</span>
          </a>
        )}
        {(isAdmin || p.dashboard) && (
          <a href="/dashboard" className={isActive("/dashboard") ? "active" : ""}>
            <span className="icon">📊</span>
            <span className="nav-text">Dashboard</span>
          </a>
        )}
        {(isAdmin || p.caja) && (
          <a href="/caja" className={isActive("/caja") ? "active" : ""}>
            <span className="icon">💵</span>
            <span className="nav-text">Arqueo de Caja</span>
          </a>
        )}
        {(isAdmin || p.servicios) && (
          <a href="/servicios" className={isActive("/servicios") ? "active" : ""}>
            <span className="icon">📅</span>
            <span className="nav-text">Agenda de Servicios</span>
          </a>
        )}
        {(isAdmin || p.equipo) && (
          <a href="/equipo" className={isActive("/equipo") ? "active" : ""}>
            <span className="icon">👥</span>
            <span className="nav-text">Equipo</span>
          </a>
        )}
        {(isAdmin || p.inventario) && (
          <a href="/inventario" className={isActive("/inventario") ? "active" : ""}>
            <span className="icon">📦</span>
            <span className="nav-text">Almacén e Inventario</span>
          </a>
        )}
        {(isAdmin || p.reportes) && (
          <a href="/reportes" className={isActive("/reportes") ? "active" : ""}>
            <span className="icon">📈</span>
            <span className="nav-text">Reportes e Inteligencia</span>
          </a>
        )}
        {(isAdmin || p.configuracion) && (
          <a href="/configuracion" className={isActive("/configuracion") ? "active" : ""}>
            <span className="icon">⚙️</span>
            <span className="nav-text">Configuración</span>
          </a>
        )}
      </nav>
    </aside>
  );
}

