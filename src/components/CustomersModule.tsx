"use client";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

export default function CustomersModule() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [customerServices, setCustomerServices] = useState<any[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [newCustomer, setNewCustomer] = useState({
    name: "",
    phone: "",
    rfc: "",
    email: "",
    company_name: "",
    credit_limit: 0,
  });

  const fetchCustomers = async () => {
    const { data } = await supabase.from("customers").select("*");
    if (data) setCustomers(data);
  };

  const fetchTransactions = async (custId: string) => {
    const { data } = await supabase
      .from("credit_transactions")
      .select("*")
      .eq("customer_id", custId)
      .order("created_at", { ascending: false });
    if (data) setTransactions(data);
  };

  const fetchCustomerServices = async (customerName: string) => {
    const { data } = await supabase
      .from("services")
      .select("*")
      .eq("customer_name", customerName)
      .order("scheduled_at", { ascending: false });
    if (data) setCustomerServices(data);
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  useEffect(() => {
    if (selectedCustomerId) {
      fetchTransactions(selectedCustomerId);
      const c = customers.find(x => x.id === selectedCustomerId);
      if (c) fetchCustomerServices(c.name);
    } else {
      setTransactions([]);
      setCustomerServices([]);
    }
  }, [selectedCustomerId, customers]);

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("customers").insert([newCustomer]);
    if (error) alert("Error: " + error.message);
    else {
      setShowAddModal(false);
      setNewCustomer({
        name: "",
        phone: "",
        rfc: "",
        email: "",
        company_name: "",
        credit_limit: 0,
      });
      fetchCustomers();
    }
  };

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerId || !payAmount) return;

    const amount = parseFloat(payAmount);
    if (isNaN(amount) || amount <= 0) return alert("Cantidad inválida");

    const customer = customers.find((c) => c.id === selectedCustomerId);
    if (!customer) return;

    // Insert payment transaction
    const { error: txError } = await supabase
      .from("credit_transactions")
      .insert({
        customer_id: customer.id,
        type: "payment",
        amount: amount,
        notes: "Abono a cuenta",
      });

    if (txError) return alert("Error: " + txError.message);

    // Update balance (subtracting because payment reduces the debt)
    await supabase
      .from("customers")
      .update({
        balance: customer.balance - amount,
      })
      .eq("id", customer.id);

    alert(`✅ Abono de $${amount.toFixed(2)} registrado exitosamente.`);
    
    if (customer.phone) {
      if (confirm(`¿Deseas enviar un recibo por WhatsApp a ${customer.phone}?`)) {
        const newBalance = customer.balance - amount;
        const msg = `Hola ${customer.name}, confirmamos de recibido tu abono de $${amount.toFixed(2)}. Tu nuevo saldo es de $${newBalance.toFixed(2)}. ¡Gracias por tu pago!`;
        const waLink = `https://wa.me/${customer.phone.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`;
        window.open(waLink, "_blank");
      }
    }

    setShowPayModal(false);
    setPayAmount("");
    fetchCustomers();
    fetchTransactions(customer.id);
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
          👥 Cuentas por Cobrar (Créditos)
        </h2>
        <button className="btn-primary" onClick={() => setShowAddModal(true)}>
          + Nuevo Cliente
        </button>
      </div>

      <div
        style={{ display: "flex", gap: "20px", flex: 1, minHeight: "500px" }}
      >
        {/* Left Side: Customers List */}
        <div className="glass-panel" style={{ flex: 1, overflowY: "auto" }}>
          <h3
            style={{
              borderBottom: "1px solid rgba(255,255,255,0.1)",
              paddingBottom: "10px",
            }}
          >
            Directorio de Clientes
          </h3>
          <div style={{ margin: "10px 0" }}>
            <input 
              type="text" 
              placeholder="🔍 Buscar por nombre, teléfono o RFC..." 
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
          <ul style={{ listStyle: "none", padding: 0, marginTop: "10px" }}>
            {customers.filter(c => 
              c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
              (c.phone && c.phone.includes(searchQuery)) ||
              (c.rfc && c.rfc.toLowerCase().includes(searchQuery.toLowerCase()))
            ).map((c) => (
              <li
                key={c.id}
                onClick={() => setSelectedCustomerId(c.id)}
                style={{
                  padding: "15px",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                  cursor: "pointer",
                  background:
                    selectedCustomerId === c.id
                      ? "rgba(16, 185, 129, 0.1)"
                      : "transparent",
                  borderLeft:
                    selectedCustomerId === c.id
                      ? "3px solid var(--color-primary)"
                      : "3px solid transparent",
                }}
              >
                <div className="flex-between">
                  <strong style={{ fontSize: "1.1rem" }}>{c.name}</strong>
                  <strong
                    style={{
                      color:
                        c.balance > 0 ? "#ef4444" : "var(--color-secondary)",
                    }}
                  >
                    ${c.balance.toFixed(2)}
                  </strong>
                </div>
                <div
                  style={{
                    color: "rgba(255,255,255,0.6)",
                    fontSize: "0.9rem",
                    marginTop: "5px",
                  }}
                >
                  Límite: ${c.credit_limit} | 📱 {c.phone}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Right Side: Customer Details & Transactions */}
        <div
          className="glass-panel"
          style={{ flex: 2, display: "flex", flexDirection: "column" }}
        >
          {selectedCustomerId ? (
            <>
              {(() => {
                const c = customers.find((x) => x.id === selectedCustomerId);
                if (!c) return null;
                return (
                  <div
                    style={{
                      borderBottom: "1px solid rgba(255,255,255,0.1)",
                      paddingBottom: "20px",
                      marginBottom: "20px",
                    }}
                  >
                    <div className="flex-between">
                      <div>
                        <h2>{c.name}</h2>
                        <p style={{ color: "rgba(255,255,255,0.6)" }}>
                          📱 {c.phone} {c.email ? `| ✉️ ${c.email}` : ""}
                        </p>
                        {c.rfc && (
                          <p
                            style={{
                              color: "var(--color-primary)",
                              fontSize: "0.9rem",
                              marginTop: "5px",
                            }}
                          >
                            🏢 {c.company_name || c.name} (RFC: {c.rfc})
                          </p>
                        )}
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div
                          style={{
                            fontSize: "1.2rem",
                            color: "rgba(255,255,255,0.6)",
                          }}
                        >
                          Saldo Deudor
                        </div>
                        <div
                          style={{
                            fontSize: "2.5rem",
                            fontWeight: "bold",
                            color:
                              c.balance > 0
                                ? "#ef4444"
                                : "var(--color-secondary)",
                          }}
                        >
                          ${c.balance.toFixed(2)}
                        </div>
                      </div>
                    </div>
                    <div className="flex-between" style={{ marginTop: "15px" }}>
                      <div
                        style={{
                          background: "rgba(0,0,0,0.3)",
                          padding: "10px 15px",
                          borderRadius: "8px",
                        }}
                      >
                        Crédito Disponible:{" "}
                        <strong style={{ color: "var(--color-primary)" }}>
                          ${(c.credit_limit - c.balance).toFixed(2)}
                        </strong>{" "}
                        de ${c.credit_limit}
                      </div>
                      <div style={{ display: "flex", gap: "10px" }}>
                        <button
                          className="btn-primary"
                          style={{
                            background: "transparent",
                            border: "1px solid var(--color-primary)",
                          }}
                          onClick={() => window.print()}
                        >
                          🖨️ Imprimir Estado
                        </button>
                        <button
                          className="btn-primary"
                          onClick={() => setShowPayModal(true)}
                        >
                          💰 Registrar Abono
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <h3 style={{ marginBottom: "10px" }}>Historial de Movimientos</h3>
              <div style={{ flex: 1, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        textAlign: "left",
                      }}
                    >
                      <th style={{ padding: "10px" }}>Fecha</th>
                      <th style={{ padding: "10px" }}>Tipo</th>
                      <th style={{ padding: "10px" }}>Detalle</th>
                      <th style={{ padding: "10px", textAlign: "right" }}>
                        Monto
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => (
                      <tr
                        key={tx.id}
                        style={{
                          borderBottom: "1px solid rgba(255,255,255,0.05)",
                        }}
                      >
                        <td style={{ padding: "10px" }}>
                          {new Date(tx.created_at).toLocaleString()}
                        </td>
                        <td style={{ padding: "10px" }}>
                          {tx.type === "charge" ? (
                            <span
                              style={{
                                color: "#ef4444",
                                background: "rgba(239, 68, 68, 0.1)",
                                padding: "4px 8px",
                                borderRadius: "4px",
                              }}
                            >
                              Cargo
                            </span>
                          ) : (
                            <span
                              style={{
                                color: "var(--color-secondary)",
                                background: "rgba(16, 185, 129, 0.1)",
                                padding: "4px 8px",
                                borderRadius: "4px",
                              }}
                            >
                              Abono
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "10px" }}>{tx.notes}</td>
                        <td
                          style={{
                            padding: "10px",
                            textAlign: "right",
                            fontWeight: "bold",
                          }}
                        >
                          ${tx.amount.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    {transactions.length === 0 && (
                      <tr>
                        <td
                          colSpan={4}
                          style={{
                            padding: "20px",
                            textAlign: "center",
                            color: "rgba(255,255,255,0.5)",
                          }}
                        >
                          Sin movimientos.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Historial de Servicios */}
              <h3 style={{ marginBottom: "10px", marginTop: "20px" }}>Servicios y Trabajos Anteriores</h3>
              <div style={{ flex: 1, overflowY: "auto", maxHeight: "250px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        textAlign: "left",
                      }}
                    >
                      <th style={{ padding: "10px" }}>Fecha</th>
                      <th style={{ padding: "10px" }}>Servicio</th>
                      <th style={{ padding: "10px" }}>Técnico</th>
                      <th style={{ padding: "10px" }}>Estado</th>
                      <th style={{ padding: "10px", textAlign: "right" }}>Costo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerServices.map((srv) => (
                      <tr
                        key={srv.id}
                        style={{
                          borderBottom: "1px solid rgba(255,255,255,0.05)",
                        }}
                      >
                        <td style={{ padding: "10px" }}>
                          {new Date(srv.scheduled_at).toLocaleDateString()}
                        </td>
                        <td style={{ padding: "10px" }}>{srv.service_type}</td>
                        <td style={{ padding: "10px" }}>{srv.technician_name}</td>
                        <td style={{ padding: "10px" }}>
                          <span style={{ 
                            background: srv.status === 'completed' ? "rgba(16, 185, 129, 0.1)" : "rgba(245, 158, 11, 0.1)",
                            color: srv.status === 'completed' ? "#10b981" : "#f59e0b",
                            padding: "4px 8px", borderRadius: "4px" 
                          }}>
                            {srv.status === 'completed' ? 'Completado' : srv.status === 'pending' ? 'Pendiente' : srv.status === 'in_progress' ? 'En Proceso' : 'Cancelado'}
                          </span>
                        </td>
                        <td
                          style={{
                            padding: "10px",
                            textAlign: "right",
                            fontWeight: "bold",
                          }}
                        >
                          ${srv.cost.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    {customerServices.length === 0 && (
                      <tr>
                        <td
                          colSpan={5}
                          style={{
                            padding: "20px",
                            textAlign: "center",
                            color: "rgba(255,255,255,0.5)",
                          }}
                        >
                          No hay servicios registrados para este cliente.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "rgba(255,255,255,0.5)",
              }}
            >
              Selecciona un cliente de la lista para ver sus detalles y estados
              de cuenta.
            </div>
          )}
        </div>
      </div>

      {showAddModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            overflowY: "auto",
            padding: "20px",
          }}
        >
          <form
            onSubmit={handleAddCustomer}
            className="glass-panel"
            style={{ width: "500px", maxHeight: "90vh", overflowY: "auto" }}
          >
            <h3 style={{ marginBottom: "20px" }}>Nuevo Cliente de Crédito</h3>

            <h4
              style={{
                color: "var(--color-secondary)",
                borderBottom: "1px solid rgba(255,255,255,0.1)",
                paddingBottom: "5px",
              }}
            >
              Datos Generales
            </h4>
            <label style={{ display: "block", marginBottom: "10px" }}>
              Nombre de Contacto:
              <input
                type="text"
                required
                value={newCustomer.name}
                onChange={(e) =>
                  setNewCustomer({ ...newCustomer, name: e.target.value })
                }
                style={{
                  width: "100%",
                  padding: "10px",
                  marginTop: "5px",
                  borderRadius: "6px",
                  background: "rgba(0,0,0,0.3)",
                  color: "white",
                  border: "1px solid rgba(255,255,255,0.2)",
                }}
              />
            </label>
            <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
              <label style={{ flex: 1 }}>
                Teléfono:
                <input
                  type="text"
                  value={newCustomer.phone}
                  onChange={(e) =>
                    setNewCustomer({ ...newCustomer, phone: e.target.value })
                  }
                  style={{
                    width: "100%",
                    padding: "10px",
                    marginTop: "5px",
                    borderRadius: "6px",
                    background: "rgba(0,0,0,0.3)",
                    color: "white",
                    border: "1px solid rgba(255,255,255,0.2)",
                  }}
                />
              </label>
              <label style={{ flex: 1 }}>
                Límite de Crédito ($):
                <input
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  value={newCustomer.credit_limit}
                  onChange={(e) =>
                    setNewCustomer({
                      ...newCustomer,
                      credit_limit: parseFloat(e.target.value),
                    })
                  }
                  style={{
                    width: "100%",
                    padding: "10px",
                    marginTop: "5px",
                    borderRadius: "6px",
                    background: "rgba(0,0,0,0.3)",
                    color: "white",
                    border: "1px solid rgba(255,255,255,0.2)",
                  }}
                />
              </label>
            </div>

            <h4
              style={{
                color: "var(--color-secondary)",
                borderBottom: "1px solid rgba(255,255,255,0.1)",
                paddingBottom: "5px",
                marginTop: "20px",
              }}
            >
              Datos de Facturación (Opcional)
            </h4>
            <label style={{ display: "block", marginBottom: "10px" }}>
              Razón Social:
              <input
                type="text"
                value={newCustomer.company_name}
                onChange={(e) =>
                  setNewCustomer({
                    ...newCustomer,
                    company_name: e.target.value,
                  })
                }
                style={{
                  width: "100%",
                  padding: "10px",
                  marginTop: "5px",
                  borderRadius: "6px",
                  background: "rgba(0,0,0,0.3)",
                  color: "white",
                  border: "1px solid rgba(255,255,255,0.2)",
                }}
              />
            </label>
            <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
              <label style={{ flex: 1 }}>
                RFC:
                <input
                  type="text"
                  value={newCustomer.rfc}
                  onChange={(e) =>
                    setNewCustomer({
                      ...newCustomer,
                      rfc: e.target.value.toUpperCase(),
                    })
                  }
                  style={{
                    width: "100%",
                    padding: "10px",
                    marginTop: "5px",
                    borderRadius: "6px",
                    background: "rgba(0,0,0,0.3)",
                    color: "white",
                    border: "1px solid rgba(255,255,255,0.2)",
                  }}
                />
              </label>
              <label style={{ flex: 1 }}>
                Correo Electrónico:
                <input
                  type="email"
                  value={newCustomer.email}
                  onChange={(e) =>
                    setNewCustomer({ ...newCustomer, email: e.target.value })
                  }
                  style={{
                    width: "100%",
                    padding: "10px",
                    marginTop: "5px",
                    borderRadius: "6px",
                    background: "rgba(0,0,0,0.3)",
                    color: "white",
                    border: "1px solid rgba(255,255,255,0.2)",
                  }}
                />
              </label>
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button type="submit" className="btn-primary" style={{ flex: 1 }}>
                Guardar Cliente
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ flex: 1, background: "#ef4444" }}
                onClick={() => setShowAddModal(false)}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {showPayModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <form
            onSubmit={handlePayment}
            className="glass-panel"
            style={{ width: "400px" }}
          >
            <h3 style={{ marginBottom: "20px" }}>Registrar Abono a Cuenta</h3>
            <p>
              Se registrará un pago a favor del cliente para reducir su deuda.
            </p>
            <label style={{ display: "block", marginBottom: "20px" }}>
              Monto del Abono ($):
              <input
                type="number"
                required
                min="0.01"
                step="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px",
                  marginTop: "5px",
                  borderRadius: "6px",
                  background: "rgba(0,0,0,0.3)",
                  color: "white",
                  border: "1px solid rgba(255,255,255,0.2)",
                }}
              />
            </label>
            <div style={{ display: "flex", gap: "10px" }}>
              <button type="submit" className="btn-primary" style={{ flex: 1 }}>
                Registrar Pago
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ flex: 1, background: "#ef4444" }}
                onClick={() => setShowPayModal(false)}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
