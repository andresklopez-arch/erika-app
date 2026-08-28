"use client";
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import toast from "react-hot-toast";
import { CustomerSchema } from "../lib/schemas";
import { useBusinessProfile, useAuth } from "./AuthProvider";
import { saveCustomer, deleteCustomer } from "../lib/customersClient";
import { payLayaway, cancelLayaway } from "../lib/layawaysClient";
import { reduceInventoryStock } from "../lib/inventoryClient";
import { printEscPosBytes, sanitizeForThermal } from "../utils/bluetoothPrinter";
import { LoggerService } from "../services/loggerService";
import { showPrintFailureToast } from "../lib/printFailureToast";
import { getQuoteTotalMismatch } from "../lib/quoteTotalCheck";
import { useSellQuoteToPOS } from "../hooks/useSellQuoteToPOS";

export default function CustomersModule() {
  const businessProfile = useBusinessProfile();
  const { currentUser } = useAuth();
  const { sellQuoteToSale, PinModal: SellQuotePinModal } = useSellQuoteToPOS();
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

  // States for Undo Toast
  const [showUndoToast, setShowUndoToast] = useState(false);
  const [undoCustomerId, setUndoCustomerId] = useState<string | null>(null);
  const [undoCustomerName, setUndoCustomerName] = useState("");

  const [limit, setLimit] = useState(20);
  const [hasMore, setHasMore] = useState(true);
  // Evita que una búsqueda más lenta y ya obsoleta sobrescriba los resultados
  // de una búsqueda más reciente (p. ej. escribir "Juan" y luego "Jose" rápido).
  const latestSearchRequestId = useRef(0);

  const fetchCustomers = async (currentLimit = limit, searchVal = searchQuery) => {
    const requestId = ++latestSearchRequestId.current;
    let query = supabase
      .from("customers")
      .select("*")
      .or("deleted.is.null,deleted.eq.false");

    const cleanSearch = (searchVal || "").trim();
    if (cleanSearch !== "") {
      query = query.or(`name.ilike.%${cleanSearch}%,phone.ilike.%${cleanSearch}%,rfc.ilike.%${cleanSearch}%`);
    }

    let { data, error } = await query
      .order("name", { ascending: true })
      .limit(currentLimit + 1);

    if (error) {
      console.warn("Fallo el filtro de base de datos 'deleted' en CustomersModule, usando fallback local:", error.message);
      const fallback = await supabase.from("customers").select("*");
      if (fallback.error) {
        console.error("Error al cargar clientes (fallback):", fallback.error);
        toast.error(`Error de Base de Datos al cargar clientes: ${fallback.error.message}`);
      } else if (fallback.data) {
        let filtered = fallback.data.filter((c: any) => c.deleted !== true);
        if (cleanSearch !== "") {
          const lower = cleanSearch.toLowerCase();
          filtered = filtered.filter((c: any) => 
            c.name.toLowerCase().includes(lower) ||
            (c.phone && c.phone.includes(lower)) ||
            (c.rfc && c.rfc.toLowerCase().includes(lower))
          );
        }
        data = filtered;
        error = null;
      }
    }
    if (requestId !== latestSearchRequestId.current) {
      // Llegó una respuesta de una búsqueda vieja después de una más nueva; se descarta.
      return;
    }

    if (!error && data) {
      const hasMoreRows = data.length > currentLimit;
      const sliceData = hasMoreRows ? data.slice(0, currentLimit) : data;
      setHasMore(hasMoreRows);

      const validated = sliceData.map((item: any) => {
        const result = CustomerSchema.safeParse(item);
        if (!result.success) {
          console.error("Error de validacion Zod en cliente:", result.error);
          return {
            id: item.id || String(Math.random()),
            name: item.name || "Cliente Invalido",
            phone: item.phone || "",
            rfc: item.rfc || "",
            email: item.email || "",
            company_name: item.company_name || "",
            credit_limit: Number(item.credit_limit) || 0,
            balance: Number(item.balance) || 0,
            points: Number(item.points) || 0,
            deleted: item.deleted === true
          };
        }
        return result.data;
      });
      setCustomers(validated);
    }
  };

  const handleLoadMore = () => {
    const newLimit = limit + 20;
    setLimit(newLimit);
    fetchCustomers(newLimit);
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
    fetchCustomers(limit, searchQuery);
  }, [limit, searchQuery]);

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

    const { error, newBalance: resultBalance, isCompleted } = await payLayaway(layaway.id, payment);
    if (error) return alert("Error al registrar el abono: " + error.message);
    const newBalance = resultBalance as number;

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
            <div class="center bold" style="font-size: 16px; margin-bottom: 5px;">${businessProfile.name}</div>
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
    
    const failedItems: string[] = [];
    for (const item of layaway.items) {
      // Buscar primero por código (SKU) si el renglón lo trae — más
      // estable que el nombre, que puede haber cambiado desde que se creó
      // el apartado (antes esto se buscaba solo por nombre y fallaba en
      // silencio, dejando la restauración de ese artículo sin ocurrir).
      let matchQuery = item.code
        ? supabase.from("inventory").select("id, stock").eq("code", item.code)
        : supabase.from("inventory").select("id, stock").eq("name", item.name);
      const { data: currentStock, error: findError } = await matchQuery.single();
      if (findError || !currentStock) {
        failedItems.push(item.name);
        continue;
      }
      const { error: updateError } = await reduceInventoryStock([{ id: currentStock.id, qty: -item.qty }], "cancellation", `LAY-CANCEL-${layaway.id}`);
      if (updateError) failedItems.push(item.name);
    }

    const { error } = await cancelLayaway(layaway.id);
    if (error) return alert("Error al cancelar.");
    if (failedItems.length > 0) {
      alert(`⚠️ Apartado cancelado, pero NO se pudo restaurar el stock de: ${failedItems.join(", ")}. Ajusta el inventario manualmente.`);
    } else {
      alert("❌ Apartado cancelado. Productos devueltos.");
    }
    fetchCustomerLayaways(selectedCustomerId, layawaysLimit);
  };

  // Acciones Rápidas: Cotizaciones (Quotes)
  const sendQuoteWhatsApp = (quote: any) => {
    const text =
      `Hola ${quote.customer_name}, te enviamos tu cotización de *${businessProfile.name}* por un total de *$${quote.total.toFixed(2)}*.\n\n` +
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

  const printThermalTicketDirect = (html: string) => {
    try {
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0px";
      iframe.style.height = "0px";
      iframe.style.border = "none";
      document.body.appendChild(iframe);

      const iframeDoc = iframe.contentWindow?.document;
      if (iframeDoc) {
        iframeDoc.open();
        iframeDoc.write(html);
        iframeDoc.close();
        setTimeout(() => {
          try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
          } catch (e) {
            console.error("Iframe print error:", e);
          } finally {
            setTimeout(() => {
              if (document.body.contains(iframe)) {
                document.body.removeChild(iframe);
              }
            }, 2000);
          }
        }, 300);
        return;
      }
    } catch (e) {
      console.warn("Fallo iframe print, usando fallback:", e);
    }

    const ticketWindow = window.open("", "_blank", "width=320,height=600");
    if (ticketWindow) {
      ticketWindow.document.write(html);
      ticketWindow.document.close();
      ticketWindow.focus();
      setTimeout(() => {
        ticketWindow.print();
        ticketWindow.close();
      }, 500);
    } else {
      alert("⚠️ Por favor permite las ventanas emergentes en tu navegador para imprimir el ticket.");
    }
  };

  const printCustomerAccountStatement = async (customer: any) => {
    if (!customer) return;

    let currentTxs = transactions;
    if (!currentTxs || currentTxs.length === 0) {
      try {
        const { data: txData } = await supabase
          .from("credit_transactions")
          .select("*")
          .eq("customer_id", customer.id)
          .order("created_at", { ascending: false })
          .limit(10);
        if (txData) currentTxs = txData;
      } catch (e) {}
    }

    let totalPurchases = 0;
    try {
      const { data: qData } = await supabase
        .from("quotes")
        .select("total, status")
        .eq("customer_id", customer.id);
      if (qData) {
        totalPurchases = qData
          .filter((q: any) => q.status === "ticket" || q.status === "sale" || q.status === "completed" || q.status === "converted")
          .reduce((sum: number, q: any) => sum + Number(q.total || 0), 0);
      }
    } catch (e) {}

    const loyaltyRedeemRate = parseFloat(localStorage.getItem("ERIKA_REDEEM_RATE") || "10");
    const pointsMoney = ((customer.points || 0) / loyaltyRedeemRate).toFixed(2);
    const availableCredit = Math.max(0, (customer.credit_limit || 0) - (customer.balance || 0));

    // Antes esta función SIEMPRE usaba window.print() (a través de un
    // iframe oculto), sin importar el tipo de impresora configurado en
    // Ajustes. Eso funciona si hay una impresora "system" con driver de
    // Windows/Android, pero una impresora térmica vinculada solo por
    // Bluetooth (sin driver de sistema, como la EC-MP-300 de esta tienda)
    // nunca aparece como destino de impresión del navegador -- el diálogo
    // de imprimir no tiene a quién mandarle nada, así que "no imprime
    // nada" aunque la impresora esté bien vinculada. El resto del POS
    // (venta, corte de caja) ya revisa ERIKA_PRINTER_TYPE y manda bytes
    // ESC/POS directo por Bluetooth cuando corresponde; esto le da a
    // "Imprimir Estado" el mismo camino.
    if (localStorage.getItem("ERIKA_PRINTER_TYPE") === "bluetooth") {
      try {
        const paperSize = localStorage.getItem("ERIKA_PRINTER_PAPER_SIZE") || "80mm";
        const maxCols = paperSize === "58mm" ? 30 : 42;
        const divider = "-".repeat(maxCols) + "\n";

        const encoder = new TextEncoder();
        const chunks: Uint8Array[] = [];
        const write = (b: number[]) => chunks.push(new Uint8Array(b));
        const writeText = (t: string) => chunks.push(encoder.encode(sanitizeForThermal(t)));
        const formatRow = (label: string, value: string) => {
          const spaces = maxCols - label.length - value.length;
          return label + (spaces > 0 ? " ".repeat(spaces) : " ") + value + "\n";
        };

        write([0x1b, 0x40]);
        write([0x1b, 0x61, 0x01]);
        write([0x1b, 0x45, 0x01]);
        write([0x1d, 0x21, 0x11]);
        writeText(`${(businessProfile.name || "Ferreteria Erika").toUpperCase()}\n`);
        write([0x1d, 0x21, 0x00]);
        writeText("ESTADO DE CUENTA\n");
        write([0x1b, 0x45, 0x00]);
        writeText(divider);

        write([0x1b, 0x61, 0x00]);
        writeText(`Fecha: ${new Date().toLocaleString()}\n`);
        writeText(`Cliente: ${customer.name}\n`);
        if (customer.phone) writeText(`Tel: ${customer.phone}\n`);
        writeText(divider);

        writeText(formatRow("Limite Credito:", `$${(customer.credit_limit || 0).toFixed(2)}`));
        writeText(formatRow("Saldo Deudor:", `$${(customer.balance || 0).toFixed(2)}`));
        writeText(formatRow("Credito Disponible:", `$${availableCredit.toFixed(2)}`));
        writeText(divider);
        writeText(formatRow("Puntos Acumulados:", `${customer.points || 0} pts`));
        writeText(formatRow("Dinero Ganado:", `$${pointsMoney}`));
        if (totalPurchases > 0) {
          writeText(formatRow("Compras Historicas:", `$${totalPurchases.toFixed(2)}`));
        }

        if (currentTxs && currentTxs.length > 0) {
          writeText(divider);
          writeText("ULTIMOS MOVIMIENTOS\n");
          for (const tx of currentTxs.slice(0, 8)) {
            const tipo = tx.type === "charge" ? "CARGO" : "ABONO";
            const signo = tx.type === "charge" ? "+" : "-";
            writeText(formatRow(`${new Date(tx.created_at).toLocaleDateString()} ${tipo}`, `${signo}$${Number(tx.amount || 0).toFixed(2)}`));
          }
        }

        writeText(divider);
        write([0x1b, 0x61, 0x01]);
        writeText("Gracias por su preferencia!\n");

        const bottomLines = Number(localStorage.getItem("ERIKA_PRINTER_BOTTOM_LINES")) || 1;
        if (bottomLines > 0) write([0x1b, 0x64, bottomLines]);
        if (localStorage.getItem("ERIKA_PRINTER_ENABLE_AUTOCUT") !== "false") write([0x1d, 0x56, 0x41, 0x00]);

        const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
        const bytes = new Uint8Array(totalLength);
        let offset = 0;
        chunks.forEach((c) => { bytes.set(c, offset); offset += c.length; });

        const chunkSize = Number(localStorage.getItem("ERIKA_PRINTER_BLE_CHUNK_SIZE")) || 20;
        const printResult = await printEscPosBytes(bytes, chunkSize, 20);
        if (!printResult.success) {
          showPrintFailureToast(printResult.error, () => printCustomerAccountStatement(customer));
          LoggerService.logError("Print_EstadoCuenta_Bluetooth", printResult.error, currentUser?.name || "Cajero");
          return;
        }
        toast.success("🖨️ Estado de Cuenta enviado a la impresora Bluetooth.");
      } catch (err: any) {
        console.error(err);
        showPrintFailureToast(err.message, () => printCustomerAccountStatement(customer));
        LoggerService.logError("Print_EstadoCuenta_Bluetooth", err.message, currentUser?.name || "Cajero");
      }
      return;
    }

    const movementsHtml = (currentTxs || [])
      .slice(0, 8)
      .map(
        (tx: any) => `
        <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 2px;">
          <div>${new Date(tx.created_at).toLocaleDateString()} ${tx.type === "charge" ? "CARGO" : "ABONO"}</div>
          <div style="font-weight: bold; color: ${tx.type === 'charge' ? '#990000' : '#007700'};">
            ${tx.type === 'charge' ? '+' : '-'}$${Number(tx.amount || 0).toFixed(2)}
          </div>
        </div>
        <div style="font-size: 9.5px; color: #444; margin-bottom: 5px; border-bottom: 1px dotted #ccc; padding-bottom: 2px;">
          ${tx.notes || tx.description || "Movimiento"}
        </div>
      `
      )
      .join("");

    const ticketHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Estado de Cuenta - ${customer.name}</title>
          <style>
            @page { margin: 0; }
            body { 
              font-family: 'Courier New', Courier, monospace; 
              margin: 0 auto; 
              padding: 8px; 
              width: 58mm; 
              color: #000; 
              background: #fff; 
              box-sizing: border-box;
            }
            .center { text-align: center; }
            .divider { border-bottom: 1px dashed #000; margin: 8px 0; }
            .bold { font-weight: bold; }
            .row { display: flex; justify-content: space-between; font-size: 11.5px; margin-bottom: 4px; }
          </style>
        </head>
        <body>
          <div class="center bold" style="font-size: 14px; margin-bottom: 3px;">${businessProfile.name || "FERRETERÍA ERIKA"}</div>
          <div class="center" style="font-size: 10.5px; font-weight: bold; letter-spacing: 1px;">*** ESTADO DE CUENTA ***</div>
          <div class="center" style="font-size: 9.5px;">${new Date().toLocaleString()}</div>
          <div class="divider"></div>
          
          <div style="font-size: 11.5px; margin-bottom: 2px;"><strong>CLIENTE:</strong> ${customer.name}</div>
          ${customer.company_name && customer.company_name !== customer.name ? `<div style="font-size: 10px;">Empresa: ${customer.company_name}</div>` : ""}
          ${customer.phone ? `<div style="font-size: 10px;">Tel: ${customer.phone}</div>` : ""}
          ${customer.rfc ? `<div style="font-size: 10px;">RFC: ${customer.rfc}</div>` : ""}
          <div class="divider"></div>

          <div class="center bold" style="font-size: 11px; margin-bottom: 4px;">💳 SALDO Y LÍNEA DE CRÉDITO</div>
          <div class="row">
            <span>Límite Crédito:</span>
            <span class="bold">$${(customer.credit_limit || 0).toFixed(2)}</span>
          </div>
          <div class="row" style="color: ${customer.balance > 0 ? '#990000' : '#000'}; font-weight: bold;">
            <span>Saldo Deudor:</span>
            <span>$${(customer.balance || 0).toFixed(2)}</span>
          </div>
          <div class="row">
            <span>Crédito Disponible:</span>
            <span class="bold" style="color: #007700;">$${availableCredit.toFixed(2)}</span>
          </div>
          
          <div class="divider"></div>
          <div class="center bold" style="font-size: 11px; margin-bottom: 4px;">🎁 PUNTOS Y BENEFICIOS</div>
          <div class="row">
            <span>Puntos Acumulados:</span>
            <span class="bold">${customer.points || 0} pts</span>
          </div>
          <div class="row" style="color: #007700; font-weight: bold;">
            <span>Dinero Ganado/Ahorro:</span>
            <span>$${pointsMoney}</span>
          </div>
          ${totalPurchases > 0 ? `
          <div class="row" style="font-size: 10.5px; opacity: 0.9;">
            <span>Compras Históricas:</span>
            <span>$${totalPurchases.toFixed(2)}</span>
          </div>` : ""}

          ${movementsHtml ? `
            <div class="divider"></div>
            <div class="center bold" style="font-size: 10px; margin-bottom: 4px;">ÚLTIMOS MOVIMIENTOS</div>
            ${movementsHtml}
          ` : ""}

          <div class="divider"></div>
          <div class="center bold" style="font-size: 10.5px; margin-top: 6px;">
            ¡Gracias por su preferencia!
          </div>
        </body>
      </html>
    `;

    printThermalTicketDirect(ticketHtml);
    toast.success("🖨️ Mandando a imprimir Estado de Cuenta en ticket...");
  };

  // Antes esta función duplicaba (y desincronizaba con) handleSellQuote()
  // de QuotesModule.tsx: usaba window.prompt en vez del modal de PIN
  // compartido, y siempre mandaba a Arqueo de Caja sin checar si ya había
  // una caja abierta. Ver useSellQuoteToPOS.ts.
  const convertQuoteToSale = (quote: any) => sellQuoteToSale(quote, selectedCustomerId || undefined);

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingCustomerId) {
      const { error } = await saveCustomer({ id: editingCustomerId, ...newCustomer });
      if (error) alert("Error al actualizar: " + error.message);
      else {
        setShowAddModal(false);
        setEditingCustomerId(null);
        setNewCustomer({ name: "", phone: "", rfc: "", email: "", company_name: "", credit_limit: 0 });
        fetchCustomers();
      }
    } else {
      const cleanName = newCustomer.name.trim();
      const cleanPhone = newCustomer.phone.trim();
      // Detección básica de duplicados: nombre igual (sin importar mayúsculas/
      // espacios) o mismo teléfono. No bloquea la creación (puede haber dos
      // clientes con el mismo nombre legítimamente), pero avisa antes de crear
      // un registro que podría fragmentar el saldo/historial de un cliente ya existente.
      const { data: possibleDupes } = await supabase
        .from("customers")
        .select("id, name, phone")
        .or("deleted.is.null,deleted.eq.false");
      const dupe = (possibleDupes || []).find((c: { name?: string; phone?: string }) =>
        c.name?.trim().toLowerCase() === cleanName.toLowerCase() ||
        (cleanPhone !== "" && c.phone?.trim() === cleanPhone)
      );
      if (dupe) {
        const proceed = window.confirm(
          `⚠️ Ya existe un cliente similar: "${dupe.name}" (Tel: ${dupe.phone || "N/A"}).\n\n¿Seguro que quieres crear un cliente nuevo de todos modos? (Esto puede fragmentar el crédito/historial del cliente existente)`
        );
        if (!proceed) return;
      }

      const { error } = await saveCustomer(newCustomer);
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

    // El INSERT en credit_transactions y el decremento atómico del saldo
    // ahora ocurren en el servidor (Service Role Key) — antes cualquiera
    // con la consola del navegador abierta podía forjar un abono a
    // cualquier cliente sin que el dinero hubiera entrado nunca a la caja.
    let effectiveNewBalance = customer.balance - amount;
    let cashRegistered = false;
    try {
      const res = await fetch("/api/credit/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: customer.id, amount, notes: "Abono a cuenta" }),
      });
      const json = await res.json();
      if (!res.ok) return alert("Error: " + (json.error || "No se pudo registrar el abono."));
      effectiveNewBalance = json.newBalance;
      cashRegistered = Boolean(json.cashRegistered);
    } catch (e: any) {
      return alert("Error: " + e.message);
    }

    // El efectivo del abono ahora se registra solo (ver /api/credit/payment)
    // en la caja actualmente abierta -- antes esto requería ir aparte a
    // Arqueo de Caja a capturar un "Ingreso" manual, un paso desconectado
    // del abono en sí. Si no hay caja abierta no se bloquea el abono, pero
    // se avisa para que el cajero sepa que ese efectivo no quedó en ningún
    // corte.
    alert(`✅ Abono de $${amount.toFixed(2)} registrado exitosamente.${cashRegistered ? "" : "\n⚠️ La caja está cerrada: este efectivo no quedó registrado en ningún corte."}`);
    
    if (customer.phone) {
      if (confirm(`¿Deseas enviar un recibo por WhatsApp a ${customer.phone}?`)) {
        const newBalance = effectiveNewBalance;
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
    if (!window.confirm(`⚠️ ¿Seguro que deseas eliminar al cliente "${name}"?\nSe moverá a la Papelera.`)) return;

    const customer = customers.find(c => c.id === custId);
    if (customer && customer.balance > 0) {
      if (!window.confirm(`⚠️ El cliente tiene un saldo deudor de $${customer.balance.toFixed(2)}.\n¿Deseas eliminarlo de todas formas?`)) {
        return;
      }
    }

    const { error } = await deleteCustomer(custId, "soft");

    if (error) {
      alert("Error al eliminar cliente: " + error.message);
    } else {
      setUndoCustomerId(custId);
      setUndoCustomerName(name);
      setShowUndoToast(true);
      setSelectedCustomerId("");
      fetchCustomers();
    }
  };

  const handleUndoDelete = async () => {
    if (!undoCustomerId) return;
    const { error } = await deleteCustomer(undoCustomerId, "restore");

    if (error) {
      alert("Error al deshacer la eliminación: " + error.message);
    } else {
      setShowUndoToast(false);
      const restoredId = undoCustomerId;
      setUndoCustomerId(null);
      setUndoCustomerName("");
      await fetchCustomers();
      setSelectedCustomerId(restoredId);
    }
  };

  useEffect(() => {
    if (showUndoToast) {
      const timer = setTimeout(() => {
        setShowUndoToast(false);
        setUndoCustomerId(null);
        setUndoCustomerName("");
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [showUndoToast]);

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
            {customers.map((c) => (
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
          {hasMore && (
            <button
              onClick={handleLoadMore}
              style={{
                width: "100%",
                padding: "10px",
                background: "transparent",
                color: "var(--color-primary)",
                border: "1px dashed var(--color-primary)",
                borderRadius: "5px",
                cursor: "pointer",
                marginTop: "10px",
                fontWeight: "bold"
              }}
            >
              ➕ Cargar más clientes
            </button>
          )}
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

                // Calcular inactividad de más de 45 días
                const lastTxDate = transactions.length > 0 ? new Date(transactions[0].created_at) : null;
                const lastQuoteDate = customerQuotes.length > 0 ? new Date(customerQuotes[0].created_at) : null;
                const lastActivity = [
                  c.created_at ? new Date(c.created_at) : null,
                  lastTxDate,
                  lastQuoteDate
                ].filter(Boolean) as Date[];
                const newestActivity = lastActivity.length > 0 ? new Date(Math.max(...lastActivity.map(d => d.getTime()))) : null;
                const daysSinceActivity = newestActivity ? (Date.now() - newestActivity.getTime()) / (1000 * 60 * 60 * 24) : 0;
                const suggestDelete = daysSinceActivity > 45;

                return (
                  <div
                    style={{
                      borderBottom: "1px solid rgba(255,255,255,0.1)",
                      paddingBottom: "20px",
                      marginBottom: "20px",
                    }}
                  >
                    {suggestDelete && (
                      <div
                        style={{
                          background: "rgba(245, 158, 11, 0.15)",
                          border: "1px solid #f59e0b",
                          borderRadius: "12px",
                          padding: "12px 16px",
                          marginBottom: "15px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "10px",
                          boxShadow: "0 0 10px rgba(245, 158, 11, 0.1)",
                        }}
                      >
                        <div style={{ fontSize: "0.85rem", color: "#fcd34d", lineHeight: 1.4 }}>
                          💡 <strong>Sugerencia de Erika:</strong> Este cliente no registra movimientos ni cotizaciones en los últimos <strong>{Math.floor(daysSinceActivity)} días</strong>. Se sugiere darlo de baja.
                        </div>
                        <button
                          className="btn-primary"
                          style={{
                            padding: "6px 12px",
                            fontSize: "0.8rem",
                            background: "#ef4444",
                            border: "none",
                            color: "white",
                          }}
                          onClick={() => handleDeleteCustomer(c.id, c.name)}
                        >
                          Dar de Baja
                        </button>
                      </div>
                    )}
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
                          onClick={() => printCustomerAccountStatement(c)}
                          title={typeof window !== "undefined" && localStorage.getItem("ERIKA_PRINTER_TYPE") === "bluetooth" ? "Se enviará por Bluetooth a la impresora térmica" : "Se abrirá el diálogo de impresión del navegador"}
                        >
                          🖨️ Imprimir Estado {typeof window !== "undefined" && localStorage.getItem("ERIKA_PRINTER_TYPE") === "bluetooth" ? "(Bluetooth)" : ""}
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
                              <td style={{ padding: "10px" }}>
                                {tx.notes}
                                {(() => {
                                  // "Ver Ticket Original": el folio real (quote_number) ahora
                                  // viaja dentro de la nota ("Venta a Crédito Ticket #N: ...",
                                  // ver PosCreditModal.tsx). Al hacer clic, se manda al Punto de
                                  // Venta con la búsqueda de "Consulta de Tickets Anteriores" ya
                                  // rellena con ese folio.
                                  const match = tx.notes?.match(/Ticket #(\d+)/);
                                  if (!match) return null;
                                  return (
                                    <button
                                      onClick={() => {
                                        localStorage.setItem("ERIKA_OPEN_TICKET_SEARCH", match[1]);
                                        window.location.href = "/";
                                      }}
                                      style={{
                                        display: "block",
                                        marginTop: "4px",
                                        background: "transparent",
                                        border: "none",
                                        color: "#3b82f6",
                                        fontSize: "0.78rem",
                                        cursor: "pointer",
                                        padding: 0,
                                        textDecoration: "underline",
                                      }}
                                    >
                                      🎫 Ver Ticket Original
                                    </button>
                                  );
                                })()}
                              </td>
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
                              <td style={{ padding: "10px", fontWeight: "bold", color: "#3b82f6" }}>
                                ${q.total.toFixed(2)}
                                {/* status "ticket" son ventas normales de caja (no cotizaciones) que
                                    también viven en esta tabla -- el chequeo de mismatch no aplica ahí
                                    (esas sí pueden llevar descuento de mayoreo/volumen legítimo que este
                                    chequeo no reproduce a propósito, ver quoteTotalCheck.ts). */}
                                {q.status !== "ticket" && getQuoteTotalMismatch(q).mismatch && (
                                  <span
                                    title={`El total guardado no coincide con artículos + ajustes (debería ser $${getQuoteTotalMismatch(q).expectedTotal.toFixed(2)})`}
                                    style={{ marginLeft: "4px", color: "#f87171", cursor: "help" }}
                                  >
                                    ⚠️
                                  </span>
                                )}
                              </td>
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
                                        style={{ padding: "3px 8px", fontSize: "0.75rem", background: "linear-gradient(135deg, #10b981, #059669)", color: "white", border: "none", fontWeight: "bold" }}
                                        onClick={() => convertQuoteToSale(q)}
                                      >
                                        💰 Vender / Cobrar
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
            alignItems: "flex-start",
            justifyContent: "center",
            zIndex: 1000,
            overflowY: "auto",
            padding: "40px 20px",
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

      {showUndoToast && (
        <div
          style={{
            position: "fixed",
            bottom: "30px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(17, 24, 39, 0.9)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            padding: "16px 24px",
            borderRadius: "14px",
            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.6), 0 10px 10px -5px rgba(0, 0, 0, 0.6)",
            display: "flex",
            alignItems: "center",
            gap: "20px",
            zIndex: 9999,
            animation: "slide-up-toast 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
            color: "white",
          }}
        >
          <span style={{ fontSize: "0.95rem", fontWeight: "500", display: "flex", alignItems: "center", gap: "8px" }}>
            <span>🗑️</span> Cliente <strong style={{ color: "var(--color-primary)" }}>{undoCustomerName}</strong> eliminado.
          </span>
          <button
            onClick={handleUndoDelete}
            style={{
              background: "var(--color-primary)",
              color: "black",
              border: "none",
              padding: "8px 16px",
              borderRadius: "8px",
              fontWeight: "bold",
              cursor: "pointer",
              fontSize: "0.85rem",
              transition: "transform 0.2s, opacity 0.2s",
              boxShadow: "0 0 10px rgba(0, 242, 254, 0.3)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "scale(1.03)";
              e.currentTarget.style.opacity = "0.9";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "scale(1)";
              e.currentTarget.style.opacity = "1";
            }}
          >
            Deshacer
          </button>
          <button
            onClick={() => setShowUndoToast(false)}
            style={{
              background: "transparent",
              border: "none",
              color: "rgba(255, 255, 255, 0.4)",
              fontSize: "1.4rem",
              cursor: "pointer",
              lineHeight: 1,
              padding: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "color 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "white")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255, 255, 255, 0.4)")}
          >
            ×
          </button>
          <style dangerouslySetInnerHTML={{__html: `
            @keyframes slide-up-toast {
              from { transform: translate(-50%, 100px); opacity: 0; }
              to { transform: translate(-50%, 0); opacity: 1; }
            }
          `}} />
        </div>
      )}
      {SellQuotePinModal}
    </div>
  );
}
