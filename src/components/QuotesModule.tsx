"use client";
import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import { supabase } from "../lib/supabaseClient";
import { useBusinessProfile, useAuth } from "./AuthProvider";
import { cleanMexicanPhone, openWhatsAppChat, formatMexicanPhoneDisplay } from "../lib/whatsapp";
import { fetchActiveCustomers } from "../lib/customersClient";
import { saveQuote, deleteQuotes } from "../lib/quotesClient";
import { getSmartVolumeDiscount } from "./POSModule";
import { getQuoteTotalMismatch } from "../lib/quoteTotalCheck";
import { useSellQuoteToPOS } from "../hooks/useSellQuoteToPOS";

export default function QuotesModule() {
  const businessProfile = useBusinessProfile();
  const { currentUser, businessSettings } = useAuth();
  const { sellQuoteToSale, PinModal } = useSellQuoteToPOS();
  const followUpThresholdDays = businessSettings?.config?.quote_followup_days || 2;
  const [quotes, setQuotes] = useState<any[]>([]);
  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const [customers, setCustomers] = useState<any[]>([]);
  const [showOnlyFollowUp, setShowOnlyFollowUp] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("ERIKA_QUOTES_ONLY_FOLLOWUP") === "true";
  });
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [isPurging, setIsPurging] = useState(false);

  const fetchQuotes = async () => {
    const { data } = await supabase
      .from("quotes")
      .select("*")
      // "ticket" ya se excluía (es un registro de venta real, no una
      // propuesta). "cancelled" también se excluye ahora: un ticket
      // cancelado no debe seguir apareciendo mezclado en "Presupuestos
      // Guardados" -- sigue existiendo en la base para auditoría, solo ya
      // no se lista aquí.
      .neq("status", "ticket")
      .neq("status", "cancelled")
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

  // Elimina UNA cotización (botón "🗑️" en la lista). No hace falta ser
  // admin: es solo una propuesta, no un registro de venta -- el servidor
  // (api/quotes/delete) igual se niega a borrar cualquier fila que ya sea
  // status="ticket" (venta real), por si acaso.
  const handleDeleteQuote = async (quote: any) => {
    if (!window.confirm(`¿Eliminar la cotización #${quote.quote_number} de ${quote.customer_name} ($${quote.total.toFixed(2)})? Esta acción no se puede deshacer.`)) return;
    setIsDeletingId(quote.id);
    try {
      const result = await deleteQuotes([quote.id]);
      if (result.success) {
        toast.success("🗑️ Cotización eliminada.");
        if (selectedQuoteId === quote.id) setSelectedQuoteId("");
        fetchQuotes();
      } else {
        toast.error(result.error || "No se pudo eliminar.");
      }
    } finally {
      setIsDeletingId(null);
    }
  };

  // "🧹 Depurar antiguas": limpieza rápida pedida explícitamente -- junta
  // las cotizaciones "pending"/"expired" de más de PURGE_STALE_DAYS días
  // que nunca se convirtieron en venta ("ya no regresaron") y muestra una
  // vista previa antes de borrarlas todas juntas, en vez de que el cajero
  // tenga que abrirlas una por una para depurarlas a mano.
  const PURGE_STALE_DAYS = 30;
  const getPurgeCandidates = () => {
    const cutoff = Date.now() - PURGE_STALE_DAYS * 86400000;
    return quotes.filter((q) => (q.status === "pending" || q.status === "expired") && new Date(q.created_at).getTime() < cutoff);
  };

  const handlePurgeStale = async () => {
    const candidates = getPurgeCandidates();
    if (candidates.length === 0) {
      toast("No hay cotizaciones de más de " + PURGE_STALE_DAYS + " días sin convertir para depurar.", { icon: "ℹ️" });
      return;
    }
    const preview = candidates
      .slice(0, 8)
      .map((q) => `• #${q.quote_number} ${q.customer_name} — $${q.total.toFixed(2)}`)
      .join("\n");
    const more = candidates.length > 8 ? `\n… y ${candidates.length - 8} más.` : "";
    if (
      !window.confirm(
        `Se eliminarán ${candidates.length} cotización(es) pendiente(s)/expirada(s) con más de ${PURGE_STALE_DAYS} días sin convertirse en venta:\n\n${preview}${more}\n\nEsta acción no se puede deshacer. ¿Continuar?`,
      )
    ) {
      return;
    }
    setIsPurging(true);
    try {
      const result = await deleteQuotes(candidates.map((q) => q.id));
      if (result.success) {
        toast.success(`🧹 ${result.deletedCount || candidates.length} cotización(es) depurada(s).`);
        setSelectedQuoteId("");
        fetchQuotes();
      } else {
        toast.error(result.error || "No se pudo depurar.");
      }
    } finally {
      setIsPurging(false);
    }
  };

  const handleSellQuote = (quote: any) => sellQuoteToSale(quote);

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

    // Esta lista incluye tickets ya cancelados (fetchQuotes solo excluye
    // status="ticket", no "cancelled" -- ver comentario ahí), así que un
    // reenvío por WhatsApp podía mandar un ticket anulado con el mismo
    // texto que uno vigente. Mismo criterio que ya se aplicó a las 3 rutas
    // de impresión: se puede reenviar, pero nunca sin dejarlo claro.
    const cancelledNotice = quote.status === "cancelled"
      ? "🚫 *ESTE TICKET FUE CANCELADO* — no es válido como comprobante de venta.\n\n"
      : "";

    const text =
      cancelledNotice +
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
          {getPurgeCandidates().length > 0 && (
            <button
              onClick={handlePurgeStale}
              disabled={isPurging}
              title={`Elimina las cotizaciones pendientes/expiradas de más de ${PURGE_STALE_DAYS} días que nunca se convirtieron en venta`}
              style={{
                width: "100%",
                marginTop: "10px",
                padding: "8px 12px",
                background: "rgba(239, 68, 68, 0.08)",
                border: "1px dashed rgba(239, 68, 68, 0.5)",
                borderRadius: "8px",
                color: "#ef4444",
                fontSize: "0.8rem",
                cursor: isPurging ? "wait" : "pointer",
                textAlign: "left",
                opacity: isPurging ? 0.6 : 1,
              }}
            >
              {isPurging ? "⏳ Depurando..." : `🧹 Depurar antiguas sin convertir (${getPurgeCandidates().length})`}
            </button>
          )}
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
                  <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
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
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteQuote(q);
                      }}
                      disabled={isDeletingId === q.id}
                      title="Eliminar esta cotización (no se puede deshacer)"
                      style={{
                        background: "none",
                        border: "none",
                        color: "rgba(239, 68, 68, 0.6)",
                        cursor: isDeletingId === q.id ? "wait" : "pointer",
                        fontSize: "0.85rem",
                        padding: "2px 4px",
                        lineHeight: 1,
                      }}
                    >
                      {isDeletingId === q.id ? "⏳" : "🗑️"}
                    </button>
                  </span>
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
      {PinModal}
    </div>
  );
}
