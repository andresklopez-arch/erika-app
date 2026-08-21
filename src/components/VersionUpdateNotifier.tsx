"use client";
import React, { useEffect, useState } from "react";

export default function VersionUpdateNotifier() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });

    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return;

      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;

        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            setUpdateAvailable(true);
          }
        });
      });

      // Verificar si ya hay un worker esperando
      if (reg.waiting && navigator.serviceWorker.controller) {
        setUpdateAvailable(true);
      }
    });
  }, []);

  const handleUpdate = () => {
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg?.waiting) {
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
      }
      window.location.reload();
    });
  };

  if (!updateAvailable) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: "20px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 999999,
        background: "rgba(22, 22, 34, 0.95)",
        border: "1px solid var(--color-primary)",
        boxShadow: "0 8px 30px rgba(244, 63, 94, 0.35)",
        backdropFilter: "blur(12px)",
        borderRadius: "12px",
        padding: "10px 18px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        color: "white",
        fontSize: "0.85rem",
        animation: "fadeIn 0.3s ease",
      }}
      className="no-print"
    >
      <span>⚡ <strong>Nueva versión disponible de ERIKA</strong></span>
      <button
        onClick={handleUpdate}
        style={{
          background: "linear-gradient(135deg, var(--color-primary), var(--color-accent))",
          color: "white",
          border: "none",
          padding: "6px 14px",
          borderRadius: "8px",
          fontWeight: "bold",
          fontSize: "0.8rem",
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        }}
      >
        🔄 Actualizar ahora
      </button>
      <button
        onClick={() => setUpdateAvailable(false)}
        style={{
          background: "transparent",
          border: "none",
          color: "rgba(255,255,255,0.5)",
          cursor: "pointer",
          fontSize: "1rem",
          padding: "0 4px",
        }}
        title="Cerrar"
      >
        ✕
      </button>
    </div>
  );
}
