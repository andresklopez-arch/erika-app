"use client";
import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import { supabase } from "../lib/supabaseClient";
import { useBusinessProfile, useAuth } from "./AuthProvider";
import { cleanMexicanPhone, openWhatsAppChat, formatMexicanPhoneDisplay } from "../lib/whatsapp";
import { fetchActiveCustomers } from "../lib/customersClient";
import { saveQuote } from "../lib/quotesClient";
import { getSmartVolumeDiscount } from "./POSModule";
import { getQuoteTotalMismatch } from "../lib/quoteTotalCheck";

export default function QuotesModule() {
  const businessProfile = useBusinessProfile();
  const { currentUser, businessSettings } = useAuth();
  const followUpThresholdDays = businessSettings?.config?.quote_followup_days || 2;
  const [quotes, setQuotes] = useState<any[]>([]);
  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const [customers, setCustomers] = useState<any[]>([]);
  const [showOnlyFollowUp, setShowOnlyFollowUp] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("ERIKA_QUOTES_ONLY_FOLLOWUP") === "true";
  });

  const fetchQuotes = async () => {
    const { data } = await supabase
      .from("quotes")
      .select("*")
      .neq("status", "ticket")
      .order("created_at", { ascending: false });
    if (data) setQuotes(data);
  };

  const fetchCustomers = async () => {
    const { data, error } = await fetchActiveCustomers({
      warn: businessSettings?.config?.customer_list_warn_threshold,
      danger: businessSettings?.config?.customer_list_danger_threshold,
    });
    if (!error && data) setCustomers(data);
  };

  useEffect(() => {
    fetchQuotes();
    fetchCustomers();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("ERIKA_QUOTES_ONLY_FOLLOWUP", String(showOnlyFollowUp));
    } catch (e) {}
  }, [showOnlyFollowUp]);

  // Resuelve el telefono de una cotizacion sin volver a consultar la base:
  // primero el snapshot guardado en la cotizacion (customer_phone), luego
  // el cliente enlazado por customer_id, y por ultimo un cliente con el
  // mismo nombre (para cotizaciones viejas sin customer_id).
  const resolveQuotePhone = (quote: any): string | null => {
    if (quote.customer_phone) return quote.customer_phone;
    const byId = quote.customer_id && customers.find((c) => c.id === quote.customer_id);
    if (byId?.phone) return byId.phone;
    const byName = customers.find((c) => c.name === quote.customer_name);
    return byName?.phone || null;
  };

  // Un presupuesto enviado que sigue "Pendiente" pasados unos dias
  // probablemente necesita seguimiento manual. Compartido por la lista y
  // el panel de detalle para no calcular esto dos veces con logica distinta.
  const getFollowUpInfo = (quote: any) => {
    const daysSinceSent = quote.whatsapp_sent_at
      ? Math.floor((Date.now() - new Date(quote.whatsapp_sent_at).getTime()) / 86400000)
      : null;
    const needsFollowUp = quote.status === "pending" && daysSinceSent !== null && daysSinceSent >= followUpThresholdDays;
    return { daysSinceSent, needsFollowUp };
  };

  // Verifica el PIN capturado contra el usuario actual o la tabla de
  // personal. Devuelve true si es válido. Compartida por convertToSale y
  // handleDirectCharge — antes handleDirectCharge no pedía NINGÚN PIN,
  // evadiendo por completo el control que sí protege al botón "Vender".
  const verifyStaffPin = async (pass: string) => {
    // Siempre se verifica del lado del servidor (Service Role Key). Un
    // atajo previo aceptaba el PIN si coincidía con `currentUser.pin` (que
    // vive sin firma en localStorage) sin llamar al servidor — cualquiera
    // podía forjar ese valor en localStorage y saltarse el PIN por completo.
    try {
      const res = await fetch("/api/auth/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pass }),
      });
      const json = await res.json();
      return res.ok && json.valid === true;
    } catch (e) {
      console.error("Error al verificar PIN:", e);
      return false;
    }
  };

  const handleSellQuote = async (quote: any) => {
    const pass = window.prompt(
      `¿Deseas enviar la Cotización #${quote.quote_number} a Caja para cobrar e imprimir ticket? (Ingresa tu PIN):`
    );
    if (!pass) return;
    if (!(await verifyStaffPin(pass))) {
      return alert("❌ PIN incorrecto. Operación cancelada.");
    }

    localStorage.setItem("ERIKA_PRINTER_CONNECTED", "true");
    localStorage.setItem("ERIKA_RESTORE_QUOTE", JSON.stringify(quote.items));
    localStorage.setItem("ERIKA_RESTORE_QUOTE_ID", quote.id);
    // Antes solo se restauraban los items (precios base, sin ajuste) --
    // si la cotización se guardó con IVA activado y/o un % de descuento o
    // aumento sobre el total del ticket, ese ajuste se perdía por completo
    // al mandarla a caja: se recobraba un total distinto (más bajo, sin el
    // aumento) al que realmente se le había cotizado al cliente. Ver
    // restoreQuote() en POSModule.tsx.
    localStorage.setItem("ERIKA_RESTORE_QUOTE_DISCOUNT_PCT", String(quote.discount_pct ?? 0));
    localStorage.setItem("ERIKA_RESTORE_QUOTE_APPLY_IVA", String(quote.apply_iva ?? false));
    if (quote.customer_id) {
      localStorage.setItem("ERIKA_RESTORE_CUSTOMER_ID", quote.customer_id);
    } else if (quote.customer_name) {
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
    localStorage.setItem("ERIKA_AUTO_OPEN_CHECKOUT", "true");

    toast.success(`Cotización #${quote.quote_number} enviada a caja para cobro.`);
    window.location.href = "/caja";
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
          <title>Cotización - ${businessProfile.name}</title>
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
              <h1 style="margin: 0; color: #eab308;">${businessProfile.name}</h1>
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

  const sendWhatsApp = async (quote: any) => {
    // Antes esto abría `wa.me/?text=...` SIN número de teléfono, lo cual en
    // WhatsApp Web/Desktop suele mostrar un error de "número inválido" en
    // vez de abrir el chat del cliente. resolveQuotePhone busca primero el
    // snapshot guardado en la cotización, luego el cliente enlazado.
    let phone = resolveQuotePhone(quote) || "";
    if (!phone) {
      phone =
        window.prompt(
          `No se encontró un teléfono guardado para ${quote.customer_name}. Ingresa el número de WhatsApp a 10 dígitos:`,
        ) || "";
    }
    if (!phone) return;

    const cleanPhone = cleanMexicanPhone(phone);
    if (!cleanPhone) {
      return alert("❌ Número inválido. Por favor ingresa un número de 10 dígitos (ej: 5512345678).");
    }

    const text =
      `Hola ${quote.customer_name}, te enviamos tu cotización de *${businessProfile.name}* por un total de *$${quote.total.toFixed(2)}*.\n\n` +
      quote.items.map((i: any) => `- ${i.qty} ${i.unit} ${i.name}`).join("\n") +
      `\n\nVálida por 7 días. ¡Quedamos a tus órdenes!`;

    if (openWhatsAppChat(cleanPhone, text)) {
      // Best-effort: si la columna whatsapp_sent_at todavia no existe en
      // esta base (falta correr la migracion), simplemente no se guarda.
      const { error } = await saveQuote({ id: quote.id, fields: { whatsapp_sent_at: new Date().toISOString() } });
      if (!error) fetchQuotes();
    }
  };

  // La conexión real con el proveedor de timbrado (Facturama) aún no está
  // configurada. Antes esta función simulaba un timbrado exitoso (RFC
  // "verificado" contra un mock, UUID inventado con Math.random(), y
  // marcaba la cotización como "Facturada"/"converted") sin generar ningún
  // CFDI real ni enviar nada por correo. Mientras no exista la integración
  // real, se avisa claramente en vez de fingir que funciona.
  const generateInvoice = async (_quote: any) => {
    alert(
      "⚠️ La facturación electrónica todavía no está disponible: falta configurar la conexión con el proveedor de timbrado (Facturama). Esta función está pendiente de activación.",
    );
  };

  // El botón de WhatsApp solo vive en el panel de detalle (hay que
  // seleccionar la cotización primero). Este acceso directo reenvía la
  // última sin que el cajero tenga que volver a buscarla en la lista.
  const lastSentQuote = quotes
    .filter((q) => q.whatsapp_sent_at)
    .sort((a, b) => new Date(b.whatsapp_sent_at).getTime() - new Date(a.whatsapp_sent_at).getTime())[0];

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
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: "1px solid rgba(255,255,255,0.1)",
              paddingBottom: "10px",
            }}
          >
            <h3 style={{ margin: 0 }}>Presupuestos Guardados</h3>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "0.8rem",
                color: "rgba(255,255,255,0.7)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={showOnlyFollowUp}
                onChange={(e) => setShowOnlyFollowUp(e.target.checked)}
              />
              ⏰ solo seguimiento
            </label>
          </div>
          {lastSentQuote && (
            <button
              onClick={() => sendWhatsApp(lastSentQuote)}
              style={{
                width: "100%",
                marginTop: "10px",
                padding: "8px 12px",
                background: "rgba(34, 197, 94, 0.1)",
                border: "1px dashed rgba(34, 197, 94, 0.5)",
                borderRadius: "8px",
                color: "inherit",
                fontSize: "0.8rem",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              🔁 Reenviar por WhatsApp a {lastSentQuote.customer_name} (última cotización enviada)
            </button>
          )}
          <ul style={{ listStyle: "none", padding: 0, marginTop: "10px" }}>
            {[...quotes]
              .filter((q) => !showOnlyFollowUp || getFollowUpInfo(q).needsFollowUp)
              .sort((a, b) => {
                // Los que necesitan seguimiento van primero; dentro de cada
                // grupo se conserva el orden original (mas reciente primero),
                // ya que Array.sort es estable.
                const aFollowUp = getFollowUpInfo(a).needsFollowUp;
                const bFollowUp = getFollowUpInfo(b).needsFollowUp;
                if (aFollowUp === bFollowUp) return 0;
                return aFollowUp ? -1 : 1;
              })
              .map((q) => {
              const { daysSinceSent, needsFollowUp } = getFollowUpInfo(q);
              return (
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
                    {!resolveQuotePhone(q) && (
                      <span
                        title="Sin teléfono guardado: se pedirá al enviar por WhatsApp"
                        style={{ marginLeft: "6px", fontSize: "0.75rem", color: "#ef4444" }}
                      >
                        📵 sin teléfono
                      </span>
                    )}
                    {q.whatsapp_sent_at && needsFollowUp && (
                      <span
                        title={`Enviado por WhatsApp el ${new Date(q.whatsapp_sent_at).toLocaleString()} y sigue sin convertirse en venta. Considera darle seguimiento.`}
                        style={{ marginLeft: "6px", fontSize: "0.75rem", color: "#f97316" }}
                      >
                        ⏰ sin respuesta hace {daysSinceSent}d
                      </span>
                    )}
                    {q.whatsapp_sent_at && !needsFollowUp && (
                      <span
                        title={`Enviado por WhatsApp: ${new Date(q.whatsapp_sent_at).toLocaleString()}`}
                        style={{ marginLeft: "6px", fontSize: "0.75rem", color: "#22c55e" }}
                      >
                        ✓ enviado
                      </span>
                    )}
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
              );
            })}
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
                          {resolveQuotePhone(q) && (
                            <p
                              style={{
                                color: "rgba(255,255,255,0.6)",
                                fontSize: "0.9rem",
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                              }}
                            >
                              Tel: {formatMexicanPhoneDisplay(resolveQuotePhone(q)!)}
                              <button
                                onClick={() => {
                                  const phone = resolveQuotePhone(q);
                                  if (!phone) return;
                                  navigator.clipboard.writeText(phone);
                                  toast.success("Teléfono copiado");
                                }}
                                title="Copiar teléfono"
                                style={{
                                  background: "transparent",
                                  border: "1px solid rgba(255,255,255,0.2)",
                                  borderRadius: "4px",
                                  color: "inherit",
                                  fontSize: "0.75rem",
                                  padding: "1px 6px",
                                  cursor: "pointer",
                                }}
                              >
                                📋 copiar
                              </button>
                            </p>
                          )}
                          <p
                            style={{
                              color: "rgba(255,255,255,0.6)",
                              fontSize: "0.9rem",
                            }}
                          >
                            Fecha: {new Date(q.created_at).toLocaleString()}
                          </p>
                          {(() => {
                            const { daysSinceSent, needsFollowUp } = getFollowUpInfo(q);
                            if (!needsFollowUp) return null;
                            return (
                              <p style={{ color: "#f97316", fontSize: "0.85rem", fontWeight: "bold" }}>
                                ⏰ Enviado por WhatsApp hace {daysSinceSent}d y sigue sin convertirse en venta.
                              </p>
                            );
                          })()}
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
                              alignItems: "center"
                            }}
                          >
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
                                  style={{
                                    padding: "8px 15px",
                                    background: "linear-gradient(135deg, #10b981, #059669)",
                                    color: "white",
                                    border: "none",
                                    fontWeight: "bold"
                                  }}
                                  onClick={() => handleSellQuote(q)}
                                >
                                  💰 Vender y Cobrar Ticket
                                </button>
                              </>
                            )}
                            {q.status === "converted" && (
                              <span style={{ color: "#10b981", fontWeight: "bold", padding: "6px 12px", background: "rgba(16,185,129,0.1)", borderRadius: "6px" }}>
                                ✅ Cotización Vendida / Pagada
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {(() => {
                      const ivaRate = businessSettings?.config?.iva_rate ?? 0.16;
                      const { expectedTotal, storedTotal, mismatch } = getQuoteTotalMismatch(q, ivaRate);
                      const discountPct = q.discount_pct || 0;
                      const applyIva = Boolean(q.apply_iva);
                      return (
                        <div
                          style={{
                            marginBottom: "15px",
                            padding: "10px 14px",
                            borderRadius: "8px",
                            fontSize: "0.85rem",
                            background: mismatch ? "rgba(239,68,68,0.1)" : "rgba(255,255,255,0.03)",
                            border: mismatch ? "1px solid rgba(239,68,68,0.4)" : "1px solid rgba(255,255,255,0.08)",
                            color: mismatch ? "#f87171" : "rgba(255,255,255,0.7)",
                          }}
                        >
                          {mismatch ? (
                            <strong>
                              ⚠️ El total guardado (${storedTotal.toFixed(2)}) no coincide con lo que suman los artículos + ajustes (${expectedTotal.toFixed(2)}).
                              {q.status === "pending" && " Si se cobra ahora, el sistema cobrará el monto correcto (recalculado), no el que se muestra arriba."}
                            </strong>
                          ) : (
                            <span>
                              {discountPct !== 0 && `${discountPct < 0 ? "Aumento" : "Descuento"}: ${Math.abs(discountPct)}% · `}
                              {applyIva && "IVA incluido · "}
                              Total verificado (coincide con artículos + ajustes).
                            </span>
                          )}
                        </div>
                      );
                    })()}

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
                              <td style={{ padding: "10px" }}>
                                <span>{i.name}</span>
                                {(() => {
                                  let smartRules = [];
                                  try {
                                    smartRules = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("ERIKA_SMART_VOLUME_RULES") || "[]") : [];
                                  } catch {}
                                  const smartDisc = getSmartVolumeDiscount(i, smartRules);
                                  const effectiveDisc = Math.max(i.discountPct || 0, smartDisc.discountPct || 0);
                                  if (effectiveDisc > 0) {
                                    return (
                                      <span
                                        style={{
                                          marginLeft: "8px",
                                          background: "rgba(16, 185, 129, 0.15)",
                                          border: "1px solid rgba(16, 185, 129, 0.3)",
                                          color: "#34d399",
                                          padding: "1px 6px",
                                          borderRadius: "4px",
                                          fontSize: "0.72rem",
                                          fontWeight: "bold"
                                        }}
                                      >
                                        ⚡ -{effectiveDisc}% Vol.
                                      </span>
                                    );
                                  }
                                  return null;
                                })()}
                              </td>
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
