"use client";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

interface Supplier {
  id: string;
  name: string;
}

interface Debt {
  id: string;
  supplier_id: string;
  supplier_name?: string;
  amount: number;
  balance: number;
  due_date: string;
  concept: string;
  status: string;
  penalty_rate_percent?: number;
}

interface AccountsPayableModalProps {
  onClose: () => void;
}

export default function AccountsPayableModal({ onClose }: AccountsPayableModalProps) {
  const [debts, setDebts] = useState<Debt[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [activeTab, setActiveTab] = useState<'pending'|'paid'>('pending');

  // New Debt Form
  const [supplierId, setSupplierId] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [concept, setConcept] = useState("");
  const [penaltyRate, setPenaltyRate] = useState("0");

  // Payment Form
  const [paymentModalDebt, setPaymentModalDebt] = useState<Debt | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [calculatedInterest, setCalculatedInterest] = useState(0);

  const fetchData = async () => {
    setIsLoading(true);
    // Fetch Suppliers
    const { data: supData } = await supabase.from("suppliers").select("id, name").order("name");
    if (supData) setSuppliers(supData);

    // Fetch Debts
    const { data: debtData, error } = await supabase
      .from("supplier_debts")
      .select(`
        *,
        suppliers(name)
      `)
      .order("due_date", { ascending: true });

    if (error) {
       console.error(error);
       if(error.message.includes("penalty_rate_percent")) {
           alert("Alerta: Falta la columna de intereses. Por favor ejecuta el script SQL 'supabase_schema_intereses.sql' en Supabase.");
       }
    }

    if (debtData) {
      const formattedDebts = debtData.map((d: any) => ({
        ...d,
        supplier_name: d.suppliers?.name || "Desconocido"
      }));
      setDebts(formattedDebts);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSaveDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId) return alert("Selecciona un proveedor.");
    
    const { error } = await supabase.from("supplier_debts").insert({
      supplier_id: supplierId,
      amount: parseFloat(amount),
      balance: parseFloat(amount),
      due_date: dueDate,
      concept,
      penalty_rate_percent: parseFloat(penaltyRate) || 0
    });
    if (error) {
      alert("Error al registrar la deuda.");
      console.error(error);
    } else {
      alert("✅ Deuda registrada.");
      setIsAdding(false);
      setSupplierId(""); setAmount(""); setDueDate(""); setConcept(""); setPenaltyRate("0");
      fetchData();
    }
  };

  const calculateInterest = (debt: Debt) => {
      const today = new Date();
      const due = new Date(debt.due_date);
      if (today <= due || !debt.penalty_rate_percent || debt.penalty_rate_percent <= 0) return 0;
      
      const diffTime = Math.abs(today.getTime() - due.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
      
      // Interés simple diario (Tasa Mensual / 30) * Días de atraso * Balance Actual
      const dailyRate = (debt.penalty_rate_percent / 100) / 30;
      const interest = debt.balance * dailyRate * diffDays;
      return interest;
  };

  const openPaymentModal = (debt: Debt) => {
      setPaymentModalDebt(debt);
      setCalculatedInterest(calculateInterest(debt));
      setPaymentAmount("");
      setPaymentNotes("");
  };

  const printThermalTicket = (debt: Debt, payAmt: number, newBalance: number) => {
      const newWindow = window.open("", "_blank", "width=300,height=600");
      if (!newWindow) return;
      newWindow.document.write(`
        <html>
          <head>
            <style>
              body { font-family: 'Courier New', Courier, monospace; margin: 0; padding: 10px; width: 58mm; text-align: center; }
              h2, h3, p { margin: 5px 0; }
              .divider { border-bottom: 1px dashed black; margin: 10px 0; }
              .text-left { text-align: left; }
              .text-right { text-align: right; }
              .bold { font-weight: bold; }
            </style>
          </head>
          <body>
            <h2>FERRETERÍA ERIKA</h2>
            <p>TICKET DE ABONO A PROVEEDOR</p>
            <div class="divider"></div>
            <div class="text-left">
              <p><b>Fecha:</b> ${new Date().toLocaleString()}</p>
              <p><b>Proveedor:</b> ${debt.supplier_name}</p>
              <p><b>Concepto:</b> ${debt.concept}</p>
              <p><b>Abono ID:</b> ${Math.floor(Math.random()*10000)}</p>
            </div>
            <div class="divider"></div>
            <div style="display: flex; justify-content: space-between;">
              <span>Total Abonado:</span>
              <span class="bold">$${payAmt.toFixed(2)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-top: 5px;">
              <span>Nuevo Saldo:</span>
              <span>$${newBalance.toFixed(2)}</span>
            </div>
            <div class="divider"></div>
            <p style="font-size: 0.8rem; margin-top: 15px;">Firma de Recibido:</p>
            <br/><br/><br/>
            <p>_______________________</p>
            <p>Gracias por su preferencia</p>
            <script>
              window.onload = function() { setTimeout(() => { window.print(); window.close(); }, 500); };
            </script>
          </body>
        </html>
      `);
      newWindow.document.close();
  };

  const handleApplyPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentModalDebt) return;
    
    const payAmt = parseFloat(paymentAmount);
    const totalDue = paymentModalDebt.balance + calculatedInterest;

    if (payAmt <= 0 || payAmt > totalDue + 0.05) { // +0.05 tolerance for rounding
        return alert("El monto del abono debe ser mayor a 0 y no puede exceder el saldo pendiente + intereses.");
    }

    const newBalance = Math.max(0, totalDue - payAmt);
    const newStatus = newBalance === 0 ? 'paid' : paymentModalDebt.status;

    // 1. Insert Payment
    await supabase.from("supplier_payments").insert({
        debt_id: paymentModalDebt.id,
        amount: payAmt,
        notes: paymentNotes + (calculatedInterest > 0 ? ` (Incluye mora: $${calculatedInterest.toFixed(2)})` : "")
    });

    // 2. Update Debt Balance
    await supabase.from("supplier_debts")
        .update({ balance: newBalance, status: newStatus })
        .eq("id", paymentModalDebt.id);

    alert(`✅ Abono de $${payAmt.toFixed(2)} registrado con éxito.`);
    
    // 3. Print Thermal Ticket
    printThermalTicket(paymentModalDebt, payAmt, newBalance);

    setPaymentModalDebt(null);
    fetchData();
  };

  // KPIs & Tab Filtering
  const today = new Date().toISOString().split('T')[0];
  const pendingDebts = debts.filter(d => d.status !== 'paid');
  const paidDebts = debts.filter(d => d.status === 'paid');

  const activeDebtsList = activeTab === 'pending' ? pendingDebts : paidDebts;

  const totalDebt = pendingDebts.reduce((sum, d) => sum + d.balance, 0);
  const overdueDebt = pendingDebts.filter(d => d.due_date < today).reduce((sum, d) => sum + d.balance, 0);
  const upcomingDebt = pendingDebts.filter(d => d.due_date >= today && d.due_date <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]).reduce((sum, d) => sum + d.balance, 0);

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
        style={{ width: "1000px", maxWidth: "95%", maxHeight: "90vh", display: "flex", flexDirection: "column", position: "relative" }}
      >
        <button
          onClick={onClose}
          style={{ position: "absolute", top: "15px", right: "15px", background: "transparent", border: "none", color: "white", fontSize: "1.5rem", cursor: "pointer" }}
        >
          ✖
        </button>
        <h2 style={{ color: "var(--color-primary)", marginBottom: "20px", display: "flex", alignItems: "center", gap: "15px" }}>
          💳 Cuentas por Pagar 
          {!isAdding && (
             <div style={{ display: "flex", background: "rgba(255,255,255,0.1)", borderRadius: "8px", overflow: "hidden", fontSize: "1rem" }}>
                <button onClick={() => setActiveTab('pending')} style={{ padding: "8px 15px", background: activeTab === 'pending' ? "var(--color-primary)" : "transparent", color: "white", border: "none", cursor: "pointer" }}>⏳ Pendientes</button>
                <button onClick={() => setActiveTab('paid')} style={{ padding: "8px 15px", background: activeTab === 'paid' ? "#10b981" : "transparent", color: "white", border: "none", cursor: "pointer" }}>✅ Historial Pagadas</button>
             </div>
          )}
        </h2>

        {/* KPIs */}
        {!isAdding && activeTab === 'pending' && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "15px", marginBottom: "20px" }}>
                <div style={{ background: "rgba(255,255,255,0.05)", padding: "15px", borderRadius: "8px", border: "1px solid var(--glass-border)", textAlign: "center" }}>
                    <div style={{ color: "var(--color-secondary)", fontSize: "0.9rem" }}>Deuda Total Activa</div>
                    <div style={{ fontSize: "1.8rem", fontWeight: "bold", color: "white" }}>${totalDebt.toFixed(2)}</div>
                </div>
                <div style={{ background: "rgba(239,68,68,0.1)", padding: "15px", borderRadius: "8px", border: "1px solid rgba(239,68,68,0.3)", textAlign: "center" }}>
                    <div style={{ color: "#ef4444", fontSize: "0.9rem" }}>Vencido (Urgente)</div>
                    <div style={{ fontSize: "1.8rem", fontWeight: "bold", color: "#ef4444" }}>${overdueDebt.toFixed(2)}</div>
                </div>
                <div style={{ background: "rgba(245,158,11,0.1)", padding: "15px", borderRadius: "8px", border: "1px solid rgba(245,158,11,0.3)", textAlign: "center" }}>
                    <div style={{ color: "#f59e0b", fontSize: "0.9rem" }}>Por Vencer (7 días)</div>
                    <div style={{ fontSize: "1.8rem", fontWeight: "bold", color: "#f59e0b" }}>${upcomingDebt.toFixed(2)}</div>
                </div>
            </div>
        )}

        {!isAdding ? (
          <>
            {activeTab === 'pending' && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "15px" }}>
                <button className="btn-primary" onClick={() => setIsAdding(true)}>
                    ➕ Registrar Nueva Factura / Crédito
                </button>
                </div>
            )}
            
            {isLoading ? (
              <div style={{ textAlign: "center", padding: "20px", color: "var(--color-secondary)" }}>Cargando deudas...</div>
            ) : activeDebtsList.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px", background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
                {activeTab === 'pending' ? "¡Excelente! No tienes cuentas por pagar pendientes." : "No tienes historial de deudas pagadas al 100%."}
              </div>
            ) : (
              <div style={{ overflowY: "auto", flex: 1 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                  <thead style={{ background: "rgba(255,255,255,0.05)", borderBottom: "1px solid var(--glass-border)", position: "sticky", top: 0 }}>
                    <tr>
                      <th style={{ padding: "12px" }}>Vencimiento</th>
                      <th style={{ padding: "12px" }}>Proveedor</th>
                      <th style={{ padding: "12px" }}>Concepto</th>
                      <th style={{ padding: "12px" }}>Monto Original</th>
                      {activeTab === 'pending' && <th style={{ padding: "12px" }}>Saldo Pendiente</th>}
                      {activeTab === 'pending' && <th style={{ padding: "12px", textAlign: "center" }}>Acción</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {activeDebtsList.map(d => {
                      const isOverdue = activeTab === 'pending' && d.due_date < today;
                      const isWarning = activeTab === 'pending' && d.due_date >= today && d.due_date <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                      const calcInt = isOverdue ? calculateInterest(d) : 0;
                      
                      return (
                      <tr key={d.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: isOverdue ? "rgba(239,68,68,0.05)" : isWarning ? "rgba(245,158,11,0.05)" : "transparent" }}>
                        <td style={{ padding: "15px", color: isOverdue ? "#ef4444" : isWarning ? "#f59e0b" : "white", fontWeight: "bold" }}>
                            {d.due_date} {isOverdue && "⚠️"}
                        </td>
                        <td style={{ padding: "15px", fontWeight: "bold" }}>{d.supplier_name}</td>
                        <td style={{ padding: "15px", fontSize: "0.9rem" }}>{d.concept}</td>
                        <td style={{ padding: "15px", color: "var(--color-secondary)" }}>${d.amount.toFixed(2)}</td>
                        {activeTab === 'pending' && (
                            <td style={{ padding: "15px", fontWeight: "bold", fontSize: "1.1rem" }}>
                                ${d.balance.toFixed(2)}
                                {calcInt > 0 && <div style={{ fontSize: "0.75rem", color: "#ef4444" }}>+ Mora: ${calcInt.toFixed(2)}</div>}
                            </td>
                        )}
                        {activeTab === 'pending' && (
                            <td style={{ padding: "15px", textAlign: "center" }}>
                            <button 
                                onClick={() => openPaymentModal(d)}
                                style={{ background: "#10b981", color: "white", border: "none", padding: "8px 12px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}
                            >
                                💰 Abonar
                            </button>
                            </td>
                        )}
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <form onSubmit={handleSaveDebt} className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "15px", flex: 1, overflowY: "auto", paddingRight: "10px" }}>
            
            <div style={{ display: "flex", gap: "15px" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", marginBottom: "5px", color: "var(--color-secondary)" }}>Proveedor *</label>
                <select required value={supplierId} onChange={e => setSupplierId(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.8)", color: "white" }}>
                  <option value="">-- Seleccionar --</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", marginBottom: "5px", color: "var(--color-secondary)" }}>Monto Total ($) *</label>
                <input required type="number" step="0.01" min="0.01" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} placeholder="Ej. 15000.00" />
              </div>
            </div>
            
            <div style={{ display: "flex", gap: "15px" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", marginBottom: "5px", color: "var(--color-secondary)" }}>Fecha de Vencimiento *</label>
                <input required type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--color-primary)", background: "rgba(0,0,0,0.3)", color: "white" }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", marginBottom: "5px", color: "var(--color-secondary)" }}>% Interés Mensual Moratorio (Opcional)</label>
                <input type="number" step="0.1" min="0" value={penaltyRate} onChange={e => setPenaltyRate(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} placeholder="Ej. 5 (para 5% mensual)" />
              </div>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "5px", color: "var(--color-secondary)" }}>Concepto / Notas (Productos amparados) *</label>
              <textarea required value={concept} onChange={e => setConcept(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white", minHeight: "80px" }} placeholder="Ej. Factura F-9912. Ampara 50 cajas de clavos 2 pulgadas." />
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
              <button type="button" onClick={() => setIsAdding(false)} style={{ flex: 1, padding: "12px", borderRadius: "8px", background: "transparent", border: "1px solid var(--glass-border)", color: "white", cursor: "pointer" }}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" style={{ flex: 2, padding: "12px", fontSize: "1.1rem" }}>
                💾 Registrar Deuda
              </button>
            </div>
          </form>
        )}

        {/* Modal de Abono */}
        {paymentModalDebt && (
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.9)", borderRadius: "16px", padding: "20px", display: "flex", flexDirection: "column", zIndex: 200, backdropFilter: "blur(5px)", alignItems: "center", justifyContent: "center" }}>
                <div className="glass-panel" style={{ width: "500px", maxWidth: "90%" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                        <h3 style={{ margin: 0, color: "var(--color-primary)" }}>Registrar Abono</h3>
                        <button onClick={() => setPaymentModalDebt(null)} style={{ background: "transparent", border: "none", color: "white", fontSize: "1.5rem", cursor: "pointer" }}>✖</button>
                    </div>
                    
                    <div style={{ marginBottom: "20px", padding: "15px", background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
                        <p style={{ margin: "0 0 10px 0" }}><strong>Proveedor:</strong> {paymentModalDebt.supplier_name}</p>
                        <p style={{ margin: "0 0 10px 0" }}><strong>Concepto:</strong> {paymentModalDebt.concept}</p>
                        <p style={{ margin: 0, fontSize: "1.2rem", display: "flex", justifyContent: "space-between" }}>
                            <span><strong>Saldo Restante:</strong></span>
                            <span>${paymentModalDebt.balance.toFixed(2)}</span>
                        </p>
                        {calculatedInterest > 0 && (
                            <p style={{ margin: "10px 0 0 0", fontSize: "1.1rem", display: "flex", justifyContent: "space-between", color: "#ef4444" }}>
                                <span><strong>+ Intereses Acumulados:</strong></span>
                                <span>${calculatedInterest.toFixed(2)}</span>
                            </p>
                        )}
                        <hr style={{ borderColor: "#444", margin: "10px 0" }} />
                        <p style={{ margin: 0, fontSize: "1.3rem", display: "flex", justifyContent: "space-between", color: "var(--color-primary)", fontWeight: "bold" }}>
                            <span>Total a Liquidar:</span>
                            <span>${(paymentModalDebt.balance + calculatedInterest).toFixed(2)}</span>
                        </p>
                    </div>

                    <form onSubmit={handleApplyPayment} style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
                        <div>
                            <label style={{ display: "block", marginBottom: "5px", color: "var(--color-secondary)" }}>Monto a Abonar ($)</label>
                            <input required type="number" step="0.01" max={(paymentModalDebt.balance + calculatedInterest).toFixed(2)} min="0.01" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--color-primary)", background: "rgba(0,0,0,0.3)", color: "white", fontSize: "1.2rem", fontWeight: "bold" }} placeholder={`Máximo $${(paymentModalDebt.balance + calculatedInterest).toFixed(2)}`} />
                        </div>
                        <div>
                            <label style={{ display: "block", marginBottom: "5px", color: "var(--color-secondary)" }}>Referencia de Pago / Notas</label>
                            <input type="text" value={paymentNotes} onChange={e => setPaymentNotes(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} placeholder="Ej. Transferencia SPEI #98129" />
                        </div>
                        <button type="submit" style={{ background: "#10b981", color: "white", border: "none", padding: "12px", borderRadius: "8px", cursor: "pointer", fontWeight: "bold", fontSize: "1.1rem", marginTop: "10px" }}>
                            Confirmar Abono e Imprimir Ticket 🖨️
                        </button>
                    </form>
                </div>
            </div>
        )}

      </div>
    </div>
  );
}
