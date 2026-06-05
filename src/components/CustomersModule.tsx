"use client";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

export default function CustomersModule() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [customerServices, setCustomerServices] = useState<any[]>([]);
  const [customerLayaways, setCustomerLayaways] = useState<any[]>([]);
  const [customerQuotes, setCustomerQuotes] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"credit" | "layaways" | "quotes" | "services">("credit");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
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

  const [txLimit, setTxLimit] = useState(10);
  const [servicesLimit, setServicesLimit] = useState(10);
  const [layawaysLimit, setLayawaysLimit] = useState(10);
  const [quotesLimit, setQuotesLimit] = useState(10);

  const fetchTransactions = async (custId: string, limitVal: number = txLimit) => {
    const { data } = await supabase
      .from("credit_transactions")
      .select("*")
      .eq("customer_id", custId)
      .order("created_at", { ascending: false })
      .limit(limitVal);
    if (data) setTransactions(data);
  };

  const fetchCustomerServices = async (customerName: string, limitVal: number = servicesLimit) => {
    const { data } = await supabase
      .from("services")
      .select("*")
      .eq("customer_name", customerName)
      .order("scheduled_at", { ascending: false })
      .limit(limitVal);
    if (data) setCustomerServices(data);
  };

  const fetchCustomerLayaways = async (custId: string, limitVal: number = layawaysLimit) => {
    const { data } = await supabase
      .from("layaways")
      .select("*")
      .eq("customer_id", custId)
      .order("created_at", { ascending: false })
      .limit(limitVal);
    if (data) setCustomerLayaways(data);
  };

  const fetchCustomerQuotes = async (custId: string, customerName: string, limitVal: number = quotesLimit) => {
    const { data } = await supabase
      .from("quotes")
      .select("*")
      .or(`customer_id.eq.${custId},customer_name.eq.${customerName}`)
      .order("created_at", { ascending: false })
      .limit(limitVal);
    if (data) setCustomerQuotes(data);
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  useEffect(() => {
    setTxLimit(10);
    setServicesLimit(10);
    setLayawaysLimit(10);
    setQuotesLimit(10);
  }, [selectedCustomerId]);

  useEffect(() => {
    if (selectedCustomerId) {
      const c = customers.find(x => x.id === selectedCustomerId);
      if (c) {
        fetchTransactions(selectedCustomerId, txLimit);
        fetchCustomerServices(c.name, servicesLimit);
        fetchCustomerLayaways(c.id, layawaysLimit);
        fetchCustomerQuotes(c.id, c.name, quotesLimit);
      }
    } else {
      setTransactions([]);
      setCustomerServices([]);
      setCustomerLayaways([]);
      setCustomerQuotes([]);
    }
  }, [selectedCustomerId, customers, txLimit, servicesLimit, layawaysLimit, quotesLimit]);

  // Acciones Rápidas: Apartados (Layaways)
  const handleLayawayPay = async (layaway: any) => {
    const payment = parseFloat(window.prompt(`Saldo pendiente: $${layaway.balance.toFixed(2)}\n¿Cuánto va a abonar?`) || "");
    if (isNaN(payment) || payment <= 0) return;
    if (payment > layaway.balance) return alert("El abono no puede superar el saldo pendiente.");

    const newBalance = layaway.balance - payment;
    const isCompleted = newBalance <= 0.01;

    const { error } = await supabase
      .from("layaways")
      .update({ balance: newBalance, status: isCompleted ? "completed" : "pending" })
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

    alert(`✅ Abono registrado. ${isCompleted ? "¡APARTADO LIQUIDADO, puede entregar la mercancía!" : `Saldo restante: $${newBalance.toFixed(2)}`}`);
    fetchCustomerLayaways(selectedCustomerId, layawaysLimit);
  };

  const handleLayawayCancel = async (layaway: any) => {
    if (!window.confirm("¿Seguro que deseas cancelar este apartado? La mercancía regresará al inventario físico.")) return;
    
    for (const item of layaway.items) {
      const { data: currentStock } = await supabase.from("inventory").select("stock").eq("name", item.name).single();
      if (currentStock) {
        await supabase.from("inventory").update({ stock: currentStock.stock + item.qty }).eq("name", item.name);
      }
    }

    const { error } = await supabase.from("layaways").update({ status: "cancelled" }).eq("id", layaway.id);
    if (error) return alert("Error al cancelar.");
    alert("❌ Apartado cancelado. Productos devueltos.");
    fetchCustomerLayaways(selectedCustomerId, layawaysLimit);
  };

  // Acciones Rápidas: Cotizaciones (Quotes)
  const sendQuoteWhatsApp = (quote: any) => {
    const text =
      `Hola ${quote.customer_name}, te enviamos tu cotización de *Ferretería Erika* por un total de *$${quote.total.toFixed(2)}*.\n\n` +
      quote.items.map((i: any) => `- ${i.qty} ${i.unit || 'pz'} ${i.name}`).join("\n") +
      `\n\nVálida por 7 días. ¡Quedamos a tus órdenes!`;
    const encodedText = encodeURIComponent(text);
    window.open(`https://wa.me/?text=${encodedText}`, "_blank");
  };

  const printQuotePdf = (quote: any) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const itemsHtml = quote.items
      .map(
        (i: any) => `
      <tr style="border-bottom: 1px solid #ddd;">
        <td style="padding: 8px;">${i.qty} ${i.unit || 'pz'}</td>
        <td style="padding: 8px;">${i.name}</td>
        <td style="padding: 8px;">$${i.price.toFixed(2)}</td>
        <td style="padding: 8px;">$${(i.price * i.qty).toFixed(2)}</td>
      </tr>
    `,
      )
      .join("");

    const html = `
      <html>
        <head>
          <title>Cotización - Ferretería Erika</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; color: #333; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th { text-align: left; padding: 8px; border-bottom: 2px solid #333; }
            .header { display: flex; justify-content: space-between; margin-bottom: 40px; border-bottom: 2px solid #eab308; padding-bottom: 20px; }
            .total { font-size: 1.5rem; font-weight: bold; text-align: right; margin-top: 20px; color: #eab308; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <h1 style="margin: 0; color: #eab308;">Ferretería Erika</h1>
              <p>Fecha: ${new Date(quote.created_at).toLocaleString()}</p>
            </div>
            <div style="text-align: right;">
              <h2>COTIZACIÓN #${quote.quote_number}</h2>
              <p>Cliente: <strong>${quote.customer_name}</strong></p>
            </div>
          </div>
          <table>
            <thead>
              <tr><th>Cant.</th><th>Descripción</th><th>Precio Unit.</th><th>Importe</th></tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
          <div class="total">
            TOTAL: $${quote.total.toFixed(2)}
          </div>
          <p style="text-align: center; margin-top: 50px; font-size: 0.9rem; color: #777;">
            * Los precios en esta cotización están sujetos a cambios sin previo aviso.<br>
            * Vigencia de 7 días.
          </p>
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

  const convertQuoteToSale = async (quote: any) => {
    const pass = window.prompt(
      "¿Seguro que deseas enviar esta cotización a la Caja para cobrar? (Ingresa tu PIN)",
    );
    if (!pass) return;

    const { error } = await supabase
      .from("quotes")
      .update({ status: "converted" })
      .eq("id", quote.id);
    if (error) return alert("Error: " + error.message);

    localStorage.setItem("ERIKA_RESTORE_QUOTE", JSON.stringify(quote.items));

    alert(
      `✅ Cotización de ${quote.customer_name} enviada a caja. Serás redirigido para proceder con el cobro.`,
    );
    window.location.href = "/caja";
  };

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingCustomerId) {
      const { error } = await supabase.from("customers").update(newCustomer).eq("id", editingCustomerId);
      if (error) alert("Error al actualizar: " + error.message);
      else {
        setShowAddModal(false);
        setEditingCustomerId(null);
        setNewCustomer({ name: "", phone: "", rfc: "", email: "", company_name: "", credit_limit: 0 });
        fetchCustomers();
      }
    } else {
      const { error } = await supabase.from("customers").insert([newCustomer]);
      if (error) {
        alert("Error al insertar: " + error.message);
      } else {
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

  const handleDeleteCustomer = async (custId: string, name: string) => {
    if (!window.confirm(`⚠️ ¿Seguro que deseas eliminar al cliente "${name}"?\nEsta acción es irreversible y eliminará su registro en el directorio.`)) return;

    const customer = customers.find(c => c.id === custId);
    if (customer && customer.balance > 0) {
      if (!window.confirm(`⚠️ El cliente tiene un saldo deudor de $${customer.balance.toFixed(2)}.\n¿Deseas eliminarlo de todas formas?`)) {
        return;
      }
    }

    const { error } = await supabase
      .from("customers")
      .delete()
      .eq("id", custId);

    if (error) {
      alert("Error al eliminar cliente: " + error.message);
    } else {
      alert("🗑️ Cliente eliminado exitosamente.");
      setSelectedCustomerId("");
      fetchCustomers();
    }
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
        <button className="btn-primary" onClick={() => {
          setEditingCustomerId(null);
          setNewCustomer({ name: "", phone: "", rfc: "", email: "", company_name: "", credit_limit: 0 });
          setShowAddModal(true);
        }}>
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
                      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                        <button
                          className="btn-primary"
                          style={{
                            background: "transparent",
                            border: "1px solid var(--color-primary)",
                          }}
                          onClick={() => {
                            setEditingCustomerId(c.id);
                            setNewCustomer({
                              name: c.name || "",
                              phone: c.phone || "",
                              rfc: c.rfc || "",
                              email: c.email || "",
                              company_name: c.company_name || "",
                              credit_limit: c.credit_limit || 0,
                            });
                            setShowAddModal(true);
                          }}
                        >
                          ✏️ Editar
                        </button>
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
                        <button
                          className="btn-primary"
                          style={{
                            background: "transparent",
                            border: "1px solid #ef4444",
                            color: "#ef4444"
                          }}
                          onClick={() => handleDeleteCustomer(c.id, c.name)}
                        >
                          🗑️ Eliminar
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Selector de Pestañas con Diseño Moderno */}
              <div style={{ display: "flex", gap: "10px", marginBottom: "20px", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "10px", flexWrap: "wrap" }}>
                <button
                  onClick={() => setActiveTab("credit")}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "6px",
                    border: "none",
                    background: activeTab === "credit" ? "rgba(16, 185, 129, 0.2)" : "transparent",
                    color: activeTab === "credit" ? "var(--color-primary)" : "rgba(255,255,255,0.7)",
                    cursor: "pointer",
                    fontWeight: activeTab === "credit" ? "bold" : "normal",
                    transition: "all 0.3s ease",
                  }}
                >
                  💳 Crédito y Movimientos
                </button>
                <button
                  onClick={() => setActiveTab("layaways")}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "6px",
                    border: "none",
                    background: activeTab === "layaways" ? "rgba(16, 185, 129, 0.2)" : "transparent",
                    color: activeTab === "layaways" ? "var(--color-primary)" : "rgba(255,255,255,0.7)",
                    cursor: "pointer",
                    fontWeight: activeTab === "layaways" ? "bold" : "normal",
                    transition: "all 0.3s ease",
                  }}
                >
                  📦 Apartados ({customerLayaways.length})
                </button>
                <button
                  onClick={() => setActiveTab("quotes")}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "6px",
                    border: "none",
                    background: activeTab === "quotes" ? "rgba(16, 185, 129, 0.2)" : "transparent",
                    color: activeTab === "quotes" ? "var(--color-primary)" : "rgba(255,255,255,0.7)",
                    cursor: "pointer",
                    fontWeight: activeTab === "quotes" ? "bold" : "normal",
                    transition: "all 0.3s ease",
                  }}
                >
                  📄 Cotizaciones ({customerQuotes.length})
                </button>
                <button
                  onClick={() => setActiveTab("services")}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "6px",
                    border: "none",
                    background: activeTab === "services" ? "rgba(16, 185, 129, 0.2)" : "transparent",
                    color: activeTab === "services" ? "var(--color-primary)" : "rgba(255,255,255,0.7)",
                    cursor: "pointer",
                    fontWeight: activeTab === "services" ? "bold" : "normal",
                    transition: "all 0.3s ease",
                  }}
                >
                  🛠️ Servicios ({customerServices.length})
                </button>
              </div>

              {/* Contenido de la pestaña activa */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                {activeTab === "credit" && (
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
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
                      {transactions.length >= txLimit && (
                        <div style={{ textAlign: "center", marginTop: "15px", marginBottom: "15px" }}>
                          <button
                            className="btn-primary"
                            style={{ padding: "6px 12px", background: "transparent", border: "1px solid var(--color-primary)", fontSize: "0.85rem" }}
                            onClick={() => setTxLimit(prev => prev + 10)}
                          >
                            ➕ Cargar más movimientos
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === "layaways" && (
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                    <h3 style={{ marginBottom: "10px" }}>Apartados Guardados</h3>
                    <div style={{ flex: 1, overflowY: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "rgba(255,255,255,0.05)", textAlign: "left" }}>
                            <th style={{ padding: "10px" }}>Fecha / Vence</th>
                            <th style={{ padding: "10px" }}>Artículos</th>
                            <th style={{ padding: "10px" }}>Total</th>
                            <th style={{ padding: "10px" }}>Abonado</th>
                            <th style={{ padding: "10px" }}>Restante</th>
                            <th style={{ padding: "10px", textAlign: "center" }}>Estado</th>
                            <th style={{ padding: "10px", textAlign: "center" }}>Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {customerLayaways.map((l) => (
                            <tr key={l.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                              <td style={{ padding: "10px" }}>
                                <div>{new Date(l.created_at).toLocaleDateString()}</div>
                                <div style={{ fontSize: "0.8rem", color: l.status === "pending" && new Date(l.due_date) < new Date() ? "#ef4444" : "rgba(255,255,255,0.5)" }}>
                                  Vence: {new Date(l.due_date).toLocaleDateString()}
                                </div>
                              </td>
                              <td style={{ padding: "10px", fontSize: "0.85rem" }}>
                                {Array.isArray(l.items) && l.items.map((i: any, idx: number) => (
                                  <div key={idx}>{i.qty}x {i.name}</div>
                                ))}
                              </td>
                              <td style={{ padding: "10px", fontWeight: "bold" }}>${l.total_amount.toFixed(2)}</td>
                              <td style={{ padding: "10px" }}>${(l.total_amount - l.balance).toFixed(2)}</td>
                              <td style={{ padding: "10px", fontWeight: "bold", color: l.balance > 0 ? "var(--color-secondary)" : "#10b981" }}>
                                ${l.balance.toFixed(2)}
                              </td>
                              <td style={{ padding: "10px", textAlign: "center" }}>
                                <span style={{
                                  background: l.status === "completed" ? "rgba(16, 185, 129, 0.1)" : l.status === "cancelled" ? "rgba(239, 68, 68, 0.1)" : "rgba(245, 158, 11, 0.1)",
                                  color: l.status === "completed" ? "#10b981" : l.status === "cancelled" ? "#ef4444" : "#f59e0b",
                                  padding: "4px 8px",
                                  borderRadius: "4px"
                                }}>
                                  {l.status === "completed" ? "Liquidado" : l.status === "cancelled" ? "Cancelado" : "Pendiente"}
                                </span>
                              </td>
                              <td style={{ padding: "10px", textAlign: "center" }}>
                                <div style={{ display: "flex", gap: "5px", justifyContent: "center" }}>
                                  {l.status === "pending" && (
                                    <>
                                      <button
                                        className="btn-primary"
                                        style={{ padding: "3px 6px", fontSize: "0.75rem", background: "transparent", border: "1px solid var(--color-secondary)", color: "var(--color-secondary)" }}
                                        onClick={() => handleLayawayPay(l)}
                                      >
                                        💵 Abono
                                      </button>
                                      <button
                                        className="btn-primary"
                                        style={{ padding: "3px 6px", fontSize: "0.75rem", background: "transparent", border: "1px solid #ef4444", color: "#ef4444" }}
                                        onClick={() => handleLayawayCancel(l)}
                                      >
                                        ❌ Cancelar
                                      </button>
                                    </>
                                  )}
                                  {l.status === "completed" && <span style={{ color: "#10b981", fontSize: "0.8rem", fontWeight: "bold" }}>✅ Pagado</span>}
                                  {l.status === "cancelled" && <span style={{ color: "#ef4444", fontSize: "0.8rem", fontWeight: "bold" }}>🚫 Cancelado</span>}
                                </div>
                              </td>
                            </tr>
                          ))}
                          {customerLayaways.length === 0 && (
                            <tr>
                              <td colSpan={7} style={{ padding: "20px", textAlign: "center", color: "rgba(255,255,255,0.5)" }}>
                                No hay apartados registrados para este cliente.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      {customerLayaways.length >= layawaysLimit && (
                        <div style={{ textAlign: "center", marginTop: "15px", marginBottom: "15px" }}>
                          <button
                            className="btn-primary"
                            style={{ padding: "6px 12px", background: "transparent", border: "1px solid var(--color-primary)", fontSize: "0.85rem" }}
                            onClick={() => setLayawaysLimit(prev => prev + 10)}
                          >
                            ➕ Cargar más apartados
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === "quotes" && (
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                    <h3 style={{ marginBottom: "10px" }}>Cotizaciones Guardadas</h3>
                    <div style={{ flex: 1, overflowY: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "rgba(255,255,255,0.05)", textAlign: "left" }}>
                            <th style={{ padding: "10px" }}>Cot. #</th>
                            <th style={{ padding: "10px" }}>Fecha</th>
                            <th style={{ padding: "10px" }}>Artículos</th>
                            <th style={{ padding: "10px" }}>Total</th>
                            <th style={{ padding: "10px", textAlign: "center" }}>Estado</th>
                            <th style={{ padding: "10px", textAlign: "center" }}>Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {customerQuotes.map((q) => (
                            <tr key={q.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                              <td style={{ padding: "10px", fontWeight: "bold" }}>#{q.quote_number}</td>
                              <td style={{ padding: "10px" }}>{new Date(q.created_at).toLocaleDateString()}</td>
                              <td style={{ padding: "10px", fontSize: "0.85rem" }}>
                                {Array.isArray(q.items) && q.items.map((i: any, idx: number) => (
                                  <div key={idx}>{i.qty} {i.unit || 'pz'} - {i.name}</div>
                                ))}
                              </td>
                              <td style={{ padding: "10px", fontWeight: "bold", color: "#3b82f6" }}>${q.total.toFixed(2)}</td>
                              <td style={{ padding: "10px", textAlign: "center" }}>
                                <span style={{
                                  background: q.status === "converted" ? "rgba(16, 185, 129, 0.1)" : q.status === "expired" ? "rgba(239, 68, 68, 0.1)" : "rgba(245, 158, 11, 0.1)",
                                  color: q.status === "converted" ? "#10b981" : q.status === "expired" ? "#ef4444" : "#f59e0b",
                                  padding: "4px 8px",
                                  borderRadius: "4px"
                                }}>
                                  {q.status === "converted" ? "Vendido" : q.status === "expired" ? "Expirado" : "Pendiente"}
                                </span>
                              </td>
                              <td style={{ padding: "10px", textAlign: "center" }}>
                                <div style={{ display: "flex", gap: "5px", justifyContent: "center" }}>
                                  {q.status === "pending" && (
                                    <>
                                      <button
                                        className="btn-primary"
                                        style={{ padding: "3px 6px", fontSize: "0.75rem", background: "#25D366", color: "white", border: "none" }}
                                        onClick={() => sendQuoteWhatsApp(q)}
                                      >
                                        🟢 WA
                                      </button>
                                      <button
                                        className="btn-primary"
                                        style={{ padding: "3px 6px", fontSize: "0.75rem", background: "transparent", border: "1px solid #3b82f6", color: "#3b82f6" }}
                                        onClick={() => printQuotePdf(q)}
                                      >
                                        🖨️ PDF
                                      </button>
                                      <button
                                        className="btn-primary"
                                        style={{ padding: "3px 6px", fontSize: "0.75rem" }}
                                        onClick={() => convertQuoteToSale(q)}
                                      >
                                        ✅ Vender
                                      </button>
                                    </>
                                  )}
                                  {q.status === "converted" && <span style={{ color: "#10b981", fontSize: "0.8rem", fontWeight: "bold" }}>Pagado</span>}
                                  {q.status === "expired" && <span style={{ color: "#ef4444", fontSize: "0.8rem", fontWeight: "bold" }}>Expirado</span>}
                                </div>
                              </td>
                            </tr>
                          ))}
                          {customerQuotes.length === 0 && (
                            <tr>
                              <td colSpan={6} style={{ padding: "20px", textAlign: "center", color: "rgba(255,255,255,0.5)" }}>
                                No hay cotizaciones registradas para este cliente.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      {customerQuotes.length >= quotesLimit && (
                        <div style={{ textAlign: "center", marginTop: "15px", marginBottom: "15px" }}>
                          <button
                            className="btn-primary"
                            style={{ padding: "6px 12px", background: "transparent", border: "1px solid var(--color-primary)", fontSize: "0.85rem" }}
                            onClick={() => setQuotesLimit(prev => prev + 10)}
                          >
                            ➕ Cargar más cotizaciones
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === "services" && (
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                    <h3 style={{ marginBottom: "10px" }}>Servicios y Trabajos Anteriores</h3>
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
                      {customerServices.length >= servicesLimit && (
                        <div style={{ textAlign: "center", marginTop: "15px", marginBottom: "15px" }}>
                          <button
                            className="btn-primary"
                            style={{ padding: "6px 12px", background: "transparent", border: "1px solid var(--color-primary)", fontSize: "0.85rem" }}
                            onClick={() => setServicesLimit(prev => prev + 10)}
                          >
                            ➕ Cargar más servicios
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
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
            <h3 style={{ marginBottom: "20px" }}>{editingCustomerId ? "Editar Cliente" : "Nuevo Cliente de Crédito"}</h3>

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
                {editingCustomerId ? "Guardar Cambios" : "Guardar Cliente"}
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ flex: 1, background: "#ef4444" }}
                onClick={() => {
                  setShowAddModal(false);
                  setEditingCustomerId(null);
                }}
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
