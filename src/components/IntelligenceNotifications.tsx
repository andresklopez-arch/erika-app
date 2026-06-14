"use client";
import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import Image from "next/image";

interface AlertItem {
  id: string;
  type: "critical" | "warning" | "info";
  message: string;
  targetPath: string;
}

export default function IntelligenceNotifications() {
  const router = useRouter();
  const { currentUser, logout } = useAuth();
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
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{ 
          display: "flex", 
          alignItems: "center", 
          gap: "10px",
          cursor: "pointer",
          transition: "transform 0.2s ease"
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.02)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
        }}
      >
        {/* ERIKA Logo/Avatar & Status Badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "rgba(22, 22, 34, 0.75)",
            backdropFilter: "blur(10px)",
            border: "1px solid var(--glass-border)",
            padding: "6px 14px 6px 8px",
            borderRadius: "20px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)"
          }}
        >
          <Image
            src="/erika_avatar.png"
            alt="ERIKA"
            width={24}
            height={24}
            style={{
              borderRadius: "50%",
              border: "1.5px solid var(--color-primary)",
              objectFit: "cover"
            }}
          />
          <span style={{ fontSize: "0.85rem", fontWeight: "bold", color: "white" }}>
            {currentUser?.name || "ERIKA"}
          </span>
          <span style={{ 
            fontSize: "0.7rem", 
            background: currentUser?.role === "admin" ? "rgba(244, 63, 94, 0.15)" : "rgba(16, 185, 129, 0.15)",
            color: currentUser?.role === "admin" ? "var(--color-primary)" : "var(--color-secondary)",
            padding: "2px 6px",
            borderRadius: "10px",
            fontWeight: "600"
          }}>
            {currentUser?.role?.toUpperCase() || "OFFLINE"}
          </span>
        </div>

        {/* Botón flotante de Erika Inteligencia */}
        <div
          style={{
            background: hasUrgentAlerts 
              ? "linear-gradient(135deg, rgba(239, 68, 68, 0.95), rgba(220, 38, 38, 0.95))"
              : "linear-gradient(135deg, rgba(16, 185, 129, 0.85), rgba(5, 150, 105, 0.85))",
            backdropFilter: "blur(10px)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "white",
            padding: "8px 16px",
            borderRadius: "20px",
            fontSize: "0.85rem",
            fontWeight: "bold",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            boxShadow: hasUrgentAlerts 
              ? "0 4px 15px rgba(239, 68, 68, 0.4), 0 0 0 1px rgba(239,68,68,0.2)"
              : "0 4px 12px rgba(0,0,0,0.3)",
            animation: hasUrgentAlerts ? "pulse-alert 2s infinite" : "none"
          }}
        >
          <span>{hasUrgentAlerts ? "🚨" : "🧠"}</span>
          <span>{hasUrgentAlerts ? `${alerts.length} Alertas` : "Erika Inteligencia"}</span>
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
        </div>
      </div>

      {/* Panel Unificado Desplegable (Perfil + Alertas) */}
      {isOpen && (
        <div
          className="glass-panel animate-fade-in"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: "50px",
            width: "360px",
            background: "rgba(22, 22, 34, 0.96)",
            border: "1px solid var(--glass-border)",
            boxShadow: "0 15px 35px rgba(0,0,0,0.6)",
            borderRadius: "16px",
            overflow: "hidden",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "14px"
          }}
        >
          {/* SECCIÓN PERFIL DE EMPLEADO */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Image
                src="/erika_avatar.png"
                alt="Avatar"
                width={36}
                height={36}
                style={{ borderRadius: "50%", border: "2px solid var(--color-primary)", objectFit: "cover" }}
              />
              <div style={{ display: "flex", flexDirection: "column", textAlign: "left" }}>
                <span style={{ fontSize: "0.9rem", fontWeight: "bold", color: "white" }}>{currentUser?.name || "Cajero"}</span>
                <span style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.5)" }}>Sesión de {currentUser?.role === "admin" ? "Administrador" : "Cajero"}</span>
              </div>
            </div>
            
            <button
              onClick={() => { logout(); setIsOpen(false); }}
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#ef4444",
                padding: "6px 12px",
                borderRadius: "12px",
                fontSize: "0.75rem",
                fontWeight: "bold",
                cursor: "pointer",
                transition: "all 0.2s ease"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(239, 68, 68, 0.25)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)";
              }}
            >
              🚪 Salir
            </button>
          </div>

          {/* SECCIÓN ALERTAS DE INTELIGENCIA */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <strong style={{ fontSize: "0.85rem", color: "var(--color-primary)" }}>Alertas de Inteligencia</strong>
              <button 
                onClick={(e) => { e.stopPropagation(); fetchAlerts(); }} 
                style={{ background: "transparent", border: "none", color: "var(--color-secondary)", cursor: "pointer", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "3px" }}
              >
                🔄 Actualizar
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "250px", overflowY: "auto" }}>
              {alerts.length === 0 ? (
                <div style={{
                  padding: "15px",
                  color: "rgba(255,255,255,0.4)",
                  fontSize: "0.85rem",
                  textAlign: "center",
                  border: "1px dashed rgba(255,255,255,0.1)",
                  borderRadius: "8px"
                }}>
                  No hay alertas activas hoy
                </div>
              ) : (
                alerts.map((alert) => {
                  const borderCol = alert.type === "critical" ? "#ef4444" : alert.type === "warning" ? "#eab308" : "#10b981";
                  const bgCol = alert.type === "critical" ? "rgba(239, 68, 68, 0.05)" : alert.type === "warning" ? "rgba(234, 179, 8, 0.05)" : "rgba(16, 185, 129, 0.05)";
                  return (
                    <div
                      key={alert.id}
                      onClick={() => handleAlertClick(alert.targetPath)}
                      style={{
                        background: bgCol,
                        borderLeft: `4px solid ${borderCol}`,
                        border: `1px solid rgba(255,255,255,0.03)`,
                        borderLeftWidth: "4px",
                        padding: "10px",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "0.8rem",
                        color: "white",
                        transition: "all 0.2s ease",
                        textAlign: "left"
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = bgCol}
                    >
                      {alert.message}
                    </div>
                  );
                })
              )}
            </div>
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
