"use client";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { LayawaySchema } from "../lib/schemas";

export default function LayawaysModule() {
  const [layaways, setLayaways] = useState<any[]>([]);
  const [limit, setLimit] = useState(20);
  const [hasMore, setHasMore] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchLayaways = async (currentLimit = limit, searchVal = searchQuery) => {
    let query = supabase
      .from("layaways")
      .select("*");

    const cleanSearch = (searchVal || "").trim();
    if (cleanSearch !== "") {
      query = query.ilike("customer_name", `%${cleanSearch}%`);
    }

    const { data } = await query
      .order("created_at", { ascending: false })
      .limit(currentLimit + 1);
    
    if (data) {
      const hasMoreRows = data.length > currentLimit;
      const sliceData = hasMoreRows ? data.slice(0, currentLimit) : data;
      setHasMore(hasMoreRows);

      const validated = sliceData.map((item: any) => {
        const result = LayawaySchema.safeParse(item);
        if (!result.success) {
          console.error("Error de validacion Zod en apartado (layaway):", result.error);
          return {
            id: item.id || String(Math.random()),
            customer_id: item.customer_id || "",
            customer_name: item.customer_name || "Cliente Invalido",
            total_amount: Number(item.total_amount) || 0,
            balance: Number(item.balance) || 0,
            status: item.status || "pending",
            items: Array.isArray(item.items) ? item.items : [],
            created_at: item.created_at || new Date().toISOString(),
            due_date: item.due_date || new Date().toISOString()
          };
        }
        return result.data;
      });
      setLayaways(validated);
    }
  };

  const handleLoadMore = () => {
    const newLimit = limit + 20;
    setLimit(newLimit);
    fetchLayaways(newLimit, searchQuery);
  };

  useEffect(() => {
    fetchLayaways(limit, searchQuery);
  }, [limit, searchQuery]);

  const handlePay = async (layaway: any) => {
    const payment = parseFloat(
      window.prompt(
        `Saldo pendiente: $${layaway.balance.toFixed(2)}\n¿Cuánto va a abonar?`
      ) || ""
    );
    if (isNaN(payment) || payment <= 0) return;
    if (payment > layaway.balance)
      return alert("El abono no puede superar el saldo pendiente.");

    const newBalance = layaway.balance - payment;
    const isCompleted = newBalance <= 0.01; // floating point safe

    const { error } = await supabase
      .from("layaways")
      .update({
        balance: newBalance,
        status: isCompleted ? "completed" : "pending",
      })
      .eq("id", layaway.id);

    if (error) return alert("Error al registrar el abono.");

    // Print Thermal Ticket for Abono
    const ticketWindow = window.open("", "_blank", "width=300,height=500");
    if (ticketWindow) {
      const ticketHtml = `
        <html>
          <head>
            <style>
              body { font-family: 'Courier New', Courier, monospace; margin: 0; padding: 10px; width: 58mm; color: #000; background: #fff; }
              .center { text-align: center; }
              .divider { border-bottom: 1px dashed #000; margin: 10px 0; }
              .bold { font-weight: bold; }
            </style>
          </head>
          <body>
            <div class="center bold" style="font-size: 16px; margin-bottom: 5px;">FERRETERÍA ERIKA</div>
            <div class="center" style="font-size: 12px;">Comprobante de Abono</div>
            <div class="divider"></div>
            <div style="font-size: 12px; margin-bottom: 5px;">Fecha: ${new Date().toLocaleString()}</div>
            <div style="font-size: 12px; margin-bottom: 5px;">Cliente: ${layaway.customer_name}</div>
            <div class="divider"></div>
            <div style="display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 5px;">
              <div>Abono Recibido:</div>
              <div class="bold">$${payment.toFixed(2)}</div>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 5px;">
              <div>Saldo Restante:</div>
              <div class="bold">$${newBalance.toFixed(2)}</div>
            </div>
            <div class="divider"></div>
            <div class="center bold" style="font-size: 12px; margin-top: 10px;">
              ${isCompleted ? "¡APARTADO LIQUIDADO!" : "¡Gracias por su abono!"}
            </div>
          </body>
        </html>
      `;
      ticketWindow.document.write(ticketHtml);
      ticketWindow.document.close();
      setTimeout(() => {
        ticketWindow.print();
        ticketWindow.close();
      }, 500);
    }

    alert(
      `✅ Abono registrado. ${
        isCompleted
          ? "¡APARTADO LIQUIDADO, puede entregar la mercancía!"
          : `Saldo restante: $${newBalance.toFixed(2)}`
      }`
    );
    fetchLayaways();
  };

  const handleCancel = async (layaway: any) => {
    if (
      !window.confirm(
        "¿Seguro que deseas cancelar este apartado? La mercancía regresará al inventario físico."
      )
    )
      return;

    for (const item of layaway.items) {
      // Find current stock by name
      const { data: currentStock } = await supabase
        .from("inventory")
        .select("stock")
        .eq("name", item.name)
        .single();
      if (currentStock) {
        await supabase
          .from("inventory")
          .update({ stock: currentStock.stock + item.qty })
          .eq("name", item.name);
      }
    }

    const { error } = await supabase
      .from("layaways")
      .update({ status: "cancelled" })
      .eq("id", layaway.id);
    if (error) return alert("Error al cancelar.");
    alert("❌ Apartado cancelado. Productos devueltos.");
    fetchLayaways();
  };

  return (
    <div
      className="animate-fade-in"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        height: "100%",
      }}
    >
      <div className="flex-between">
        <h2 style={{ color: "var(--color-primary)", margin: 0 }}>
          📦 Gestión de Apartados (Layaways)
        </h2>
      </div>

      <div style={{ maxWidth: "400px" }}>
        <input 
          type="text" 
          placeholder="🔍 Buscar por nombre de cliente..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: "100%",
            padding: "8px 12px",
            borderRadius: "6px",
            border: "1px solid var(--glass-border)",
            background: "rgba(0,0,0,0.3)",
            color: "white",
            fontSize: "0.85rem",
            outline: "none"
          }}
        />
      </div>

      <div className="glass-panel" style={{ background: "rgba(0,0,0,0.3)", borderRadius: "8px", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
          <thead style={{ background: "rgba(255,255,255,0.05)" }}>
            <tr>
              <th style={{ padding: "12px" }}>Fecha / Vencimiento</th>
              <th style={{ padding: "12px" }}>Cliente</th>
              <th style={{ padding: "12px" }}>Artículos</th>
              <th style={{ padding: "12px" }}>Total</th>
              <th style={{ padding: "12px", color: "var(--color-secondary)" }}>Saldo</th>
              <th style={{ padding: "12px", textAlign: "center" }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {layaways.map(l => (
              <tr key={l.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", opacity: l.status === "cancelled" ? 0.5 : 1 }}>
                <td style={{ padding: "15px" }}>
                  <div>{new Date(l.created_at).toLocaleDateString()}</div>
                  <div style={{ fontSize: "0.8rem", color: l.status === "pending" && new Date(l.due_date) < new Date() ? "#ef4444" : "var(--color-secondary)" }}>
                    Vence: {new Date(l.due_date).toLocaleDateString()}
                  </div>
                </td>
                <td style={{ padding: "15px" }}>{l.customer_name}</td>
                <td style={{ padding: "15px", fontSize: "0.8rem" }}>
                  {l.items.map((i: any, idx: number) => (
                    <div key={idx}>{i.qty}x {i.name}</div>
                  ))}
                </td>
                <td style={{ padding: "15px", fontWeight: "bold" }}>${l.total_amount.toFixed(2)}</td>
                <td style={{ padding: "15px", fontWeight: "bold", color: l.balance > 0 ? "var(--color-secondary)" : "#10b981" }}>
                  ${l.balance.toFixed(2)}
                </td>
                <td style={{ padding: "15px", display: "flex", gap: "10px", justifyContent: "center" }}>
                  {l.status === "pending" && (
                    <>
                      <button className="btn-primary" style={{ padding: "5px 10px", fontSize: "0.8rem", background: "transparent", border: "1px solid var(--color-secondary)" }} onClick={() => handlePay(l)}>
                        💵 Abonar
                      </button>
                      <button className="btn-primary" style={{ padding: "5px 10px", fontSize: "0.8rem", background: "transparent", border: "1px solid #ef4444", color: "#ef4444" }} onClick={() => handleCancel(l)}>
                        ❌ Cancelar
                      </button>
                    </>
                  )}
                  {l.status === "completed" && <span style={{ color: "#10b981", fontWeight: "bold" }}>✅ Pagado</span>}
                  {l.status === "cancelled" && <span style={{ color: "#ef4444", fontWeight: "bold" }}>🚫 Cancelado</span>}
                </td>
              </tr>
            ))}
            {layaways.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: "20px", textAlign: "center", color: "rgba(255,255,255,0.5)" }}>
                  No hay apartados registrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {hasMore && (
          <div style={{ display: "flex", justifyContent: "center", padding: "15px" }}>
            <button
              onClick={handleLoadMore}
              style={{
                background: "transparent",
                color: "var(--color-secondary)",
                border: "1px dashed var(--color-secondary)",
                padding: "8px 20px",
                borderRadius: "5px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              ➕ Cargar más apartados
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
