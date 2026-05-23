"use client";
import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { useRouter } from "next/navigation";

interface AlertItem {
  id: string;
  type: "critical" | "warning" | "info";
  message: string;
  targetPath: string;
}

export default function IntelligenceNotifications() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchAlerts = async () => {
    try {
      const activeAlerts: AlertItem[] = [];

      // 1. Stock Crítico
      const { data: stockData } = await supabase
        .from("inventory")
        .select("id, name, stock, minStock");
      
      if (stockData) {
        const criticalCount = stockData.filter(i => i.stock <= i.minStock).length;
        if (criticalCount > 0) {
          activeAlerts.push({
            id: "stock-critical",
            type: "critical",
            message: `📦 Stock Crítico: Quedan ${criticalCount} productos con inventario insuficiente.`,
            targetPath: "/inventario?tab=criticos"
          });
        }
      }

      // 2. Descuadre en Caja (Última sesión cerrada)
      const { data: sessionData } = await supabase
        .from("cash_sessions")
        .select("id, discrepancy, closed_at")
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(1);

      if (sessionData && sessionData.length > 0) {
        const lastSession = sessionData[0];
        const discrepancy = parseFloat(lastSession.discrepancy || "0");
        if (discrepancy <= -100) {
          activeAlerts.push({
            id: "cash-discrepancy",
            type: "critical",
            message: `💵 Faltante en Caja: Descuadre de -$${Math.abs(discrepancy).toFixed(2)} en el último arqueo.`,
            targetPath: "/reportes"
          });
        }
      }

      // 3. Fugas / Robo Hormiga (Simulado en base a cancelaciones/mermas en BD)
      // Buscamos si hay mermas en business_losses en las últimas 24 horas
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: lossData } = await supabase
        .from("business_losses")
        .select("id")
        .gte("created_at", yesterday);
      
      if (lossData && lossData.length > 0) {
        activeAlerts.push({
          id: "losses-warning",
          type: "warning",
          message: `🔍 Posible Fuga: Registradas ${lossData.length} mermas o pérdidas en las últimas 24 horas.`,
          targetPath: "/inventario?tab=gastos"
        });
      }

      // Si no hay alertas reales, agregamos una informativa del motor IA ERIKA
      if (activeAlerts.length === 0) {
        activeAlerts.push({
          id: "erika-ok",
          type: "info",
          message: "🟢 ERIKA: Operaciones estables. No hay alertas de fugas o fallas de stock hoy.",
          targetPath: "/dashboard"
        });
      }

      setAlerts(activeAlerts);
    } catch (e) {
      console.error("Error al cargar alertas de inteligencia:", e);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAlerts();
    // Re-escanear alertas cada 2 minutos como fallback
    const interval = setInterval(fetchAlerts, 120000);

    // Suscripción Realtime a cambios en base de datos para alertas inmediatas
    const channel = supabase
      .channel("erika-alerts-channel")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "inventory" }, () => {
         fetchAlerts();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cash_sessions" }, () => {
         fetchAlerts();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "cash_sessions" }, () => {
         fetchAlerts();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "business_losses" }, () => {
         fetchAlerts();
      })
      .subscribe();
    
    // Cerrar al hacer clic afuera
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleAlertClick = (targetPath: string) => {
    setIsOpen(false);
    router.push(targetPath);
  };

  const hasUrgentAlerts = alerts.some(a => a.type === "critical" || a.type === "warning");

  return (
    <div 
      ref={dropdownRef}
      style={{
        position: "fixed",
        top: "15px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center"
      }}
      className="no-print"
    >
      {/* Botón flotante superior minimalista y elegante */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: hasUrgentAlerts 
            ? "linear-gradient(135deg, rgba(239, 68, 68, 0.95), rgba(220, 38, 38, 0.95))"
            : "linear-gradient(135deg, rgba(16, 185, 129, 0.85), rgba(5, 150, 105, 0.85))",
          backdropFilter: "blur(10px)",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "white",
          padding: "8px 16px",
          borderRadius: "20px",
          cursor: "pointer",
          fontSize: "0.85rem",
          fontWeight: "bold",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          boxShadow: hasUrgentAlerts 
            ? "0 4px 15px rgba(239, 68, 68, 0.4), 0 0 0 1px rgba(239,68,68,0.2)"
            : "0 4px 12px rgba(0,0,0,0.3)",
          transition: "all 0.3s ease",
          animation: hasUrgentAlerts ? "pulse-alert 2s infinite" : "none"
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.03)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
        }}
      >
        <span>{hasUrgentAlerts ? "🚨" : "🧠"}</span>
        <span>Erika Inteligencia</span>
        {alerts.length > 0 && alerts[0].id !== "erika-ok" && (
          <span style={{
            background: "white",
            color: "#ef4444",
            borderRadius: "50%",
            width: "18px",
            height: "18px",
            fontSize: "0.75rem",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: "bold"
          }}>
            {alerts.length}
          </span>
        )}
      </button>

      {/* Menú de Notificaciones Desplegable */}
      {isOpen && (
        <div
          className="glass-panel animate-fade-in"
          style={{
            position: "absolute",
            top: "45px",
            width: "350px",
            background: "rgba(22, 22, 34, 0.95)",
            border: "1px solid var(--glass-border)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
            borderRadius: "12px",
            overflow: "hidden",
            padding: "10px"
          }}
        >
          <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: "0.85rem", color: "var(--color-primary)" }}>Alertas y Notificaciones</strong>
            <button 
              onClick={fetchAlerts} 
              style={{ background: "transparent", border: "none", color: "var(--color-secondary)", cursor: "pointer", fontSize: "0.75rem" }}
            >
              🔄 Recargar
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "250px", overflowY: "auto" }}>
            {alerts.map((alert) => {
              const borderCol = alert.type === "critical" ? "#ef4444" : alert.type === "warning" ? "#eab308" : "#10b981";
              return (
                <div
                  key={alert.id}
                  onClick={() => handleAlertClick(alert.targetPath)}
                  style={{
                    background: "rgba(0,0,0,0.3)",
                    borderLeft: `4px solid ${borderCol}`,
                    padding: "10px",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                    color: "white",
                    transition: "background 0.2s ease",
                    textAlign: "left"
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "rgba(0,0,0,0.3)"}
                >
                  {alert.message}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Animación especial de latido en CSS */}
      <style>{`
        @keyframes pulse-alert {
          0% {
            box-shadow: 0 4px 15px rgba(239, 68, 68, 0.4);
          }
          50% {
            box-shadow: 0 4px 20px rgba(239, 68, 68, 0.7), 0 0 0 6px rgba(239, 68, 68, 0.1);
          }
          100% {
            box-shadow: 0 4px 15px rgba(239, 68, 68, 0.4);
          }
        }
      `}</style>
    </div>
  );
}
