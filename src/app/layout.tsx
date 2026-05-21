import type { Metadata } from "next";
import "./globals.css";
import AuthProvider from "../components/AuthProvider";
import Sidebar from "../components/Sidebar";

export const metadata: Metadata = {
  title: "ERIKA - Inteligencia en Ferretería",
  description: "Sistema avanzado de administración y punto de venta con IA.",
};

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
            <Sidebar />
            <main className="main-content" style={{ flex: 1, padding: '20px' }}>
              {children}
            </main>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
