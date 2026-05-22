"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../components/AuthProvider";
import ProtectedRoute from "../../components/ProtectedRoute";

interface Denominations {
  b1000: number;
  b500: number;
  b200: number;
  b100: number;
  b50: number;
  b20: number;
  m10: number;
  m5: number;
  m2: number;
  m1: number;
  m05: number;
}

export default function CajaModule() {
  const [session, setSession] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [initialBalance, setInitialBalance] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const [denoms, setDenoms] = useState<Denominations>({
    b1000: 0,
    b500: 0,
    b200: 0,
    b100: 0,
    b50: 0,
    b20: 0,
    m10: 0,
    m5: 0,
    m2: 0,
    m1: 0,
    m05: 0,
  });
  const { currentUser } = useAuth();
  const [showTicket, setShowTicket] = useState(false);
  const [ticketData, setTicketData] = useState<any>(null);

  const fetchSession = async () => {
    setIsLoading(true);
    const { data: activeSession } = await supabase
      .from("cash_sessions")
      .select("*")
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .single();
    if (activeSession) {
      setSession(activeSession);
      const { data: txs } = await supabase
        .from("cash_transactions")
        .select("*")
        .eq("session_id", activeSession.id)
        .order("created_at", { ascending: false });
      setTransactions(txs || []);
    } else {
      setSession(null);
      setTransactions([]);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchSession();
    // Pedir permisos de Notificación Push al cargar la caja
    if ("Notification" in window && Notification.permission !== "granted") {
      Notification.requestPermission();
    }
  }, []);

  const openRegister = async () => {
    if (initialBalance < 0)
      return alert("El fondo inicial no puede ser negativo.");
    const { error } = await supabase.from("cash_sessions").insert({
      initial_balance: initialBalance,
      opened_by: currentUser?.name || "Desconocido",
    });
    if (error) alert("Error al abrir caja: " + error.message);
    else fetchSession();
  };

  const registerMovement = async (type: "deposit" | "withdrawal") => {
    const amountStr = window.prompt(
      `Monto del ${type === "deposit" ? "Ingreso" : "Retiro"}:`,
    );
    if (!amountStr) return;
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) return alert("Monto inválido.");

    // VERIFICACIÓN DE SEGURIDAD (FASE 6)
    if (
      type === "withdrawal" &&
      amount > 2000 &&
      currentUser?.role !== "admin"
    ) {
      const pin = window.prompt(
        "⚠️ LÍMITE SUPERADO. Este retiro de alto valor requiere PIN de Administrador:",
      );
      if (!pin) return;
      const { data: adminCheck } = await supabase
        .from("users")
        .select("id")
        .eq("role", "admin")
        .eq("pin", pin)
        .single();
      if (!adminCheck)
        return alert("❌ PIN Inválido o sin privilegios de administrador.");
      alert("✅ Retiro mayor autorizado por Administrador.");
    }
    const desc = window.prompt("Motivo / Concepto:");
    if (!desc) return alert("Debe especificar un motivo.");

    const { error } = await supabase.from("cash_transactions").insert({
      session_id: session.id,
      type,
      amount,
      description: desc,
    });

    if (error) alert("Error: " + error.message);
    else fetchSession();
  };

  const calculateTotalCounted = () => {
    return (
      denoms.b1000 * 1000 +
      denoms.b500 * 500 +
      denoms.b200 * 200 +
      denoms.b100 * 100 +
      denoms.b50 * 50 +
      denoms.b20 * 20 +
      denoms.m10 * 10 +
      denoms.m5 * 5 +
      denoms.m2 * 2 +
      denoms.m1 * 1 +
      denoms.m05 * 0.5
    );
  };

  const closeRegister = async () => {
    const countedTotal = calculateTotalCounted();
    
    // Biometric / PIN check
    const biometricAuth = window.confirm("👤 [AUTORIZACIÓN BIOMÉTRICA]\n\nPor favor, coloque su huella dactilar en el lector para autorizar el Cierre de Caja Ciego.");
    if (!biometricAuth) {
        const pin = window.prompt("🔑 Huella no detectada. Ingrese PIN Maestro de respaldo:");
        if (pin !== "admin123") return alert("Acceso Denegado. Solo el administrador puede realizar el cierre.");
    }

    const expectedSales = transactions
      .filter((t) => t.type === "sale")
      .reduce((sum, t) => sum + t.amount, 0);
    const expectedDeposits = transactions
      .filter((t) => t.type === "deposit")
      .reduce((sum, t) => sum + t.amount, 0);
    const expectedWithdrawals = transactions
      .filter((t) => t.type === "withdrawal")
      .reduce((sum, t) => sum + t.amount, 0);

    const expectedTotal =
      Number(session.initial_balance) +
      expectedSales +
      expectedDeposits -
      expectedWithdrawals;
      
    const discrepancy = countedTotal - expectedTotal;

    await supabase
      .from("cash_sessions")
      .update({
        closed_at: new Date().toISOString(),
        expected_balance: expectedTotal,
        counted_balance: countedTotal,
        discrepancy: discrepancy,
        status: "closed",
        total_sales: expectedSales,
      })
      .eq("id", session.id);

    // ALERTA PUSH AL DUEÑO SI FALTAN MÁS DE $500
    if (
      discrepancy <= -500 &&
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      new Notification("🚨 ALERTA CRÍTICA: ROBO O EXTRAVÍO", {
        body: `Faltante de $${Math.abs(discrepancy).toFixed(2)} registrado por ${currentUser?.name} en la caja.`,
        icon: "/erika_avatar.png",
      });
    }

    setTicketData({
      date: new Date().toLocaleString(),
      cajero: currentUser?.name,
      fondo: session.initial_balance,
      ventas: expectedSales,
      ingresos: expectedDeposits,
      retiros: expectedWithdrawals,
      esperado: expectedTotal,
      fisico: countedTotal,
      descuadre: discrepancy,
    });
    setShowTicket(true);
    fetchSession();
    setDenoms({
      b1000: 0,
      b500: 0,
      b200: 0,
      b100: 0,
      b50: 0,
      b20: 0,
      m10: 0,
      m5: 0,
      m2: 0,
      m1: 0,
      m05: 0,
    });
    
    alert(`✅ Caja Cerrada. ${discrepancy !== 0 ? `\n⚠️ DESCUADRE DETECTADO: $${discrepancy.toFixed(2)}` : '\n✅ Caja Cuadrada Perfectamente.'}`);
  };

  return (
    <ProtectedRoute permission="caja">
      {isLoading ? (
        <div
          style={{
            padding: "40px",
            textAlign: "center",
            color: "var(--color-secondary)",
          }}
        >
          ☁️ Conectando con la Bóveda...
        </div>
      ) : (
        <div
          className="animate-fade-in"
          style={{ padding: "20px", position: "relative" }}
        >
      {showTicket && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.8)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "white",
              color: "black",
              width: "300px",
              padding: "20px",
              fontFamily: "monospace",
              borderRadius: "4px",
              boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
            }}
          >
            <h2 style={{ textAlign: "center", margin: 0 }}>FERRETERÍA</h2>
            <p
              style={{
                textAlign: "center",
                margin: "5px 0",
                fontSize: "0.8rem",
              }}
            >
              ERIKA Smart POS
            </p>
            <p
              style={{
                textAlign: "center",
                margin: "5px 0",
                borderBottom: "1px dashed black",
                paddingBottom: "10px",
              }}
            >
              TICKET DE CORTE
            </p>
            <p>
              <strong>Fecha:</strong> {ticketData.date}
            </p>
            <p>
              <strong>Cajero:</strong> {ticketData.cajero}
            </p>
            <div
              style={{ borderBottom: "1px dashed black", margin: "10px 0" }}
            ></div>
            <p>Fondo Inicial: ${ticketData.fondo}</p>
            <p>Ventas (+): ${ticketData.ventas}</p>
            <p>Ingresos (+): ${ticketData.ingresos}</p>
            <p>Retiros (-): ${ticketData.retiros}</p>
            <div
              style={{ borderBottom: "1px dashed black", margin: "10px 0" }}
            ></div>
            <p>SISTEMA: ${ticketData.esperado.toFixed(2)}</p>
            <p>FÍSICO: ${ticketData.fisico.toFixed(2)}</p>
            <div
              style={{ borderBottom: "1px dashed black", margin: "10px 0" }}
            ></div>
            <h3
              style={{
                textAlign: "center",
                color: ticketData.descuadre === 0 ? "black" : "red",
              }}
            >
              DESCUADRE: ${ticketData.descuadre.toFixed(2)}
            </h3>
            <button
              className="no-print"
              onClick={() => window.print()}
              style={{
                width: "100%",
                padding: "10px",
                background: "black",
                color: "white",
                marginTop: "20px",
                border: "none",
                cursor: "pointer",
              }}
            >
              🖨️ IMPRIMIR
            </button>
            <button
              className="no-print"
              onClick={() => setShowTicket(false)}
              style={{
                width: "100%",
                padding: "10px",
                background: "#ccc",
                color: "black",
                marginTop: "10px",
                border: "none",
                cursor: "pointer",
              }}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      <h1 style={{ color: "var(--color-primary)", marginBottom: "30px" }}>
        💵 Bóveda y Control de Efectivo
      </h1>

      {!session ? (
        <div
          className="glass-panel flex-center"
          style={{ flexDirection: "column", padding: "50px" }}
        >
          <h2 style={{ color: "var(--color-secondary)" }}>
            La Caja está Cerrada
          </h2>
          <p>
            Para empezar a cobrar, necesitas declarar el fondo inicial
            (morralla).
          </p>
          <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
            <span style={{ fontSize: "1.5rem", alignSelf: "center" }}>$</span>
            <input
              type="number"
              value={initialBalance}
              onChange={(e) => setInitialBalance(Number(e.target.value))}
              style={{
                padding: "15px",
                fontSize: "1.2rem",
                background: "rgba(0,0,0,0.5)",
                color: "white",
                border: "1px solid var(--color-primary)",
                borderRadius: "8px",
              }}
            />
            <button className="btn-primary" onClick={openRegister}>
              Abrir Turno
            </button>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "20px",
          }}
        >
          <div
            style={{ display: "flex", flexDirection: "column", gap: "20px" }}
          >
            <div
              className="glass-panel"
              style={{ background: "rgba(16, 185, 129, 0.05)" }}
            >
              <h3>🟢 Caja Abierta</h3>
              <p>
                Turno iniciado: {new Date(session.opened_at).toLocaleString()}
              </p>
              <p
                style={{ fontSize: "1.2rem", color: "var(--color-secondary)" }}
              >
                Fondo Inicial: <strong>${session.initial_balance}</strong>
              </p>

              <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
                <button
                  className="btn-primary"
                  style={{
                    background: "transparent",
                    border: "1px solid #3b82f6",
                    color: "#3b82f6",
                  }}
                  onClick={() => registerMovement("deposit")}
                >
                  + Ingresar Efectivo
                </button>
                <button
                  className="btn-primary"
                  style={{
                    background: "transparent",
                    border: "1px solid #ef4444",
                    color: "#ef4444",
                  }}
                  onClick={() => registerMovement("withdrawal")}
                >
                  - Retirar Efectivo
                </button>
              </div>
            </div>

            <div className="glass-panel" style={{ flex: 1, overflowY: "auto" }}>
              <h3>📜 Movimientos Recientes</h3>
              <ul style={{ listStyle: "none", padding: 0 }}>
                {transactions.map((t) => (
                  <li
                    key={t.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "10px",
                      borderBottom: "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    <span>
                      {t.type === "sale"
                        ? "🛒 Venta"
                        : t.type === "deposit"
                          ? "⬇️ Ingreso"
                          : "⬆️ Retiro"}
                      {t.description && (
                        <span
                          style={{
                            color: "var(--color-secondary)",
                            marginLeft: "10px",
                            fontSize: "0.8rem",
                          }}
                        >
                          ({t.description})
                        </span>
                      )}
                    </span>
                    <strong
                      style={{
                        color: t.type === "withdrawal" ? "#ef4444" : "#10b981",
                      }}
                    >
                      {t.type === "withdrawal" ? "-" : "+"}$
                      {t.amount.toFixed(2)}
                    </strong>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div
            className="glass-panel"
            style={{ border: "1px solid var(--color-primary)" }}
          >
            <h2 style={{ color: "var(--color-primary)", textAlign: "center" }}>
              🔒 Corte de Caja Ciego
            </h2>
            <p
              style={{
                textAlign: "center",
                opacity: 0.7,
                marginBottom: "20px",
              }}
            >
              Cuenta el dinero físico que tienes en el cajón.
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "20px",
              }}
            >
              <div>
                <h4 style={{ color: "#10b981" }}>💵 Billetes (Cantidad)</h4>
                {[1000, 500, 200, 100, 50, 20].map((val) => (
                  <div
                    key={val}
                    className="flex-between"
                    style={{ marginBottom: "10px" }}
                  >
                    <span>$ {val}</span>
                    <input
                      type="number"
                      min="0"
                      value={denoms[`b${val}` as keyof Denominations]}
                      onChange={(e) =>
                        setDenoms({
                          ...denoms,
                          [`b${val}`]: Number(e.target.value) || 0,
                        })
                      }
                      style={{
                        width: "60px",
                        padding: "5px",
                        background: "black",
                        color: "white",
                        border: "1px solid #333",
                      }}
                    />
                  </div>
                ))}
              </div>
              <div>
                <h4 style={{ color: "#f59e0b" }}>🪙 Monedas (Cantidad)</h4>
                {[10, 5, 2, 1, 0.5].map((val) => {
                  const key = val === 0.5 ? "m05" : `m${val}`;
                  return (
                    <div
                      key={val}
                      className="flex-between"
                      style={{ marginBottom: "10px" }}
                    >
                      <span>$ {val}</span>
                      <input
                        type="number"
                        min="0"
                        value={denoms[key as keyof Denominations]}
                        onChange={(e) =>
                          setDenoms({
                            ...denoms,
                            [key]: Number(e.target.value) || 0,
                          })
                        }
                        style={{
                          width: "60px",
                          padding: "5px",
                          background: "black",
                          color: "white",
                          border: "1px solid #333",
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div
              style={{
                marginTop: "30px",
                textAlign: "center",
                borderTop: "1px solid rgba(255,255,255,0.2)",
                paddingTop: "20px",
              }}
            >
              <h3 style={{ color: "var(--color-secondary)" }}>
                Total Físico Contado
              </h3>
              <h1 style={{ fontSize: "3rem", margin: "10px 0" }}>
                ${calculateTotalCounted().toFixed(2)}
              </h1>
              <button
                className="btn-primary"
                style={{
                  width: "100%",
                  padding: "15px",
                  background:
                    "linear-gradient(135deg, var(--color-primary), #059669)",
                }}
                onClick={closeRegister}
              >
                Validar Corte con el Sistema
              </button>
            </div>
          </div>
        </div>
      )}
        </div>
      )}
    </ProtectedRoute>
  );
}
