import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ERIKA - Inteligencia en Ferretería",
  description: "Sistema avanzado de administración y punto de venta con IA.",
};

import AuthProvider from "../components/AuthProvider";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>
        <AuthProvider>
        <div className="app-container" style={{ display: 'flex', minHeight: '100vh' }}>
          <aside className="glass-panel" style={{ width: '250px', margin: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="flex-center" style={{ flexDirection: 'column', textAlign: 'center' }}>
              <img src="/erika_avatar.png" alt="ERIKA" style={{ width: '100px', borderRadius: '50%', marginBottom: '10px', border: '2px solid var(--color-primary)' }} />
              <h2 style={{ color: 'var(--color-primary)' }}>ERIKA</h2>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-secondary)' }}>Sistema Online</span>
            </div>
            <nav style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px' }}>
              <a href="/" style={{ color: 'white', textDecoration: 'none', padding: '10px' }}>🛒 Punto de Venta</a>
              <a href="/dashboard" style={{ color: 'white', textDecoration: 'none', padding: '10px' }}>📊 Dashboard</a>
              <a href="/caja" style={{ color: 'white', textDecoration: 'none', padding: '10px' }}>💵 Arqueo de Caja</a>
              <a href="/equipo" style={{ color: 'white', textDecoration: 'none', padding: '10px' }}>👥 Equipo</a>
              <a href="/inventario" style={{ color: 'white', textDecoration: 'none', padding: '10px' }}>📦 Almacén e Inventario</a>
              <a href="/reportes" style={{ color: 'white', textDecoration: 'none', padding: '10px' }}>📈 Reportes e Inteligencia</a>
              <a href="/configuracion" style={{ color: 'white', textDecoration: 'none', padding: '10px' }}>⚙️ Configuración</a>
            </nav>
          </aside>
          <main className="main-content" style={{ flex: 1, padding: '20px' }}>
            {children}
          </main>
        </div>
        </AuthProvider>
      </body>
    </html>
  );
}
