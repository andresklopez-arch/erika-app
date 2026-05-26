"use client";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "./AuthProvider";

interface CashSession {
  id: string;
  opened_at: string;
  closed_at: string | null;
  opened_by: string;
  initial_balance: number;
  expected_balance: number | null;
  counted_balance: number | null;
  discrepancy: number | null;
  status: 'open' | 'closed';
  cash_sales?: number;
  card_sales?: number;
  transfer_sales?: number;
  total_sales?: number;
}

export default function ReportsModule() {
  const { businessSettings } = useAuth();
  const monthlyGoal = businessSettings.monthly_goals;

  const [netProfit, setNetProfit] = useState({
     sales: 0,
     costs: 0,
     payments: 0, // abonos
     losses: 0,
     pureProfit: 0
  });
  const [cashSessions, setCashSessions] = useState<CashSession[]>([]);
  const [searchCajero, setSearchCajero] = useState("");
  const [filterFecha, setFilterFecha] = useState("todos");
  const [exporting, setExporting] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [lostSales, setLostSales] = useState<{term: string, count: number, type: string}[]>([]);
  const [radarFilterFecha, setRadarFilterFecha] = useState("mes");

  useEffect(() => {
     const fetchData = async () => {
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();

        // Ventas brutas y Costos (calculados del historial)
        const { data: txs } = await supabase.from("cash_transactions").select("amount, description").eq("type", "sale").gte("created_at", firstDayOfMonth);
        let sales = 0;
        let costs = 0;
        if (txs) {
           txs.forEach(t => {
              sales += t.amount;
              const costMatch = t.description?.match(/\[COSTO:\s*([\d.]+)\]/);
              if (costMatch && costMatch[1]) {
                 costs += parseFloat(costMatch[1]);
              } else {
                 costs += t.amount * 0.70; // fallback para ventas antiguas sin costo registrado
              }
           });
        }

        // Gastos y Mermas
        const { data: losses } = await supabase.from("business_losses").select("amount").gte("created_at", firstDayOfMonth);
        const totalLosses = losses ? losses.reduce((s, l) => s + l.amount, 0) : 0;

        // Abonos a Proveedores
        const { data: payments } = await supabase.from("supplier_payments").select("amount").gte("created_at", firstDayOfMonth);
        const totalPayments = payments ? payments.reduce((s, p) => s + p.amount, 0) : 0;

        setNetProfit({
           sales,
           costs,
           payments: totalPayments,
           losses: totalLosses,
           pureProfit: sales - costs - totalLosses
        });

        const { data: sessions } = await supabase.from("cash_sessions").select("*").order("closed_at", { ascending: false }).limit(50);
        if (sessions && sessions.length > 0) {
           const sessionIds = sessions.map(s => s.id);
           const { data: txs } = await supabase
              .from("cash_transactions")
              .select("session_id, type, amount, description, payment_method, cash_amount, card_amount, transfer_amount")
              .in("session_id", sessionIds);
           
           const sessionsWithSales = sessions.map(session => {
              const sessionTxs = txs ? txs.filter(t => t.session_id === session.id) : [];
              
              let cashSales = 0;
              let cardSales = 0;
              let transferSales = 0;
              let totalSales = 0;

              sessionTxs.filter(t => t.type === 'sale').forEach(t => {
                 totalSales += t.amount;
                 
                 // Cash
                 let c = 0;
                 if (t.cash_amount !== undefined && t.cash_amount !== null) {
                    c = Number(t.cash_amount);
                 } else if (t.description) {
                    const match = t.description.match(/\[CASH:([\d.]+)\]/);
                    if (match) c = parseFloat(match[1]);
                    else if (!t.description.includes("[METODO:tarjeta]") && !t.description.includes("[METODO:transferencia]")) c = t.amount;
                 } else {
                    c = t.amount;
                 }
                 cashSales += c;

                 // Card
                 let crd = 0;
                 if (t.card_amount !== undefined && t.card_amount !== null) {
                    crd = Number(t.card_amount);
                 } else if (t.description) {
                    const match = t.description.match(/\[CARD:([\d.]+)\]/);
                    if (match) crd = parseFloat(match[1]);
                    else if (t.description.includes("[METODO:tarjeta]")) crd = t.amount;
                 }
                 cardSales += crd;

                 // Transfer
                 let trsf = 0;
                 if (t.transfer_amount !== undefined && t.transfer_amount !== null) {
                    trsf = Number(t.transfer_amount);
                 } else if (t.description) {
                    const match = t.description.match(/\[TRANS:([\d.]+)\]/);
                    if (match) trsf = parseFloat(match[1]);
                    else if (t.description.includes("[METODO:transferencia]")) trsf = t.amount;
                 }
                 transferSales += trsf;
              });

              return {
                 ...session,
                 cash_sales: cashSales,
                 card_sales: cardSales,
                 transfer_sales: transferSales,
                 total_sales: totalSales
              };
           });
           setCashSessions(sessionsWithSales as CashSession[]);
        }
     };
     fetchData();
  }, []);

  useEffect(() => {
    const fetchRadar = async () => {
      let query = supabase.from("lost_sales_requests").select("*");
      
      const now = new Date();
      if (radarFilterFecha !== "todos") {
        if (radarFilterFecha === "hoy") {
          const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
          query = query.gte("created_at", startOfToday);
        } else if (radarFilterFecha === "semana") {
          const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
          query = query.gte("created_at", sevenDaysAgo);
        } else if (radarFilterFecha === "mes") {
          const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
          query = query.gte("created_at", startOfThisMonth);
        }
      }

      const { data: lostData } = await query;
      if (lostData) {
         const grouped = lostData.reduce((acc: any, curr: any) => {
            const term = curr.term.trim().toUpperCase();
            if (!acc[term]) acc[term] = { term, count: 0, type: curr.type };
            acc[term].count += 1;
            return acc;
         }, {});
         const sorted = Object.values(grouped).sort((a: any, b: any) => b.count - a.count).slice(0, 10);
         setLostSales(sorted as any);
      } else {
         setLostSales([]);
      }
    };
    fetchRadar();
  }, [radarFilterFecha]);

  const printCorteCaja = (session: CashSession) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const html = `
      <html>
        <head>
          <title>Corte de Caja - Ferretería Erika</title>
          <style>
            @media print {
              @page { margin: 0; }
              body { margin: 0; }
            }
            body { font-family: 'Courier New', Courier, monospace; font-size: 12px; width: 300px; padding: 10px; color: #000; }
            h2 { text-align: center; margin: 5px 0; font-size: 16px; }
            p { margin: 3px 0; }
            .divider { border-top: 1px dashed #000; margin: 10px 0; }
            .row { display: flex; justify-content: space-between; margin-bottom: 5px; }
            .bold { font-weight: bold; }
          </style>
        </head>
        <body>
          <h2>FERRETERÍA ERIKA</h2>
          <p style="text-align: center;">--- CORTE DE CAJA ---</p>
          <div class="divider"></div>
          <p><strong>Apertura:</strong> ${new Date(session.opened_at).toLocaleString()}</p>
          <p><strong>Cierre:</strong> ${session.closed_at ? new Date(session.closed_at).toLocaleString() : 'En curso'}</p>
          <div class="divider"></div>
          <div class="row"><span>Fondo Inicial:</span><span>$${(session.initial_balance ?? 0).toFixed(2)}</span></div>
          <div class="row"><span>Ventas Efectivo:</span><span>$${(session.cash_sales ?? 0).toFixed(2)}</span></div>
          <div class="row"><span>Ventas Tarjeta:</span><span>$${(session.card_sales ?? 0).toFixed(2)}</span></div>
          <div class="row"><span>Ventas Transf.:</span><span>$${(session.transfer_sales ?? 0).toFixed(2)}</span></div>
          <div class="row bold"><span>Total Ventas:</span><span>$${(session.total_sales ?? 0).toFixed(2)}</span></div>
          <div class="divider"></div>
          <div class="row"><span>Efectivo Declarado:</span><span>$${(session.counted_balance ?? 0).toFixed(2)}</span></div>
          <div class="row bold"><span>Efectivo Esperado:</span><span>$${(session.expected_balance ?? 0).toFixed(2)}</span></div>
          <div class="divider"></div>
          <div class="row bold">
             <span>Descuadre:</span>
             <span style="color: ${(session.discrepancy ?? 0) < 0 ? 'red' : 'inherit'}">$${(session.discrepancy ?? 0).toFixed(2)}</span>
          </div>
          <div class="divider"></div>
          <p style="text-align: center; font-size: 10px; margin-top: 20px;">Firma del Cajero</p>
          <div style="border-bottom: 1px solid #000; margin: 20px 20px 0 20px;"></div>
        </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 500);
  };

  const filteredSessions = cashSessions.filter(session => {
     if (searchCajero && !session.opened_by.toLowerCase().includes(searchCajero.toLowerCase())) {
        return false;
     }
     if (filterFecha !== "todos") {
        const openedDate = new Date(session.opened_at);
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (filterFecha === "hoy") {
           if (openedDate < startOfToday) return false;
        } else if (filterFecha === "semana") {
           const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
           if (openedDate < sevenDaysAgo) return false;
        } else if (filterFecha === "mes") {
           const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
           if (openedDate < startOfThisMonth) return false;
        }
     }
     return true;
  });

  const exportToCSV = () => {
    if (exporting) return;
    setExporting(true);

    try {
      const headers = ["Apertura", "Cierre", "Cajero", "Fondo Inicial", "Ventas Efectivo", "Ventas Tarjeta", "Ventas Transferencia", "Ventas Totales", "Descuadre", "Estado"];
      const rows = filteredSessions.map(session => [
        session.opened_at ? new Date(session.opened_at).toLocaleString() : "",
        session.closed_at ? new Date(session.closed_at).toLocaleString() : "En curso",
        session.opened_by || "",
        (session.initial_balance ?? 0).toFixed(2),
        (session.cash_sales ?? 0).toFixed(2),
        (session.card_sales ?? 0).toFixed(2),
        (session.transfer_sales ?? 0).toFixed(2),
        (session.total_sales ?? 0).toFixed(2),
        (session.discrepancy ?? 0).toFixed(2),
        session.status === 'open' ? 'Abierta' : 'Cerrada'
      ]);

      const csvContent = "data:text/csv;charset=utf-8,\uFEFF" 
        + [headers.join(","), ...rows.map(e => e.map(val => `"${val.replace(/"/g, '""')}"`).join(","))].join("\n");
      
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `reporte_arqueos_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
    } catch (err) {
      console.error("Error al exportar a CSV:", err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="animate-fade-in"
      style={{ display: "flex", flexDirection: "column", gap: "20px" }}
    >
      {/* Meta de Ventas Mensual */}
      {monthlyGoal > 0 && (
         <div
           className="glass-panel"
           style={{
             background: "linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(59, 130, 246, 0.15))",
             border: "1px solid rgba(16, 185, 129, 0.3)",
             display: "flex",
             flexDirection: "column",
             gap: "15px"
           }}
         >
           <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
             <div>
               <h3 style={{ color: "#10b981", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                 🎯 Meta de Ventas Mensual ERIKA
               </h3>
               <p style={{ margin: "5px 0 0 0", fontSize: "0.85rem", opacity: 0.8 }}>
                 Objetivo acumulado para el mes actual
               </p>
             </div>
             <div style={{ textAlign: "right" }}>
               <span style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#10b981" }}>
                 ${netProfit.sales.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
               </span>
               <span style={{ opacity: 0.6, fontSize: "0.9rem" }}> / ${monthlyGoal.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</span>
             </div>
           </div>
           
           <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: "10px", height: "24px", width: "100%", overflow: "hidden", position: "relative", border: "1px solid rgba(255,255,255,0.1)" }}>
             <div
               style={{
                 width: `${Math.min((netProfit.sales / monthlyGoal) * 100, 100)}%`,
                 background: "linear-gradient(90deg, #10b981, #3b82f6)",
                 height: "100%",
                 borderRadius: "10px",
                 transition: "width 1s cubic-bezier(0.4, 0, 0.2, 1)",
                 display: "flex",
                 alignItems: "center",
                 justifyContent: "flex-end",
                 paddingRight: (netProfit.sales / monthlyGoal) * 100 > 10 ? "10px" : "0"
               }}
             >
               {(netProfit.sales / monthlyGoal) * 100 > 5 && (
                 <span style={{ color: "white", fontSize: "0.75rem", fontWeight: "bold" }}>
                   {((netProfit.sales / monthlyGoal) * 100).toFixed(1)}%
                 </span>
               )}
             </div>
           </div>
           <p style={{ margin: 0, fontSize: "0.85rem", fontStyle: "italic", opacity: 0.8 }}>
             {netProfit.sales >= monthlyGoal 
               ? "🎉 ¡Felicidades! Se ha superado la meta mensual de ventas del negocio." 
               : `Faltan $${(monthlyGoal - netProfit.sales).toLocaleString("es-MX", { minimumFractionDigits: 2 })} para lograr la meta. ¡Vamos con todo!`}
           </p>
         </div>
      )}

      {/* Resumen de Inteligencia */}
      <div className="grid-cols-2">
        <div
          className="glass-panel"
          style={{
            background:
              "linear-gradient(135deg, rgba(244, 63, 94, 0.1), transparent)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px", flexWrap: "wrap", gap: "10px" }}>
            <h2 style={{ color: "var(--color-primary)", margin: 0 }}>
              🧠 Radar de Demanda (Ventas Perdidas)
            </h2>
            <select
              value={radarFilterFecha}
              onChange={(e) => setRadarFilterFecha(e.target.value)}
              style={{
                padding: "5px 10px",
                borderRadius: "8px",
                background: "rgba(0,0,0,0.3)",
                color: "white",
                border: "1px solid var(--color-primary)",
                outline: "none",
                cursor: "pointer",
                fontSize: "0.85rem"
              }}
            >
              <option value="hoy" style={{ background: "#1f2937" }}>Hoy</option>
              <option value="semana" style={{ background: "#1f2937" }}>Últimos 7 días</option>
              <option value="mes" style={{ background: "#1f2937" }}>Este mes</option>
              <option value="todos" style={{ background: "#1f2937" }}>Todos los registros</option>
            </select>
          </div>
          <p style={{ marginBottom: "15px" }}>
            Artículos solicitados por clientes que no teníamos en inventario o estaban agotados:
          </p>
          <ul style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {lostSales.length > 0 ? lostSales.map((item, idx) => (
              <li
                key={idx}
                style={{
                  background: "rgba(0,0,0,0.3)",
                  padding: "10px 15px",
                  borderRadius: "8px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderLeft: item.type === "AGOTADO" ? "4px solid #ef4444" : "4px solid #3b82f6"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: "bold" }}>{item.term}</span>
                  <span style={{ fontSize: "0.8rem", color: "var(--color-secondary)", padding: "2px 6px", background: "rgba(255,255,255,0.1)", borderRadius: "4px" }}>
                    {item.type === "AGOTADO" ? "Agotado" : "No en catálogo"}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
                  <div style={{ color: "#f59e0b", fontWeight: "bold", display: "flex", alignItems: "center", gap: "5px" }}>
                    <span>🔥</span> {item.count} peticiones
                  </div>
                  <button 
                    onClick={() => {
                      window.location.href = `/inventario?create=${encodeURIComponent(item.term)}`;
                    }}
                    style={{
                      background: "var(--color-primary)",
                      color: "black",
                      border: "none",
                      padding: "5px 10px",
                      borderRadius: "5px",
                      cursor: "pointer",
                      fontWeight: "bold",
                      fontSize: "0.8rem"
                    }}
                  >
                    ➕ Crear
                  </button>
                </div>
              </li>
            )) : (
              <li style={{ background: "rgba(0,0,0,0.3)", padding: "10px", borderRadius: "8px", textAlign: "center", color: "rgba(255,255,255,0.5)" }}>
                No hay ventas perdidas registradas este mes. ¡Buen trabajo!
              </li>
            )}
            <li
              style={{
                marginTop: "10px",
                fontSize: "0.85rem",
                color: "var(--color-secondary)",
                fontStyle: "italic",
                textAlign: "center"
              }}
            >
              * Los artículos con mayor número de peticiones son los más urgentes para resurtir o agregar al catálogo.
            </li>
          </ul>
        </div>

        <div
          className="glass-panel"
          style={{ display: "flex", flexDirection: "column", gap: "15px" }}
        >
          <h3
            style={{
              borderBottom: "1px solid var(--glass-border)",
              paddingBottom: "10px",
              color: "#10b981"
            }}
          >
            💰 Estado de Resultados: UTILIDAD NETA PURA (Mes Actual)
          </h3>
          <div style={{ background: "rgba(0,0,0,0.3)", padding: "15px", borderRadius: "8px" }}>
             <div className="flex-between" style={{ padding: "5px 0" }}>
                 <span>Ingresos por Ventas Brutas:</span>
                 <span style={{ color: "#10b981", fontWeight: "bold" }}>+ ${netProfit.sales.toFixed(2)}</span>
             </div>
             <div className="flex-between" style={{ padding: "5px 0" }}>
                 <span>(-) Costo de lo Vendido (Mercancía):</span>
                 <span style={{ color: "#f59e0b" }}>- ${netProfit.costs.toFixed(2)}</span>
             </div>
             <div className="flex-between" style={{ padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                 <span>(-) Mermas y Gastos Operativos:</span>
                 <span style={{ color: "#ef4444" }}>- ${netProfit.losses.toFixed(2)}</span>
             </div>
             <div className="flex-between" style={{ padding: "15px 0 5px 0", fontSize: "1.2rem", fontWeight: "bold" }}>
                 <span>= UTILIDAD NETA (Ganancia Libre):</span>
                 <span style={{ color: netProfit.pureProfit >= 0 ? "#10b981" : "#ef4444" }}>${netProfit.pureProfit.toFixed(2)}</span>
             </div>
             <p style={{ fontSize: "0.8rem", color: "var(--color-secondary)", marginTop: "10px", fontStyle: "italic" }}>
                 * Este es el dinero 100% libre que ganó el negocio después de pagar el costo de los productos y los gastos internos. Los abonos a proveedores por deudas atrasadas fueron de ${netProfit.payments.toFixed(2)}.
             </p>
          </div>
        </div>
      </div>

      <div className="glass-panel">
         <h2 style={{ color: "var(--color-primary)", marginBottom: "15px" }}>🖨️ Historial de Arqueos (Cortes de Caja)</h2>
         
         {/* Filtros y Buscador Premium */}
         <div style={{ display: "flex", gap: "15px", marginBottom: "20px", flexWrap: "wrap" }}>
           <div style={{ display: "flex", flexDirection: "column", gap: "5px", flex: 1, minWidth: "200px" }}>
             <label style={{ fontSize: "0.85rem", color: "var(--color-secondary)" }}>👤 Buscar por Cajero</label>
             <input
               type="text"
               placeholder="Escribe nombre del cajero..."
               value={searchCajero}
               onChange={(e) => setSearchCajero(e.target.value)}
               style={{
                 padding: "10px",
                 borderRadius: "8px",
                 background: "rgba(0,0,0,0.3)",
                 color: "white",
                 border: "1px solid var(--glass-border)",
                 outline: "none"
               }}
             />
           </div>
           <div style={{ display: "flex", flexDirection: "column", gap: "5px", width: "200px" }}>
              <label style={{ fontSize: "0.85rem", color: "var(--color-secondary)" }}>📅 Filtrar por Fecha</label>
              <select
                value={filterFecha}
                onChange={(e) => setFilterFecha(e.target.value)}
                style={{
                  padding: "10px",
                  borderRadius: "8px",
                  background: "rgba(0,0,0,0.3)",
                  color: "white",
                  border: "1px solid var(--glass-border)",
                  outline: "none",
                  cursor: "pointer"
                }}
              >
                <option value="todos" style={{ background: "#1f2937", color: "white" }}>Todos los registros</option>
                <option value="hoy" style={{ background: "#1f2937", color: "white" }}>Hoy</option>
                <option value="semana" style={{ background: "#1f2937", color: "white" }}>Últimos 7 días</option>
                <option value="mes" style={{ background: "#1f2937", color: "white" }}>Este mes</option>
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "5px", justifyContent: "flex-end" }}>
              <button
                onClick={exportToCSV}
                disabled={exporting}
                style={{
                  padding: "10px 20px",
                  borderRadius: "8px",
                  background: exporting ? "rgba(16, 185, 129, 0.1)" : "rgba(16, 185, 129, 0.2)",
                  border: "1px solid #10b981",
                  color: "#10b981",
                  cursor: exporting ? "not-allowed" : "pointer",
                  fontWeight: "bold",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  height: "42px",
                  opacity: exporting ? 0.6 : 1,
                  transition: "all 0.2s ease"
                }}
              >
                {exporting ? "⏳ Procesando..." : "📥 Exportar a CSV"}
              </button>
            </div>
         </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--glass-border)" }}>
                  <th style={{ padding: "10px" }}>Apertura</th>
                  <th style={{ padding: "10px" }}>Cierre</th>
                  <th style={{ padding: "10px" }}>Efec. Ventas</th>
                  <th style={{ padding: "10px" }}>Tarj. Ventas</th>
                  <th style={{ padding: "10px" }}>Transf. Ventas</th>
                  <th style={{ padding: "10px" }}>Tot. Ventas</th>
                  <th style={{ padding: "10px" }}>Descuadre</th>
                  <th style={{ padding: "10px" }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.map(session => (
                  <tr key={session.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <td style={{ padding: "10px" }}>{session.opened_at ? new Date(session.opened_at).toLocaleString() : "Sin fecha"}</td>
                    <td style={{ padding: "10px" }}>{session.closed_at ? new Date(session.closed_at).toLocaleString() : "En curso"}</td>
                    <td style={{ padding: "10px" }}>${(session.cash_sales ?? 0).toFixed(2)}</td>
                    <td style={{ padding: "10px" }}>${(session.card_sales ?? 0).toFixed(2)}</td>
                    <td style={{ padding: "10px" }}>${(session.transfer_sales ?? 0).toFixed(2)}</td>
                    <td style={{ padding: "10px", fontWeight: "bold" }}>${(session.total_sales ?? 0).toFixed(2)}</td>
                    <td style={{ padding: "10px", color: (session.discrepancy ?? 0) < 0 ? "#ef4444" : "#10b981" }}>${(session.discrepancy ?? 0).toFixed(2)}</td>
                    <td style={{ padding: "10px" }}>
                      <button onClick={() => printCorteCaja(session)} style={{ background: "transparent", color: "#3b82f6", border: "1px solid #3b82f6", padding: "5px 10px", borderRadius: "5px", cursor: "pointer" }}>🖨️ Imprimir Ticket</button>
                    </td>
                  </tr>
                ))}
                {filteredSessions.length === 0 && <tr><td colSpan={8} style={{ padding: "20px", textAlign: "center" }}>No se encontraron cortes de caja.</td></tr>}
              </tbody>
            </table>
          </div>
      </div>

      <div className="glass-panel">
        <h3 style={{ marginBottom: "15px" }}>
          🎟️ Emisión de Cupones y Promociones (Fidelización)
        </h3>
        <div style={{ display: "flex", gap: "15px", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Código (ej. VERANO26)"
            style={{
              flex: 1,
              minWidth: "150px",
              padding: "10px",
              borderRadius: "8px",
              background: "rgba(0,0,0,0.3)",
              color: "white",
              border: "1px solid var(--glass-border)",
            }}
          />
          <input
            type="number"
            placeholder="% Descuento"
            style={{
              width: "120px",
              padding: "10px",
              borderRadius: "8px",
              background: "rgba(0,0,0,0.3)",
              color: "white",
              border: "1px solid var(--glass-border)",
            }}
          />
          <button className="btn-primary">
            Generar y Enviar a Clientes Top por WhatsApp
          </button>
        </div>
      </div>
      {showToast && (
        <div 
          className="toast-animate"
          style={{
            position: "fixed",
            bottom: "20px",
            right: "20px",
            background: "rgba(16, 185, 129, 0.95)",
            color: "white",
            padding: "12px 24px",
            borderRadius: "10px",
            boxShadow: "0 10px 25px rgba(0, 0, 0, 0.3)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            gap: "10px",
            backdropFilter: "blur(10px)",
            border: "1px solid rgba(255, 255, 255, 0.1)"
          }}
        >
          <span>✅</span>
          <span style={{ fontWeight: "500" }}>Reporte exportado exitosamente</span>
        </div>
      )}
    </div>
  );
}
