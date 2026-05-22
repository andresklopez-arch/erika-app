"use client";
import { useState, useEffect } from "react";
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
} from "recharts";
import { supabase } from "../../lib/supabaseClient";

const TOP_SALES_DATA = [
  { name: "Cemento Tolteca 50kg", ventas: 12500 },
  { name: "Pintura Blanca 19L", ventas: 8900 },
  { name: "Cable Calibre 12", ventas: 4500 },
  { name: "Martillo Truper", ventas: 3200 },
  { name: "Brocha 4 pulg", ventas: 1500 },
];

const INVENTORY_DIST_DATA = [
  { name: "Construcción", value: 45 },
  { name: "Pinturas", value: 25 },
  { name: "Herramientas", value: 20 },
  { name: "Eléctrico", value: 10 },
];

const LOW_STOCK_ALERTS = [
  { name: "Pintura Blanca 19L Comex", stock: 4, min: 5 },
  { name: "Brocha 4 pulgadas", stock: 4, min: 10 },
];
const COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444"];

export default function Dashboard() {
  const [salesToday, setSalesToday] = useState(0);
  const [discrepancies, setDiscrepancies] = useState<any[]>([]);
  const [lowStockAlerts, setLowStockAlerts] = useState<any[]>([]);
  const [topCustomers, setTopCustomers] = useState<any[]>([]);
  const [inventoryValue, setInventoryValue] = useState(0);
  const [avgMargin, setAvgMargin] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      // Ventas de Hoy
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { data: txs } = await supabase
        .from("cash_transactions")
        .select("*")
        .eq("type", "sale")
        .gte("created_at", today.toISOString());
      if (txs) {
        setSalesToday(txs.reduce((sum, t) => sum + t.amount, 0));
      }

      // Mermas / Descuadres de Caja
      const { data: sessions } = await supabase
        .from("cash_sessions")
        .select("*")
        .lt("discrepancy", 0)
        .order("closed_at", { ascending: false })
        .limit(5);
      if (sessions) {
        setDiscrepancies(sessions);
      }

      // 4. Clientes VIP (Con más saldo/movimiento, usando balance actual como métrica rápida)
      const { data: customerData } = await supabase
        .from("customers")
        .select("*")
        .order("balance", { ascending: false })
        .limit(5);
      if (customerData) {
        setTopCustomers(customerData);
      }

      // Alertas Críticas e Inventario
      const { data: inv } = await supabase.from("inventory").select("*");
      if (inv) {
        setLowStockAlerts(
          inv.filter((i) => i.stock <= i.min_stock).slice(0, 5),
        );
        setInventoryValue(inv.reduce((sum, i) => sum + i.price * i.stock, 0));
        
        const margin = inv.length > 0 
          ? inv.reduce((acc, i) => {
              if (!i.cost || i.cost <= 0) return acc;
              return acc + (i.price - i.cost) / i.cost;
            }, 0) / (inv.filter((i) => i.cost > 0).length || 1)
          : 0.35;
        setAvgMargin(margin);
      }
    };
    fetchData();
  }, []);

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
    <div className="animate-fade-in" style={{ padding: "20px" }}>
      <div className="flex-between" style={{ marginBottom: "20px" }}>
        <h1 style={{ color: "var(--color-primary)" }}>
          Centro de Inteligencia de Negocios
        </h1>
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
          }}
        >
          📊 Exportar Ventas a Excel
        </button>
      </div>

      {/* Kpis Rápidos */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "20px",
          marginBottom: "30px",
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
            🏆 Top 5 Productos con Más Ventas ($)
          </h3>
          <div style={{ width: "100%", height: "300px" }}>
            <ResponsiveContainer>
              <BarChart data={TOP_SALES_DATA}>
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
                    border: "1px solid #10b981",
                  }}
                />
                <Bar
                  dataKey="ventas"
                  fill="var(--color-primary)"
                  radius={[4, 4, 0, 0]}
                />
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
              ⚠️ Alertas Críticas (Bajo Stock)
            </h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {lowStockAlerts.map((alert, idx) => (
                <li
                  key={idx}
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
                  <span>{alert.name}</span>
                  <strong style={{ color: "#ef4444" }}>
                    {alert.stock} (Min: {alert.minStock})
                  </strong>
                </li>
              ))}
              {lowStockAlerts.length === 0 && (
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
  );
}
