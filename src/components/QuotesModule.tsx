"use client";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

export default function QuotesModule() {
  const [quotes, setQuotes] = useState<any[]>([]);
  const [selectedQuoteId, setSelectedQuoteId] = useState("");

  const fetchQuotes = async () => {
    const { data } = await supabase
      .from("quotes")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setQuotes(data);
  };

  useEffect(() => {
    fetchQuotes();
  }, []);

  const convertToSale = async (quote: any) => {
    const pass = window.prompt(
      "¿Seguro que deseas enviar esta cotización a la Caja para cobrar? (Ingresa tu PIN)",
    );
    if (!pass) return;

    const { error } = await supabase
      .from("quotes")
      .update({ status: "converted" })
      .eq("id", quote.id);
    if (error) return alert("Error: " + error.message);

    // Enviar artículos a la caja vía localStorage
    localStorage.setItem("ERIKA_RESTORE_QUOTE", JSON.stringify(quote.items));

    alert(
      `✅ Cotización de ${quote.customer_name} enviada a caja. Serás redirigido para proceder con el cobro.`,
    );
    window.location.href = "/caja";
  };

  const handleDirectCharge = async (quote: any) => {
    // 1. Guardar artículos en localStorage
    localStorage.setItem("ERIKA_RESTORE_QUOTE", JSON.stringify(quote.items));

    // 2. Guardar id del cliente si existe
    if (quote.customer_id) {
      localStorage.setItem("ERIKA_RESTORE_CUSTOMER_ID", quote.customer_id);
    } else {
      // Intentar buscar el cliente por nombre en la base de datos de clientes si no está guardado el customer_id
      try {
        const { data: customer } = await supabase
          .from("customers")
          .select("id")
          .eq("name", quote.customer_name)
          .eq("deleted", false)
          .single();
        if (customer) {
          localStorage.setItem("ERIKA_RESTORE_CUSTOMER_ID", customer.id);
        }
      } catch (e) {
        console.error("Error al buscar cliente por nombre:", e);
      }
    }

    // 3. Actualizar el estado del presupuesto a "converted" en supabase
    try {
      const { error } = await supabase
        .from("quotes")
        .update({ status: "converted" })
        .eq("id", quote.id);
      if (error) {
        console.error("Error al actualizar estado del presupuesto:", error);
      }
    } catch (e) {
      console.error("Error al conectar con la base de datos:", e);
    }

    // 4. Redirigir de inmediato al punto de venta (home page /)
    window.location.href = "/";
  };

  const printQuote = (quote: any) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const itemsHtml = quote.items
      .map(
        (i: any) => `
      <tr style="border-bottom: 1px solid #ddd;">
        <td style="padding: 8px;">${i.qty} ${i.unit}</td>
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

  const sendWhatsApp = (quote: any) => {
    const text =
      `Hola ${quote.customer_name}, te enviamos tu cotización de *Ferretería Erika* por un total de *$${quote.total.toFixed(2)}*.\n\n` +
      quote.items.map((i: any) => `- ${i.qty} ${i.unit} ${i.name}`).join("\n") +
      `\n\nVálida por 7 días. ¡Quedamos a tus órdenes!`;
    const encodedText = encodeURIComponent(text);
    window.open(`https://wa.me/?text=${encodedText}`, "_blank");
  };

  const generateInvoice = async (quote: any) => {
    // Advanced Facturama Simulation
    let mockRfc = "";

    // Attempt to auto-fill RFC from customer DB
    const { data: customer } = await supabase
      .from("customers")
      .select("rfc")
      .eq("name", quote.customer_name)
      .single();
    if (customer && customer.rfc) {
      mockRfc = customer.rfc;
    } else {
      mockRfc =
        window.prompt(
          "Ingresa el RFC del cliente para generar la factura (CFDI 4.0):",
        ) || "";
    }

    if (!mockRfc) return;

    const isConfirmed = window.confirm(
      `FACTURAMA API (Mock)\nSe timbrará una factura CFDI 4.0 para el RFC: ${mockRfc}\nTotal: $${quote.total.toFixed(2)}\n\n¿Proceder con el timbrado en el SAT?`,
    );
    if (!isConfirmed) return;

    // Simulate Network Request to Facturama API
    alert(
      "📡 [Facturama API] Generando Comprobante Fiscal...\nContactando al PAC del SAT...",
    );

    setTimeout(() => {
      alert(
        `✅ ¡Timbrado Exitoso!\nUUID: 8F${Math.random().toString(16).slice(2, 10).toUpperCase()}-XXXX-XXXX-XXXX\n\nEl PDF y XML han sido enviados por correo al cliente.`,
      );
      supabase
        .from("quotes")
        .update({ notes: "Facturada", status: "converted" })
        .eq("id", quote.id)
        .then(() => fetchQuotes());
    }, 1500);
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
      <h2 style={{ color: "var(--color-primary)", margin: 0 }}>
        📄 Gestión de Cotizaciones
      </h2>

      <div
        style={{ display: "flex", gap: "20px", flex: 1, minHeight: "500px" }}
      >
        {/* Left Side: Quotes List */}
        <div className="glass-panel" style={{ flex: 1, overflowY: "auto" }}>
          <h3
            style={{
              borderBottom: "1px solid rgba(255,255,255,0.1)",
              paddingBottom: "10px",
            }}
          >
            Presupuestos Guardados
          </h3>
          <ul style={{ listStyle: "none", padding: 0, marginTop: "10px" }}>
            {quotes.map((q) => (
              <li
                key={q.id}
                onClick={() => setSelectedQuoteId(q.id)}
                style={{
                  padding: "15px",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                  cursor: "pointer",
                  background:
                    selectedQuoteId === q.id
                      ? "rgba(59, 130, 246, 0.1)"
                      : "transparent",
                  borderLeft:
                    selectedQuoteId === q.id
                      ? "3px solid #3b82f6"
                      : "3px solid transparent",
                }}
              >
                <div className="flex-between">
                  <strong style={{ fontSize: "1.1rem" }}>
                    {q.customer_name}
                  </strong>
                  <strong style={{ color: "#3b82f6" }}>
                    ${q.total.toFixed(2)}
                  </strong>
                </div>
                <div
                  style={{
                    color: "rgba(255,255,255,0.6)",
                    fontSize: "0.9rem",
                    marginTop: "5px",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span>Cot: #{q.quote_number}</span>
                  {q.status === "pending" && (
                    <span style={{ color: "#eab308" }}>Pendiente</span>
                  )}
                  {q.status === "converted" && (
                    <span style={{ color: "var(--color-primary)" }}>
                      Pagada
                    </span>
                  )}
                  {q.status === "expired" && (
                    <span style={{ color: "#ef4444" }}>Expirada</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Right Side: Quote Details */}
        <div
          className="glass-panel"
          style={{ flex: 2, display: "flex", flexDirection: "column" }}
        >
          {selectedQuoteId ? (
            <>
              {(() => {
                const q = quotes.find((x) => x.id === selectedQuoteId);
                if (!q) return null;
                return (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      height: "100%",
                    }}
                  >
                    <div
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.1)",
                        paddingBottom: "20px",
                        marginBottom: "20px",
                      }}
                    >
                      <div className="flex-between">
                        <div>
                          <h2 style={{ color: "#3b82f6" }}>
                            Cotización #{q.quote_number}
                          </h2>
                          <p style={{ color: "rgba(255,255,255,0.6)" }}>
                            Cliente: {q.customer_name}
                          </p>
                          <p
                            style={{
                              color: "rgba(255,255,255,0.6)",
                              fontSize: "0.9rem",
                            }}
                          >
                            Fecha: {new Date(q.created_at).toLocaleString()}
                          </p>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div
                            style={{
                              fontSize: "2.5rem",
                              fontWeight: "bold",
                              color: "#eab308",
                            }}
                          >
                            ${q.total.toFixed(2)}
                          </div>
                          <div
                            style={{
                              display: "flex",
                              gap: "10px",
                              marginTop: "10px",
                              flexWrap: "wrap",
                              justifyContent: "flex-end",
                            }}
                          >
                            <button
                              className="btn-primary"
                              style={{
                                padding: "8px 15px",
                                background: "linear-gradient(135deg, #10b981, #059669)",
                                color: "white",
                                border: "none",
                                fontWeight: "bold"
                              }}
                              onClick={() => handleDirectCharge(q)}
                            >
                              💰 Cobrar de Inmediato
                            </button>

                            {q.status === "pending" && (
                              <>
                                <button
                                  className="btn-primary"
                                  style={{
                                    padding: "8px 15px",
                                    background: "#25D366",
                                    color: "white",
                                    border: "none",
                                  }}
                                  onClick={() => sendWhatsApp(q)}
                                >
                                  🟢 WhatsApp
                                </button>
                                <button
                                  className="btn-primary"
                                  style={{
                                    padding: "8px 15px",
                                    background: "#8b5cf6",
                                    color: "white",
                                    border: "none",
                                  }}
                                  onClick={() => generateInvoice(q)}
                                >
                                  🧾 Facturar
                                </button>
                                <button
                                  className="btn-primary"
                                  style={{
                                    padding: "8px 15px",
                                    background: "transparent",
                                    border: "1px solid #3b82f6",
                                    color: "#3b82f6",
                                  }}
                                  onClick={() => printQuote(q)}
                                >
                                  🖨️ PDF
                                </button>
                                <button
                                  className="btn-primary"
                                  style={{ padding: "8px 15px" }}
                                  onClick={() => convertToSale(q)}
                                >
                                  ✅ Vender
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <h3 style={{ marginBottom: "10px" }}>
                      Artículos Cotizados
                    </h3>
                    <div style={{ flex: 1, overflowY: "auto" }}>
                      <table
                        style={{ width: "100%", borderCollapse: "collapse" }}
                      >
                        <thead>
                          <tr
                            style={{
                              background: "rgba(255,255,255,0.05)",
                              textAlign: "left",
                            }}
                          >
                            <th style={{ padding: "10px" }}>Cant.</th>
                            <th style={{ padding: "10px" }}>Descripción</th>
                            <th style={{ padding: "10px", textAlign: "right" }}>
                              Precio Unit.
                            </th>
                            <th style={{ padding: "10px", textAlign: "right" }}>
                              Importe
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {q.items.map((i: any, idx: number) => (
                            <tr
                              key={idx}
                              style={{
                                borderBottom:
                                  "1px solid rgba(255,255,255,0.05)",
                              }}
                            >
                              <td style={{ padding: "10px" }}>
                                {i.qty} {i.unit}
                              </td>
                              <td style={{ padding: "10px" }}>{i.name}</td>
                              <td
                                style={{ padding: "10px", textAlign: "right" }}
                              >
                                ${i.price.toFixed(2)}
                              </td>
                              <td
                                style={{
                                  padding: "10px",
                                  textAlign: "right",
                                  fontWeight: "bold",
                                  color: "var(--color-secondary)",
                                }}
                              >
                                ${(i.price * i.qty).toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
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
              Selecciona una cotización para ver el detalle y opciones de
              impresión.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
