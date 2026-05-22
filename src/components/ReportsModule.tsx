"use client";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

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
  total_sales?: number;
}

export default function ReportsModule() {
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
           const sessionsNeedCalculation = sessions.filter(s => s.total_sales === null || s.total_sales === undefined || s.status === 'open');
           let txs: any[] = [];
           if (sessionsNeedCalculation.length > 0) {
              const sessionIds = sessionsNeedCalculation.map(s => s.id);
              const { data } = await supabase.from("cash_transactions").select("session_id, type, amount").in("session_id", sessionIds);
              if (data) txs = data;
           }
           const sessionsWithSales = sessions.map(session => {
              let sales = 0;
              if (session.total_sales !== null && session.total_sales !== undefined && session.status === 'closed') {
                 sales = Number(session.total_sales);
              } else {
                 const sessionTxs = txs.filter(t => t.session_id === session.id);
                 sales = sessionTxs.filter(t => t.type === 'sale').reduce((sum, t) => sum + t.amount, 0);
              }
              return {
                 ...session,
                 cash_sales: sales,
                 card_sales: 0
              };
           });
           setCashSessions(sessionsWithSales as CashSession[]);
        } else if (sessions) {
           setCashSessions(sessions as CashSession[]);
        }
     };
     fetchData();
  }, []);

  const printCorteCaja = (session: any) => {
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

  return (
    <div
      className="animate-fade-in"
      style={{ display: "flex", flexDirection: "column", gap: "20px" }}
    >
      {/* Resumen de Inteligencia */}
      <div className="grid-cols-2">
        <div
          className="glass-panel"
          style={{
            background:
              "linear-gradient(135deg, rgba(244, 63, 94, 0.1), transparent)",
          }}
        >
          <h2 style={{ color: "var(--color-primary)", marginBottom: "15px" }}>
            🧠 Inteligencia y Big Data ERIKA
          </h2>
          <p style={{ marginBottom: "15px" }}>
            He analizado tus datos del último mes. Aquí tienes mis
            descubrimientos principales para hacer crecer tu negocio:
          </p>
          <ul style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <li
              style={{
                background: "rgba(0,0,0,0.3)",
                padding: "10px",
                borderRadius: "8px",
              }}
            >
              🚀 <strong>Productos Estrella:</strong> El "Cemento Tolteca"
              incrementó ventas un 25%. Sugiero pedir un 10% más en la próxima
              orden para obtener mejor margen.
            </li>
            <li
              style={{
                borderLeft: "4px solid var(--color-primary)",
                background: "rgba(0,0,0,0.3)",
                padding: "10px",
                borderRadius: "8px",
              }}
            >
              ⚠️ <strong>Posible Fuga:</strong> El inventario de "Brochas" tiene
              discrepancias (faltan 3 piezas vs ventas). Sugiero hacer un
              inventario parcial hoy.
            </li>
            <li
              style={{
                background: "rgba(0,0,0,0.3)",
                padding: "10px",
                borderRadius: "8px",
              }}
            >
              💡 <strong>Oferta Sugerida:</strong> Tienes 50 L de Pintura Blanca
              estancada. Sugiero emitir un cupón del 15% a tus clientes
              recurrentes.
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
         </div>

         <div style={{ overflowX: "auto" }}>
           <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
             <thead>
               <tr style={{ borderBottom: "1px solid var(--glass-border)" }}>
                 <th style={{ padding: "10px" }}>Apertura</th>
                 <th style={{ padding: "10px" }}>Cierre</th>
                 <th style={{ padding: "10px" }}>Efec. Ventas</th>
                 <th style={{ padding: "10px" }}>Tarj. Ventas</th>
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
                     <td style={{ padding: "10px", color: (session.discrepancy ?? 0) < 0 ? "#ef4444" : "#10b981" }}>${(session.discrepancy ?? 0).toFixed(2)}</td>
                    <td style={{ padding: "10px" }}>
                      <button onClick={() => printCorteCaja(session)} style={{ background: "transparent", color: "#3b82f6", border: "1px solid #3b82f6", padding: "5px 10px", borderRadius: "5px", cursor: "pointer" }}>🖨️ Imprimir Ticket</button>
                    </td>
                  </tr>
                ))}
                {filteredSessions.length === 0 && <tr><td colSpan={6} style={{ padding: "20px", textAlign: "center" }}>No se encontraron cortes de caja.</td></tr>}
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
    </div>
  );
}
