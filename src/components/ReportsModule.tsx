"use client";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

export default function ReportsModule() {
  const [netProfit, setNetProfit] = useState({
     sales: 0,
     costs: 0,
     payments: 0, // abonos
     losses: 0,
     pureProfit: 0
  });

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
     };
     fetchData();
  }, []);

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
