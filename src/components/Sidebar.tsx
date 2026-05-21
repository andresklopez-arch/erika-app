"use client";
import { useAuth } from "./AuthProvider";

export default function Sidebar() {
  const { currentUser } = useAuth();
  
  // Si no hay usuario (está en login), no mostrar sidebar (o mostrar uno vacío/bloqueado)
  // El AuthProvider ya bloquea la pantalla, pero es buena práctica verificar
  if (!currentUser) return null;

  const isAdmin = currentUser.role === 'admin';
  const p = currentUser.permissions || {};

  return (
    <aside className="glass-panel" style={{ width: '250px', margin: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="flex-center" style={{ flexDirection: 'column', textAlign: 'center' }}>
        <img src="/erika_avatar.png" alt="ERIKA" style={{ width: '100px', borderRadius: '50%', marginBottom: '10px', border: '2px solid var(--color-primary)' }} />
        <h2 style={{ color: 'var(--color-primary)' }}>ERIKA</h2>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-secondary)' }}>Sistema Online</span>
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px' }}>
        {(isAdmin || p.pos) && <a href="/" style={{ color: 'white', textDecoration: 'none', padding: '10px' }}>🛒 Punto de Venta</a>}
        {(isAdmin || p.dashboard) && <a href="/dashboard" style={{ color: 'white', textDecoration: 'none', padding: '10px' }}>📊 Dashboard</a>}
        {(isAdmin || p.caja) && <a href="/caja" style={{ color: 'white', textDecoration: 'none', padding: '10px' }}>💵 Arqueo de Caja</a>}
        {(isAdmin || p.equipo) && <a href="/equipo" style={{ color: 'white', textDecoration: 'none', padding: '10px' }}>👥 Equipo</a>}
        {(isAdmin || p.inventario) && <a href="/inventario" style={{ color: 'white', textDecoration: 'none', padding: '10px' }}>📦 Almacén e Inventario</a>}
        {(isAdmin || p.reportes) && <a href="/reportes" style={{ color: 'white', textDecoration: 'none', padding: '10px' }}>📈 Reportes e Inteligencia</a>}
        {(isAdmin || p.configuracion) && <a href="/configuracion" style={{ color: 'white', textDecoration: 'none', padding: '10px' }}>⚙️ Configuración</a>}
      </nav>
    </aside>
  );
}
