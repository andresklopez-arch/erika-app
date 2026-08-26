"use client";
import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import Image from "next/image";
import { Z_INDEX } from "../lib/zIndex";

interface AlertItem {
  id: string;
  type: "critical" | "warning" | "info";
  message: string;
  targetPath: string;
}

interface Props {
  // "floating" (default): el badge fijo arriba al centro, visible en toda
  // la app -- comportamiento de siempre. "inline": versión compacta para
  // insertar dentro de una barra existente (ver POSModule.tsx, barra
  // "Terminal Nube"), sin position:fixed y con textos/paddings más chicos
  // para no crecer esa barra. Cuando el layout raíz (layout.tsx) renderiza
  // la versión "floating" y la ruta actual es "/" (Punto de Venta, que ya
  // trae su propia versión "inline" en la barra), se omite por completo
  // para no duplicar el mismo badge dos veces en pantalla.
  variant?: "floating" | "inline";
}

export default function IntelligenceNotifications({ variant = "floating" }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { currentUser, logout } = useAuth();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchAlerts = async () => {
    try {
      const activeAlerts: AlertItem[] = [];

      // 1. Stock Crítico
      // Antes no filtraba productos eliminados: un producto dado de baja
      // seguía disparando la alerta global de "stock crítico" como si
      // siguiera necesitando resurtido.
      const { data: stockData } = await supabase
        .from("inventory")
        .select("id, name, stock, minStock")
        .or("deleted.is.null,deleted.eq.false");
      
      if (stockData) {
        const criticalCount = stockData.filter((i: any) => i.stock <= i.minStock).length;
        if (criticalCount > 0) {
          activeAlerts.push({
            id: "stock-critical",
            type: "critical",
            message: `📦 Stock Crítico: Quedan ${criticalCount} productos con inventario insuficiente.`,
            targetPath: "/inventario?tab=criticos"
          });
        }
      }

      // 2. Caja Abierta Olvidada (más de 24h sin cerrarse). Se detectó un
      // caso real de una caja abierta desde hace más de dos semanas —
      // como nadie la había cerrado, sus ventas nunca aparecían en ningún
      // corte ni reporte hasta que se cerró manualmente.
      const { data: openSessionData } = await supabase
        .from("cash_sessions")
        .select("id, opened_at, opened_by")
        .eq("status", "open")
        .order("opened_at", { ascending: true })
        .limit(1);

      if (openSessionData && openSessionData.length > 0) {
        const openSession = openSessionData[0];
        const hoursOpen = (Date.now() - new Date(openSession.opened_at).getTime()) / (1000 * 60 * 60);
        if (hoursOpen >= 24) {
          const days = Math.floor(hoursOpen / 24);
          activeAlerts.push({
            id: "stale-open-session",
            type: "critical",
            message: `⏰ Caja Olvidada: Abierta por ${openSession.opened_by || "alguien"} hace ${days} día(s) sin cerrarse. Sus ventas no aparecerán en ningún corte hasta que se cierre.`,
            targetPath: "/caja",
          });
        }
      }

      // 3. Descuadre en Caja (Última sesión cerrada)
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

      // 4. Fugas / Robo Hormiga (Simulado en base a cancelaciones/mermas en BD)
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

      // 5. Auditoría de Reimpresiones de Tickets (Últimos 7 días) - Siempre reportado
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: reprintData } = await supabase
        .from("error_logs")
        .select("id")
        .eq("module", "Ticket_Reimpresion")
        .gte("created_at", sevenDaysAgo);

      const reprintCount = reprintData ? reprintData.length : 0;
      activeAlerts.push({
        id: "reprints-report-7d",
        type: reprintCount >= 15 ? "warning" : "info",
        message: `🖨️ Auditoría: ${reprintCount} ticket(s) reimpreso(s) en los últimos 7 días.`,
        targetPath: "/"
      });

      // 6. Descuentos y Aumentos aplicados desde el último corte de caja
      try {
        const { data: currentOpenSession } = await supabase
          .from("cash_sessions")
          .select("id, opened_at")
          .eq("status", "open")
          .order("opened_at", { ascending: false })
          .limit(1);

        let cutoffTime: string;
        if (currentOpenSession && currentOpenSession.length > 0 && currentOpenSession[0].opened_at) {
          cutoffTime = currentOpenSession[0].opened_at;
        } else {
          const { data: lastClosedSession } = await supabase
            .from("cash_sessions")
            .select("id, closed_at")
            .eq("status", "closed")
            .order("closed_at", { ascending: false })
            .limit(1);

          if (lastClosedSession && lastClosedSession.length > 0 && lastClosedSession[0].closed_at) {
            cutoffTime = lastClosedSession[0].closed_at;
          } else {
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            cutoffTime = startOfDay.toISOString();
          }
        }

        const { data: ticketsSinceCut } = await supabase
          .from("quotes")
          .select("id, discount_pct, items, total, created_at")
          .in("status", ["ticket", "sale", "completed"])
          .gte("created_at", cutoffTime);

        let discountsCount = 0;
        let increasesCount = 0;
        let totalDiscountMoney = 0;
        let totalIncreaseMoney = 0;
        let highDiscountsCount = 0;

        if (ticketsSinceCut && ticketsSinceCut.length > 0) {
          ticketsSinceCut.forEach((t: any) => {
            const discPct = Number(t.discount_pct || 0);
            const totalVal = Number(t.total || 0);
            let itemsArr: any[] = [];
            if (typeof t.items === "string") {
              try { itemsArr = JSON.parse(t.items); } catch { itemsArr = []; }
            } else if (Array.isArray(t.items)) {
              itemsArr = t.items;
            }

            if (discPct > 0) {
              discountsCount++;
              if (discPct >= 15) highDiscountsCount++;
              const origTotal = discPct < 100 ? (totalVal / (1 - discPct / 100)) : totalVal;
              totalDiscountMoney += (origTotal - totalVal);
            } else if (discPct < 0) {
              increasesCount++;
              const factor = 1 + Math.abs(discPct) / 100;
              const origTotal = totalVal / factor;
              totalIncreaseMoney += (totalVal - origTotal);
            } else {
              let itemDiscountSum = 0;
              itemsArr.forEach((i: any) => {
                const itemDisc = Number(i.discountPct || 0);
                const itemPrice = Number(i.price || 0);
                const itemQty = Number(i.qty || 1);
                if (itemDisc > 0) {
                  if (itemDisc >= 15) highDiscountsCount++;
                  const regularPrice = itemDisc < 100 ? (itemPrice / (1 - itemDisc / 100)) : itemPrice;
                  itemDiscountSum += (regularPrice - itemPrice) * itemQty;
                } else if (itemPrice < 0) {
                  itemDiscountSum += Math.abs(itemPrice) * itemQty;
                }
              });
              if (itemDiscountSum > 0) {
                discountsCount++;
                totalDiscountMoney += itemDiscountSum;
              }
            }
          });
        }

        if (highDiscountsCount > 0) {
          activeAlerts.push({
            id: "high-discounts-alert",
            type: "critical",
            message: `🔥 Alerta Descuentos Altos: ${highDiscountsCount} venta(s) con descuento ≥ 15% (Ahorro concedido: -$${Math.round(totalDiscountMoney).toLocaleString("es-MX")}).`,
            targetPath: "/reportes"
          });
        }

        if (discountsCount > 0 || increasesCount > 0) {
          const parts: string[] = [];
          if (discountsCount > 0) parts.push(`${discountsCount} desc. (-$${Math.round(totalDiscountMoney).toLocaleString("es-MX")})`);
          if (increasesCount > 0) parts.push(`${increasesCount} aum. (+$${Math.round(totalIncreaseMoney).toLocaleString("es-MX")})`);

          activeAlerts.push({
            id: "discounts-increases-audit",
            type: discountsCount >= 5 ? "warning" : "info",
            message: `🏷️ Ajustes de Precios: ${parts.join(" y ")} en ventas desde el último corte de caja.`,
            targetPath: "/reportes"
          });
        } else {
          activeAlerts.push({
            id: "discounts-increases-audit-zero",
            type: "info",
            message: `🏷️ Ajustes de Precios: 0 descuentos o aumentos aplicados desde el último corte de caja.`,
            targetPath: "/reportes"
          });
        }
      } catch (discErr) {
        console.error("Error al calcular descuentos/aumentos para alertas:", discErr);
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
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "quotes" }, () => {
         fetchAlerts();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "quotes" }, () => {
         fetchAlerts();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "business_losses" }, () => {
         fetchAlerts();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "error_logs" }, () => {
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

  // La versión "inline" de Punto de Venta ya cubre este mismo badge dentro
  // de su propia barra -- evita mostrarlo dos veces en esa pantalla.
  if (variant === "floating" && pathname === "/") return null;

  const isInline = variant === "inline";

  return (
    <div
      ref={dropdownRef}
      style={isInline ? {
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
      } : {
        position: "fixed",
        top: "8px",
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
          gap: isInline ? "5px" : "8px",
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
            gap: isInline ? "4px" : "6px",
            background: isInline ? "transparent" : "rgba(22, 22, 34, 0.75)",
            backdropFilter: isInline ? "none" : "blur(10px)",
            border: isInline ? "none" : "1px solid var(--glass-border)",
            padding: isInline ? "0" : "3px 8px 3px 6px",
            borderRadius: "16px",
            boxShadow: isInline ? "none" : "0 2px 8px rgba(0,0,0,0.3)"
          }}
        >
          <Image
            src="/erika_avatar.png"
            alt="ERIKA"
            width={isInline ? 14 : 18}
            height={isInline ? 14 : 18}
            style={{
              borderRadius: "50%",
              border: "1.5px solid var(--color-primary)",
              objectFit: "cover"
            }}
          />
          {!isInline && (
            <span style={{ fontSize: "0.75rem", fontWeight: "bold", color: "white" }}>
              {currentUser?.name || "ERIKA"}
            </span>
          )}
          <span style={{
            fontSize: isInline ? "0.62rem" : "0.65rem",
            background: currentUser?.role === "admin" ? "rgba(244, 63, 94, 0.15)" : "rgba(16, 185, 129, 0.15)",
            color: currentUser?.role === "admin" ? "var(--color-primary)" : "var(--color-secondary)",
            border: isInline ? (currentUser?.role === "admin" ? "1px solid #f43f5e" : "1px solid var(--color-secondary)") : "none",
            padding: isInline ? "1px 4px" : "1px 5px",
            borderRadius: isInline ? "5px" : "8px",
            fontWeight: "600",
            whiteSpace: "nowrap",
          }}>
            {currentUser?.role?.toUpperCase() || "OFFLINE"}
          </span>
        </div>

        {/* Botón de Erika Inteligencia / Alertas */}
        <div
          style={{
            background: hasUrgentAlerts
              ? "linear-gradient(135deg, rgba(239, 68, 68, 0.95), rgba(220, 38, 38, 0.95))"
              : "linear-gradient(135deg, rgba(16, 185, 129, 0.85), rgba(5, 150, 105, 0.85))",
            backdropFilter: "blur(10px)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "white",
            padding: isInline ? "3px 7px" : "3px 10px",
            borderRadius: isInline ? "6px" : "16px",
            fontSize: isInline ? "0.68rem" : "0.75rem",
            fontWeight: "bold",
            display: "flex",
            alignItems: "center",
            gap: isInline ? "4px" : "6px",
            whiteSpace: "nowrap",
            boxShadow: hasUrgentAlerts
              ? "0 3px 10px rgba(239, 68, 68, 0.4), 0 0 0 1px rgba(239,68,68,0.2)"
              : "0 2px 8px rgba(0,0,0,0.3)",
            animation: hasUrgentAlerts ? "pulse-alert 2s infinite" : "none"
          }}
        >
          <span style={{ fontSize: isInline ? "0.68rem" : "0.75rem" }}>{hasUrgentAlerts ? "🚨" : "🧠"}</span>
          <span>{hasUrgentAlerts ? `${alerts.length} Alertas` : (isInline ? "Erika" : "Erika Inteligencia")}</span>
          {alerts.length > 0 && alerts[0].id !== "erika-ok" && (
            <span style={{
              background: "white",
              color: "#ef4444",
              borderRadius: "50%",
              width: isInline ? "12px" : "15px",
              height: isInline ? "12px" : "15px",
              fontSize: isInline ? "0.58rem" : "0.65rem",
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
            top: isInline ? "28px" : "38px",
            left: isInline ? "0" : "auto",
            zIndex: Z_INDEX.MODAL,
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
