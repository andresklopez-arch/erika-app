"use client";
import { useAuth } from "./AuthProvider";

export default function Sidebar() {
  const { currentUser } = useAuth();

  if (!currentUser) return null;

  const isAdmin = currentUser.role === "admin";
  const p = currentUser.permissions || {};

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
          <a href="/">
            <span className="icon">🛒</span>
            <span className="nav-text">Punto de Venta</span>
          </a>
        )}
        {(isAdmin || p.dashboard) && (
          <a href="/dashboard">
            <span className="icon">📊</span>
            <span className="nav-text">Dashboard</span>
          </a>
        )}
        {(isAdmin || p.caja) && (
          <a href="/caja">
            <span className="icon">💵</span>
            <span className="nav-text">Arqueo de Caja</span>
          </a>
        )}
        {(isAdmin || p.servicios) && (
          <a href="/servicios">
            <span className="icon">📅</span>
            <span className="nav-text">Agenda de Servicios</span>
          </a>
        )}
        {(isAdmin || p.equipo) && (
          <a href="/equipo">
            <span className="icon">👥</span>
            <span className="nav-text">Equipo</span>
          </a>
        )}
        {(isAdmin || p.inventario) && (
          <a href="/inventario">
            <span className="icon">📦</span>
            <span className="nav-text">Almacén e Inventario</span>
          </a>
        )}
        {(isAdmin || p.reportes) && (
          <a href="/reportes">
            <span className="icon">📈</span>
            <span className="nav-text">Reportes e Inteligencia</span>
          </a>
        )}
        {(isAdmin || p.configuracion) && (
          <a href="/configuracion">
            <span className="icon">⚙️</span>
            <span className="nav-text">Configuración</span>
          </a>
        )}
      </nav>
    </aside>
  );
}
