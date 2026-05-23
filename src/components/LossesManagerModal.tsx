"use client";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

interface Loss {
  id: string;
  loss_type: string;
  amount: number;
  description: string;
  created_at: string;
}

interface LossesManagerModalProps {
  onClose: () => void;
}

export default function LossesManagerModal({ onClose }: LossesManagerModalProps) {
  const [losses, setLosses] = useState<Loss[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);

  // Form states
  const [lossType, setLossType] = useState("Gasto Operativo");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");

  const fetchLosses = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("business_losses")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
       console.error(error);
       if(error.message.includes("relation")) {
           alert("Alerta: Falta la tabla de gastos. Por favor ejecuta el script SQL 'supabase_schema_gastos.sql' en Supabase.");
       }
    }

    if (data) setLosses(data);
    setIsLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLosses();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("business_losses").insert({
      loss_type: lossType,
      amount: parseFloat(amount),
      description,
    });

    if (error) {
      alert("Error al registrar la salida de dinero.");
      console.error(error);
    } else {
      alert("✅ Gasto/Merma registrado.");
      setIsAdding(false);
      setAmount(""); setDescription(""); setLossType("Gasto Operativo");
      fetchLosses();
    }
  };

  const getLossIcon = (type: string) => {
      if (type === "Gasto Operativo") return "💸";
      if (type === "Merma") return "🗑️";
      if (type === "Cambio Físico") return "🔄";
      return "📄";
  };

  return (
    <div
      style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 10000, backdropFilter: "blur(5px)"
      }}
    >
      <div
        className="glass-panel animate-fade-in"
        style={{ width: "800px", maxWidth: "95%", maxHeight: "90vh", display: "flex", flexDirection: "column", position: "relative" }}
      >
        <button
          onClick={onClose}
          style={{ position: "absolute", top: "15px", right: "15px", background: "transparent", border: "none", color: "white", fontSize: "1.5rem", cursor: "pointer" }}
        >
          ✖
        </button>
        <h2 style={{ color: "var(--color-primary)", marginBottom: "20px" }}>
          📉 Control de Gastos, Mermas y Cambios Físicos
        </h2>

        {!isAdding ? (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "15px" }}>
              <button className="btn-primary" onClick={() => setIsAdding(true)} style={{ background: "#ef4444", border: "none" }}>
                ➕ Registrar Nueva Salida de Dinero
              </button>
            </div>
            
            {isLoading ? (
              <div style={{ textAlign: "center", padding: "20px", color: "var(--color-secondary)" }}>Cargando registros...</div>
            ) : losses.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px", background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
                No hay mermas ni gastos registrados.
              </div>
            ) : (
              <div style={{ overflowY: "auto", flex: 1 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                  <thead style={{ background: "rgba(255,255,255,0.05)", borderBottom: "1px solid var(--glass-border)", position: "sticky", top: 0 }}>
                    <tr>
                      <th style={{ padding: "12px" }}>Fecha</th>
                      <th style={{ padding: "12px" }}>Categoría</th>
                      <th style={{ padding: "12px" }}>Descripción</th>
                      <th style={{ padding: "12px", textAlign: "right" }}>Pérdida ($)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {losses.map(l => (
                      <tr key={l.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        <td style={{ padding: "15px", color: "var(--color-secondary)", fontSize: "0.9rem" }}>
                            {new Date(l.created_at).toLocaleString()}
                        </td>
                        <td style={{ padding: "15px", fontWeight: "bold" }}>
                            {getLossIcon(l.loss_type)} {l.loss_type}
                        </td>
                        <td style={{ padding: "15px" }}>{l.description}</td>
                        <td style={{ padding: "15px", color: "#ef4444", fontWeight: "bold", fontSize: "1.1rem", textAlign: "right" }}>
                            -${l.amount.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <form onSubmit={handleSave} className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
            <div style={{ display: "flex", gap: "15px" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", marginBottom: "5px", color: "var(--color-secondary)" }}>Categoría de Pérdida *</label>
                <select autoFocus required value={lossType} onChange={e => setLossType(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.8)", color: "white" }}>
                  <option value="Gasto Operativo">💸 Gasto Operativo (Luz, Nómina, Rentas)</option>
                  <option value="Merma">🗑️ Merma (Producto Roto, Caducado, Robo)</option>
                  <option value="Cambio Físico">🔄 Cambio Físico (Pérdida por garantía)</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", marginBottom: "5px", color: "var(--color-secondary)" }}>Monto de la Pérdida ($) *</label>
                <input required type="number" step="0.01" min="0.01" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #ef4444", background: "rgba(0,0,0,0.3)", color: "white" }} placeholder="Ej. 500.00" />
              </div>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "5px", color: "var(--color-secondary)" }}>Descripción Detallada *</label>
              <textarea required value={description} onChange={e => setDescription(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white", minHeight: "80px" }} placeholder="Ej. Pago de CFE bimestral, o Taladro dañado al caerse de exhibición." />
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
              <button type="button" onClick={() => setIsAdding(false)} style={{ flex: 1, padding: "12px", borderRadius: "8px", background: "transparent", border: "1px solid var(--glass-border)", color: "white", cursor: "pointer" }}>
                Cancelar
              </button>
              <button type="submit" style={{ flex: 2, padding: "12px", fontSize: "1.1rem", background: "#ef4444", color: "white", border: "none", borderRadius: "8px", fontWeight: "bold", cursor: "pointer" }}>
                💾 Registrar Salida de Dinero
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
