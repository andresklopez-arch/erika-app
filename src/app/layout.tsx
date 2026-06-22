import type { Metadata, Viewport } from "next";
import "./globals.css";
import AuthProvider from "../components/AuthProvider";
import Sidebar from "../components/Sidebar";
import HomeButton from "../components/HomeButton";
import IntelligenceNotifications from "../components/IntelligenceNotifications";
import TasksWidget from "../components/TasksWidget";
import { Toaster } from "react-hot-toast";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";

export const metadata: Metadata = {
  title: "YoY IA ERIKA - Inteligencia en Ferretería",
  description: "Sistema avanzado de administración y punto de venta con IA.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "YoY IA ERIKA",
  },
};

export const viewport: Viewport = {
  themeColor: "#10b981",
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
          <div
            className="app-container"
            style={{ display: "flex", minHeight: "100vh" }}
          >
            <Sidebar />
            <main className="main-content" style={{ flex: 1, padding: "20px", display: "flex", flexDirection: "column", minWidth: 0 }}>
              <IntelligenceNotifications />
              <HomeButton />
              {children}
            </main>
            <TasksWidget />
          </div>
        </AuthProvider>
        <Toaster position="top-right" containerStyle={{ zIndex: 999999 }} />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').then(function(registration) {
                    console.log('ServiceWorker registration successful');
                  }, function(err) {
                    console.log('ServiceWorker registration failed: ', err);
                  });
                });
              }
            `,
          }}
        />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
