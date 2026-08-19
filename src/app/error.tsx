"use client";

import { useEffect } from "react";

// Boundary de error global de Next.js. Antes no existía ninguno en todo el
// proyecto: si algo lanzaba una excepción no controlada durante el render
// (ej. JSON.parse de una sesión corrupta en localStorage), React desmontaba
// el árbol completo y el usuario se quedaba con una pantalla en blanco sin
// ningún botón para recuperarse, salvo abrir DevTools y borrar el storage
// manualmente.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Error no controlado en la aplicación:", error);
  }, [error]);

  const handleResetSession = () => {
    try {
      localStorage.removeItem("ERIKA_USER");
    } catch (e) {
      // ignore
    }
    window.location.href = "/";
  };

  return (
    <html lang="es">
      <body>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            background: "#0f172a",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div
            style={{
              maxWidth: "440px",
              width: "100%",
              textAlign: "center",
              padding: "40px",
              borderRadius: "12px",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              background: "rgba(0,0,0,0.4)",
              color: "white",
            }}
          >
            <div style={{ fontSize: "3rem", marginBottom: "16px" }}>⚠️</div>
            <h2 style={{ marginBottom: "12px", color: "#ef4444" }}>
              Algo salió mal
            </h2>
            <p style={{ opacity: 0.8, marginBottom: "24px", fontSize: "0.9rem" }}>
              Ocurrió un error inesperado. Puedes intentar continuar, o
              cerrar la sesión y volver a empezar si el problema persiste.
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
              <button
                onClick={() => reset()}
                style={{
                  padding: "10px 20px",
                  borderRadius: "6px",
                  border: "1px solid #10b981",
                  background: "transparent",
                  color: "#10b981",
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                Reintentar
              </button>
              <button
                onClick={handleResetSession}
                style={{
                  padding: "10px 20px",
                  borderRadius: "6px",
                  border: "none",
                  background: "#ef4444",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                Cerrar Sesión y Reiniciar
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
