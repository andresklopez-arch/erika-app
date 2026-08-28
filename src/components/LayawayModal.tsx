import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth, useBusinessProfile } from "./AuthProvider";
import { payLayaway, cancelLayaway } from "../lib/layawaysClient";
import { reduceInventoryStock } from "../lib/inventoryClient";
import { printAbonoReceipt } from "../lib/receiptPrinting";
import { usePromptModal } from "./PromptModal";

export default function LayawayModal({ show, onClose }: { show: boolean; onClose: () => void }) {
  const businessProfile = useBusinessProfile();
  const { businessSettings } = useAuth();
  const [layaways, setLayaways] = useState<any[]>([]);
  const { modal: promptModal, confirmAsync, promptNumberAsync } = usePromptModal();

  const fetchLayaways = async () => {
    const { data } = await supabase.from("layaways").select("*").order("created_at", { ascending: false });
    if (data) setLayaways(data);
  };

  useEffect(() => {
    if (show) fetchLayaways();
  }, [show]);

  if (!show) return null;

  const handlePay = async (layaway: any) => {
    const payment = await promptNumberAsync(
      "💵 Registrar Abono",
      `Saldo pendiente: $${layaway.balance.toFixed(2)}\n¿Cuánto va a abonar?`,
      "",
      "Registrar Abono"
    );
    if (payment === null || isNaN(payment) || payment <= 0) return;
    if (payment > layaway.balance) return alert("El abono no puede superar el saldo pendiente.");

    const { error, newBalance: resultBalance, isCompleted, cashRegistered } = await payLayaway(layaway.id, payment);
    if (error) return alert("Error al registrar el abono: " + error.message);
    const newBalance = resultBalance as number;

    // Ticket térmico del abono
    printAbonoReceipt(
      { businessName: businessProfile.name, customerName: layaway.customer_name, payment, newBalance, isCompleted: Boolean(isCompleted) },
      businessSettings?.config
    );

    const cashNotice = cashRegistered ? "" : "\n⚠️ La caja está cerrada: este efectivo no quedó registrado en ningún corte.";
    alert(`✅ Abono registrado. ${isCompleted ? "¡APARTADO LIQUIDADO, puede entregar la mercancía!" : `Saldo restante: $${newBalance.toFixed(2)}`}${cashNotice}`);
    fetchLayaways();
  };

  const handleCancel = async (layaway: any) => {
    const confirmed = await confirmAsync(
      "❌ Cancelar Apartado",
      "¿Seguro que deseas cancelar este apartado? La mercancía regresará al inventario físico.",
      { confirmLabel: "Sí, cancelar", danger: true }
    );
    if (!confirmed) return;

    const failedItems: string[] = [];
    for (const item of layaway.items) {
      // Buscar primero por código (SKU) si el renglón lo trae — es un
      // identificador mucho más estable que el nombre: si el producto se
      // renombra después de crear el apartado, la búsqueda por nombre deja
      // de encontrarlo y el stock no se restaura al cancelar.
      let matchQuery = item.code
        ? supabase.from("inventory").select("id, stock").eq("code", item.code)
        : supabase.from("inventory").select("id, stock").eq("name", item.name);
      const { data: currentStock, error: findError } = await matchQuery.single();
      if (findError || !currentStock) {
        failedItems.push(item.name);
        continue;
      }
      const { error: updateError } = await reduceInventoryStock([{ id: currentStock.id, qty: -item.qty }], "cancellation", `LAY-CANCEL-${layaway.id}`);
      if (updateError) {
        failedItems.push(item.name);
      }
    }

    const { error } = await cancelLayaway(layaway.id);
    if (error) return alert("Error al cancelar.");

    if (failedItems.length > 0) {
      alert(
        `⚠️ Apartado cancelado, pero NO se pudo restaurar el stock de: ${failedItems.join(", ")}. Ajusta el inventario manualmente.`
      );
    } else {
      alert("❌ Apartado cancelado. Productos devueltos.");
    }
    fetchLayaways();
  };

  return (
    <>
    <div
      style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(0,0,0,0.8)", zIndex: 1000,
        display: "flex", justifyContent: "center", alignItems: "center"
      }}
    >
      <div className="glass-panel" style={{ width: "900px", maxHeight: "90vh", overflowY: "auto", position: "relative" }}>
        <button
          onClick={onClose}
          style={{ position: "absolute", top: "20px", right: "20px", background: "transparent", border: "none", color: "white", fontSize: "1.5rem", cursor: "pointer" }}
        >
          ✖
        </button>
        <h2 style={{ color: "var(--color-primary)", marginTop: 0 }}>📦 Gestión de Apartados (Layaway)</h2>
        <p style={{ color: "var(--color-secondary)", marginBottom: "20px" }}>Aquí puedes gestionar los apartados de los clientes, recibir abonos y entregar mercancía.</p>

        <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: "8px", overflow: "hidden" }}>
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
        </div>
      </div>
    </div>
    {promptModal}
    </>
  );
}
