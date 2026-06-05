"use client";
import React, { useState, useEffect, Component, ErrorInfo, ReactNode } from "react";
import dynamic from "next/dynamic";
import ProtectedRoute from "../../components/ProtectedRoute";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from "recharts";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../components/AuthProvider";

// 1. Error Boundary para robustecer la importación dinámica frente a fallos de red
interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class ReportsErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false
  };

  public static getDerivedStateFromError(_: Error): ErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Error al cargar ReportsModule dinámicamente:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: "40px",
          textAlign: "center",
          color: "#ef4444",
          background: "rgba(239, 68, 68, 0.05)",
          borderRadius: "12px",
          border: "1px dashed rgba(239, 68, 68, 0.3)",
          marginTop: "20px"
        }}>
          <span style={{ fontSize: "2.5rem", display: "block", marginBottom: "10px" }}>⚠️</span>
          <h3 style={{ margin: "10px 0 5px 0", color: "#ef4444", fontWeight: "bold" }}>Error de conexión al cargar la Inteligencia</h3>
          <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.95rem", maxWidth: "450px", margin: "0 auto 20px auto", lineHeight: 1.4 }}>
            No pudimos descargar el módulo de Inteligencia de Erika. Esto suele ocurrir por microcortes en la conexión a internet.
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="btn-primary"
            style={{
              background: "#ef4444",
              border: "none",
              color: "white",
              padding: "10px 24px",
              borderRadius: "8px",
              fontWeight: "bold",
              cursor: "pointer",
              boxShadow: "0 4px 15px rgba(239, 68, 68, 0.25)",
              transition: "all 0.2s"
            }}
          >
            🔄 Reintentar Carga
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// 2. Importación dinámica con preloading spinner premium
const ReportsModule = dynamic(() => import("../../components/ReportsModule"), {
  ssr: false,
  loading: () => (
    <div style={{
      padding: "40px",
      textAlign: "center",
      color: "var(--color-primary)",
      background: "rgba(255, 255, 255, 0.02)",
      borderRadius: "12px",
      border: "1px dashed rgba(255, 255, 255, 0.1)"
    }}>
      <div style={{
        border: "4px solid rgba(255,255,255,0.1)",
        width: "36px",
        height: "36px",
        borderRadius: "50%",
        borderLeftColor: "var(--color-primary)",
        animation: "erika-spin 1s linear infinite",
        margin: "0 auto 15px auto"
      }}></div>
      <span style={{ fontWeight: "bold", fontSize: "1.1rem" }}>Iniciando Erika AI...</span>
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes erika-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      `}} />
    </div>
  )
});

// 3. Función para pre-cargar el chunk JS de ReportsModule en hover
const prefetchReports = () => {
  import("../../components/ReportsModule").catch(() => {});
};

const INVENTORY_DIST_DATA = [
  { name: "Construcción", value: 45 },
  { name: "Pinturas", value: 25 },
  { name: "Herramientas", value: 20 },
  { name: "Eléctrico", value: 10 },
];

const COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444"];

export default function Dashboard() {
  const { currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<"dashboard" | "reportes" | "">("");
  const [showBanner, setShowBanner] = useState(false);

  const isAdmin = currentUser?.role === "admin";
  const p = currentUser?.permissions || {};
  const canSeeDashboard = isAdmin || p.dashboard;
  const canSeeReportes = isAdmin || p.reportes;

  const [salesToday, setSalesToday] = useState(0);
  const [discrepancies, setDiscrepancies] = useState<any[]>([]);
  const [lowStockAlerts, setLowStockAlerts] = useState<any[]>([]);
  const [topCustomers, setTopCustomers] = useState<any[]>([]);
  const [inventoryValue, setInventoryValue] = useState(0);
  const [avgMargin, setAvgMargin] = useState(0);
  
  const [incomeVsExpenses, setIncomeVsExpenses] = useState<any[]>([]);
  const [hasPlayedBell, setHasPlayedBell] = useState(false);
  const [overdueLayaways, setOverdueLayaways] = useState<any[]>([]);
  const [overdueCustomers, setOverdueCustomers] = useState<any[]>([]);

  const changeTab = (tab: "dashboard" | "reportes") => {
    // Sanitización estricta del valor
    if (tab !== "dashboard" && tab !== "reportes") return;
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", tab);
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  };

  useEffect(() => {
    if (!activeTab && currentUser) {
      let initialTab: "dashboard" | "reportes" | "" = "";
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const tabParam = params.get("tab");
        if (tabParam === "dashboard" || tabParam === "reportes") {
          initialTab = tabParam;
        } else if (tabParam !== null) {
          // Sanitización activa: si existe un parámetro tab pero es inválido, lo borramos de la URL
          const url = new URL(window.location.href);
          url.searchParams.delete("tab");
          window.history.replaceState(null, "", url.pathname + url.search);
        }
      }

      if (initialTab === "dashboard" && canSeeDashboard) {
        setActiveTab("dashboard");
      } else if (initialTab === "reportes" && canSeeReportes) {
        setActiveTab("reportes");
      } else {
        if (canSeeDashboard) {
          setActiveTab("dashboard");
        } else if (canSeeReportes) {
          setActiveTab("reportes");
        }
      }
    }
  }, [currentUser, canSeeDashboard, canSeeReportes, activeTab]);

  useEffect(() => {
    const dismissed = localStorage.getItem("erika_banner_dismissed") === "true";
    if (!dismissed) {
      setShowBanner(true);
    }
  }, []);

  const dismissBanner = () => {
    localStorage.setItem("erika_banner_dismissed", "true");
    setShowBanner(false);
  };

  useEffect(() => {
    const fetchData = async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayIso = today.toISOString();
      const todayStr = today.toISOString().split('T')[0];

      // 1. Check for Debts and Overdue Layaways
      const { data: debts } = await supabase.from("supplier_debts").select("*").eq("status", "pending").lte("due_date", todayStr);
      const { data: layaways } = await supabase.from("layaways").select("*").eq("status", "pending").lt("due_date", todayStr);
      
      if (layaways) setOverdueLayaways(layaways);

      if (((debts && debts.length > 0) || (layaways && layaways.length > 0)) && !hasPlayedBell) {
          // Play Bell
          try {
             const audio = new Audio("https://cdn.pixabay.com/download/audio/2021/08/04/audio_0625c1539c.mp3?filename=success-1-6297.mp3");
             audio.volume = 0.5;
             audio.play().catch(e => console.log("Audio autoplay blocked by browser."));
             setHasPlayedBell(true);
             let msg = "🔔 ¡ATENCIÓN!\n";
             if (debts && debts.length > 0) msg += `- Tienes ${debts.length} cuenta(s) por pagar vencida(s) o que vencen HOY.\n`;
             if (layaways && layaways.length > 0) msg += `- Tienes ${layaways.length} apartado(s) vencido(s).\n`;
             if (debts && debts.length > 0) msg += `- Tienes ${debts.length} cuenta(s) por pagar vencida(s) o que vencen HOY.`;
             alert(msg);
          } catch(e) {}
      }

      // Fetch Overdue Customers (Credit limit exceeded)
      const { data: custs } = await supabase.from("customers").select("*").gt("balance", 0).not("deleted", "eq", true);
      if (custs) {
         setOverdueCustomers(custs.filter((c: any) => c.credit_limit > 0 && c.balance >= c.credit_limit));
      }

      // 2. Ventas de Hoy
      const { data: txs } = await supabase
        .from("cash_transactions")
        .select("*")
        .eq("type", "sale")
        .gte("created_at", todayIso);
      if (txs) {
        setSalesToday(txs.reduce((sum, t) => sum + t.amount, 0));
      }

      // 3. Mermas / Descuadres de Caja
      const { data: sessions } = await supabase
        .from("cash_sessions")
        .select("*")
        .lt("discrepancy", 0)
        .order("closed_at", { ascending: false })
        .limit(5);
      if (sessions) {
        setDiscrepancies(sessions);
      }

      // 4. Clientes VIP
      const { data: customerData } = await supabase
        .from("customers")
        .select("*")
        .not("deleted", "eq", true)
        .order("balance", { ascending: false })
        .limit(5);
      if (customerData) setTopCustomers(customerData);

      // 5. Alertas Críticas e Inventario
      const { data: inv } = await supabase.from("inventory").select("*");
      if (inv) {
        setLowStockAlerts(inv.filter((i) => i.stock <= i.min_stock).slice(0, 5));
        setInventoryValue(inv.reduce((sum, i) => sum + i.price * i.stock, 0));
        const margin = inv.length > 0 
          ? inv.reduce((acc, i) => {
              if (!i.cost || i.cost <= 0) return acc;
              return acc + (i.price - i.cost) / i.cost;
            }, 0) / (inv.filter((i) => i.cost > 0).length || 1)
          : 0.35;
        setAvgMargin(margin);
      }

      // 6. Income vs Expenses Graph (Current Month)
      const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
      
      const { data: monthSales } = await supabase.from("cash_transactions").select("amount").eq("type", "sale").gte("created_at", firstDayOfMonth);
      const totalSalesMonth = monthSales ? monthSales.reduce((sum, s) => sum + s.amount, 0) : 0;

      const { data: monthPayments } = await supabase.from("supplier_payments").select("amount").gte("created_at", firstDayOfMonth);
      const totalPaymentsMonth = monthPayments ? monthPayments.reduce((sum, p) => sum + p.amount, 0) : 0;

      const { data: monthLosses } = await supabase.from("business_losses").select("amount").gte("created_at", firstDayOfMonth);
      const totalLossesMonth = monthLosses ? monthLosses.reduce((sum, l) => sum + l.amount, 0) : 0;

      setIncomeVsExpenses([
          { name: "Ingresos (Ventas)", Total: totalSalesMonth, fill: "#10b981" },
          { name: "Abonos a Proveedores", Total: totalPaymentsMonth, fill: "#3b82f6" },
          { name: "Gastos y Mermas", Total: totalLossesMonth, fill: "#ef4444" }
      ]);

    };
    fetchData();
  }, [hasPlayedBell]);

  const exportToExcel = async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data: txs } = await supabase
      .from("cash_transactions")
      .select("*")
      .eq("type", "sale")
      .gte("created_at", today.toISOString());
    if (!txs || txs.length === 0)
      return alert("No hay ventas hoy para exportar.");

    let csvContent = "data:text/csv;charset=utf-8,ID,Fecha,Monto,Descripcion\n";
    txs.forEach((t) => {
      csvContent += `${t.id},${new Date(t.created_at).toLocaleString()},${t.amount},"${t.description}"\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `Ventas_Erika_${today.toISOString().split("T")[0]}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <ProtectedRoute permission="dashboard,reportes">
      <div className="animate-fade-in" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "20px" }}>
        
        {/* Header Dinámico */}
        <div className="flex-between" style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.1)", paddingBottom: "15px", marginBottom: "5px" }}>
          <div>
            <h1 style={{ color: "var(--color-primary)", margin: 0, fontSize: "1.8rem" }}>
              {activeTab === "dashboard" ? "Centro de Inteligencia de Negocios" : "🧠 Inteligencia y Facturación"}
            </h1>
            <p style={{ color: "var(--color-secondary)", margin: "5px 0 0 0", fontSize: "0.95rem" }}>
              {activeTab === "dashboard" 
                ? "Métricas y KPIs en tiempo real" 
                : "Consejos ERIKA, Autofacturación y Marketing"}
            </p>
          </div>

          {activeTab === "dashboard" && (
            <button
              onClick={exportToExcel}
              className="btn-primary"
              style={{
                background: "#10b981",
                padding: "10px 20px",
                borderRadius: "5px",
                cursor: "pointer",
                border: "none",
                color: "white",
                fontWeight: "bold",
              }}
            >
              📊 Exportar Ventas a Excel
            </button>
          )}
        </div>

        {/* Tab Switcher Premium (solo si tiene ambos permisos) */}
        {canSeeDashboard && canSeeReportes && (
          <div style={{
            display: "flex",
            gap: "10px",
            background: "rgba(255, 255, 255, 0.03)",
            padding: "5px",
            borderRadius: "12px",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            width: "fit-content",
            alignSelf: "flex-start",
            marginBottom: "5px",
            boxShadow: "inset 0 2px 4px rgba(0,0,0,0.3)"
          }}>
            <button
              onClick={() => changeTab("dashboard")}
              style={{
                padding: "10px 24px",
                borderRadius: "8px",
                border: "none",
                background: activeTab === "dashboard" ? "var(--color-primary)" : "transparent",
                color: activeTab === "dashboard" ? "black" : "rgba(255,255,255,0.7)",
                fontWeight: "bold",
                cursor: "pointer",
                transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                boxShadow: activeTab === "dashboard" ? "0 4px 15px rgba(0, 242, 254, 0.25)" : "none"
              }}
            >
              📊 Métricas y KPIs
            </button>
            <button
              onClick={() => changeTab("reportes")}
              onMouseEnter={prefetchReports}
              style={{
                padding: "10px 24px",
                borderRadius: "8px",
                border: "none",
                background: activeTab === "reportes" ? "var(--color-primary)" : "transparent",
                color: activeTab === "reportes" ? "black" : "rgba(255,255,255,0.7)",
                fontWeight: "bold",
                cursor: "pointer",
                transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                boxShadow: activeTab === "reportes" ? "0 4px 15px rgba(0, 242, 254, 0.25)" : "none"
              }}
            >
              🧠 Inteligencia y Reportes
            </button>
          </div>
        )}

        {/* Contenido de la Pestaña Dashboard */}
        {activeTab === "dashboard" && (
          <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {/* Alerta Naranja Cuentas Por Cobrar */}
            {overdueCustomers.length > 0 && (
              <div style={{ background: "rgba(245, 158, 11, 0.15)", border: "2px solid #f59e0b", borderRadius: "8px", padding: "15px" }}>
                <h2 style={{ color: "#f59e0b", margin: "0 0 10px 0", display: "flex", alignItems: "center", gap: "10px", fontSize: "1.2rem" }}>
                  ⚠️ ALERTA DE CARTERA VENCIDA (CRÉDITO EXCEDIDO)
                </h2>
                <p style={{ margin: "0 0 10px 0", color: "#fcd34d" }}>
                  Tienes {overdueCustomers.length} cliente(s) que han superado o igualado su límite de crédito. <strong>Detén sus ventas a crédito.</strong>
                </p>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                   {overdueCustomers.map(item => (
                      <div key={item.id} style={{ background: "rgba(0,0,0,0.3)", padding: "8px 12px", borderRadius: "6px", border: "1px solid #f59e0b" }}>
                        <strong style={{ color: "white" }}>{item.name}</strong>
                        <br />
                        <span style={{ fontSize: "0.85rem", color: "#fcd34d" }}>Deuda: ${item.balance.toFixed(2)} / Límite: ${item.credit_limit.toFixed(2)}</span>
                      </div>
                   ))}
                </div>
              </div>
            )}

            {/* Alerta Roja de Stock */}
            {lowStockAlerts.length > 0 && (
              <div style={{ background: "rgba(239, 68, 68, 0.15)", border: "2px solid #ef4444", borderRadius: "8px", padding: "15px" }}>
                <h2 style={{ color: "#ef4444", margin: "0 0 10px 0", display: "flex", alignItems: "center", gap: "10px", fontSize: "1.2rem" }}>
                  🚨 ALERTA CRÍTICA DE INVENTARIO
                </h2>
                <p style={{ margin: "0 0 10px 0", color: "#fca5a5" }}>
                  Tienes {lowStockAlerts.length} producto(s) por debajo de su nivel mínimo de seguridad. ¡Reabastece pronto!
                </p>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                   {lowStockAlerts.map(item => (
                      <div key={item.id} style={{ background: "rgba(0,0,0,0.3)", padding: "8px 12px", borderRadius: "6px", border: "1px solid #ef4444" }}>
                        <strong style={{ color: "white" }}>{item.name}</strong>
                        <br />
                        <span style={{ fontSize: "0.85rem", color: "#fca5a5" }}>Stock: {item.stock} / Mín: {item.min_stock}</span>
                      </div>
                   ))}
                </div>
              </div>
            )}

            {/* Kpis Rápidos */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "20px",
              }}
            >
              <div
                className="glass-panel"
                style={{
                  textAlign: "center",
                  background:
                    "linear-gradient(135deg, rgba(16, 185, 129, 0.2), transparent)",
                }}
              >
                <h3 style={{ margin: 0, color: "var(--color-secondary)" }}>
                  Ventas (Hoy)
                </h3>
                <p style={{ fontSize: "2rem", fontWeight: "bold", margin: "10px 0" }}>
                  ${salesToday.toFixed(2)}
                </p>
              </div>
              <div className="glass-panel" style={{ textAlign: "center" }}>
                <h3 style={{ margin: 0, color: "var(--color-secondary)" }}>
                  Margen Global Prom.
                </h3>
                <p style={{ fontSize: "2rem", fontWeight: "bold", margin: "10px 0", color: "#10b981" }}>
                  {(avgMargin * 100).toFixed(1)}%
                </p>
              </div>
              <div
                className="glass-panel"
                style={{
                  textAlign: "center",
                  border: discrepancies.length > 0 ? "1px solid #ef4444" : "none",
                }}
              >
                <h3 style={{ margin: 0, color: "var(--color-secondary)" }}>
                  Faltantes de Caja
                </h3>
                <p
                  style={{
                    fontSize: "2rem",
                    fontWeight: "bold",
                    margin: "10px 0",
                    color: discrepancies.length > 0 ? "#ef4444" : "white",
                  }}
                >
                  $
                  {discrepancies
                    .reduce((sum, s) => sum + s.discrepancy, 0)
                    .toFixed(2)}
                </p>
              </div>
              <div className="glass-panel" style={{ textAlign: "center" }}>
                <h3 style={{ margin: 0, color: "var(--color-secondary)" }}>
                  Valor Inventario
                </h3>
                <p style={{ fontSize: "2rem", fontWeight: "bold", margin: "10px 0" }}>
                  ${inventoryValue.toFixed(2)}
                </p>
              </div>
            </div>

            <div
              style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "20px" }}
            >
              {/* Gráfica de Barras */}
              <div className="glass-panel">
                <h3 style={{ color: "var(--color-secondary)", marginBottom: "20px" }}>
                  📊 Flujo de Efectivo (Mes Actual)
                </h3>
                <div style={{ width: "100%", height: "300px" }}>
                  <ResponsiveContainer>
                    <BarChart data={incomeVsExpenses}>
                      <XAxis
                        dataKey="name"
                        stroke="#fff"
                        tick={{ fill: "#ccc", fontSize: 12 }}
                      />
                      <YAxis stroke="#fff" tick={{ fill: "#ccc" }} />
                      <Tooltip
                        cursor={{ fill: "rgba(255,255,255,0.1)" }}
                        contentStyle={{
                          background: "#111",
                          border: "1px solid var(--color-primary)",
                        }}
                        formatter={(value: any) => `$${Number(value).toFixed(2)}`}
                      />
                      <Bar
                        dataKey="Total"
                        radius={[4, 4, 0, 0]}
                      >
                          {
                            incomeVsExpenses.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.fill} />
                            ))
                          }
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div style={{ marginTop: "20px" }}>
                  <div
                    className="glass-panel"
                    style={{ border: "1px solid #eab308" }}
                  >
                    <h3 style={{ color: "#eab308", marginBottom: "15px" }}>
                      ⭐ Top Clientes (Frecuentes / Crédito)
                    </h3>
                    {topCustomers.length === 0 ? (
                      <p style={{ color: "rgba(255,255,255,0.5)" }}>
                        Aún no hay historial suficiente.
                      </p>
                    ) : (
                      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                        {topCustomers.map((c: any) => (
                          <li
                            key={c.id}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              padding: "10px 0",
                              borderBottom: "1px solid rgba(255,255,255,0.05)",
                            }}
                          >
                            <strong>{c.name}</strong>
                            <span style={{ color: "#eab308" }}>
                              Saldo Crédito: ${c.balance.toFixed(2)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>

              {/* Gráfica de Pastel y Alertas */}
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <div className="glass-panel" style={{ flex: 1 }}>
                  <h3
                    style={{ color: "var(--color-secondary)", marginBottom: "10px" }}
                  >
                    ⚠️ Alertas Críticas
                  </h3>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {overdueLayaways.map((layaway, idx) => (
                      <li
                        key={`layaway-${idx}`}
                        style={{
                          background: "rgba(239, 68, 68, 0.1)",
                          border: "1px solid #ef4444",
                          padding: "10px",
                          borderRadius: "8px",
                          marginBottom: "10px",
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span>📦 Apartado Vencido: {layaway.customer_name}</span>
                        <strong style={{ color: "#ef4444" }}>
                          Debe: ${layaway.balance.toFixed(2)}
                        </strong>
                      </li>
                    ))}
                    {lowStockAlerts.map((alert, idx) => (
                      <li
                        key={`stock-${idx}`}
                        style={{
                          background: "rgba(245, 158, 11, 0.1)",
                          border: "1px solid #f59e0b",
                          padding: "10px",
                          borderRadius: "8px",
                          marginBottom: "10px",
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span>📉 Bajo Stock: {alert.name}</span>
                        <strong style={{ color: "#f59e0b" }}>
                          {alert.stock} (Min: {alert.min_stock})
                        </strong>
                      </li>
                    ))}
                    {lowStockAlerts.length === 0 && overdueLayaways.length === 0 && (
                      <li style={{ padding: "10px", color: "rgba(255,255,255,0.5)" }}>
                        No hay alertas críticas.
                      </li>
                    )}
                  </ul>
                </div>

                <div
                  className="glass-panel"
                  style={{ flex: 1, border: "1px solid #ef4444" }}
                >
                  <h3 style={{ color: "#ef4444", marginBottom: "10px" }}>
                    🕵️‍♂️ Auditoría de Caja (Faltantes)
                  </h3>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {discrepancies.map((session, idx) => (
                      <li
                        key={idx}
                        style={{
                          padding: "10px",
                          borderBottom: "1px solid rgba(255,255,255,0.1)",
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span>
                          {new Date(session.closed_at).toLocaleDateString()} -{" "}
                          {session.opened_by}
                        </span>
                        <strong style={{ color: "#ef4444" }}>
                          ${session.discrepancy.toFixed(2)}
                        </strong>
                      </li>
                    ))}
                    {discrepancies.length === 0 && (
                      <li style={{ padding: "10px", color: "#10b981" }}>
                        ✅ Cajas perfectas. Sin faltantes.
                      </li>
                    )}
                  </ul>
                </div>

                <div className="glass-panel" style={{ height: "220px" }}>
                  <h3
                    style={{
                      color: "var(--color-secondary)",
                      marginBottom: "10px",
                      textAlign: "center",
                    }}
                  >
                    📦 Valor del Inventario
                  </h3>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={INVENTORY_DIST_DATA}
                        innerRadius={50}
                        outerRadius={70}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {INVENTORY_DIST_DATA.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={COLORS[index % COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: "#111",
                          border: "1px solid #3b82f6",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Contenido de la Pestaña Inteligencia y Reportes */}
        {activeTab === "reportes" && (
          <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {showBanner && (
              <div
                className="animate-fade-in"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(0, 242, 254, 0.1), rgba(0,0,0,0.8))",
                  border: "1px solid rgba(0,242,254,0.3)",
                  borderRadius: "40px",
                  padding: "40px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "30px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
                  <div
                    style={{
                      width: "120px",
                      height: "120px",
                      borderRadius: "30px",
                      background: "rgba(0, 242, 254, 0.2)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "2px solid var(--color-primary)",
                      flexShrink: 0,
                      boxShadow: "0 0 30px rgba(0, 242, 254, 0.3)",
                      animation: "pulse 2.5s infinite ease-in-out",
                    }}
                  >
                    <span style={{ fontSize: "70px" }}>🤖</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <h2
                      style={{
                        fontSize: "55px",
                        color: "#fff",
                        lineHeight: 1,
                        margin: 0,
                      }}
                    >
                      HOLA, SOY{" "}
                      <span
                        style={{
                          color: "var(--color-primary)",
                          textShadow: "0 0 15px var(--color-primary)",
                        }}
                      >
                        ERIKA
                      </span>
                    </h2>
                    <span
                      style={{
                        opacity: 0.5,
                        textTransform: "uppercase",
                        letterSpacing: "2px",
                        fontSize: "24px",
                        fontWeight: "bold",
                      }}
                    >
                      Tu Nueva IA Operativa
                    </span>
                  </div>
                </div>
                <p
                  style={{
                    fontSize: "30px",
                    color: "rgba(255,255,255,0.9)",
                    lineHeight: 1.4,
                    fontWeight: 600,
                  }}
                >
                  Analizo cada movimiento de tu negocio en tiempo real. Mi objetivo es
                  hacer que ganes más y gastes menos. Conmigo podrás:
                </p>
                <ul
                  style={{
                    fontSize: "24px",
                    color: "rgba(255,255,255,0.7)",
                    lineHeight: 1.5,
                    fontWeight: 600,
                    paddingLeft: "20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "15px",
                  }}
                >
                  <li>✨ Detectar fugas invisibles de dinero.</li>
                  <li>✨ Predecir tus ventas.</li>
                  <li>✨ Auditar el rendimiento de tus vendedores.</li>
                  <li>✨ Maximizar tu Ticket Promedio.</li>
                </ul>
                <button
                  onClick={dismissBanner}
                  className="btn-primary"
                  style={{
                    background: "rgba(0,242,254,0.1)",
                    border: "2px solid var(--color-primary)",
                    color: "#fff",
                    borderRadius: "20px",
                    padding: "25px 40px",
                    fontSize: "24px",
                    fontWeight: 900,
                    alignSelf: "stretch",
                    marginTop: "10px",
                    textTransform: "uppercase",
                    letterSpacing: "1px",
                    transition: "all 0.3s",
                    boxShadow: "0 0 20px rgba(0,242,254,0.15)",
                    cursor: "pointer",
                  }}
                >
                  ENTENDIDO, MOSTRAR MIS DATOS
                </button>
                <style
                  dangerouslySetInnerHTML={{
                    __html: `
                  @keyframes pulse {
                      0% { box-shadow: 0 0 0 0 rgba(0, 242, 254, 0.4); transform: scale(1); }
                      50% { box-shadow: 0 0 0 20px rgba(0, 242, 254, 0); transform: scale(1.05); }
                      100% { box-shadow: 0 0 0 0 rgba(0, 242, 254, 0); transform: scale(1); }
                  }
                `,
                  }}
                />
              </div>
            )}
            <ReportsErrorBoundary>
              <ReportsModule />
            </ReportsErrorBoundary>
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
