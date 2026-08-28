"use client";
import { supabase } from "../lib/supabaseClient";
import toast from "react-hot-toast";
import { usePinPrompt } from "./usePinPrompt";

interface SellableQuote {
  id: string;
  quote_number?: number | string | null;
  items: unknown;
  discount_pct?: number | null;
  apply_iva?: boolean | null;
  customer_id?: string | null;
  customer_name?: string | null;
}

// Antes "vender una cotización" tenía DOS implementaciones separadas que
// fueron divergiendo -- handleSellQuote (QuotesModule.tsx) y
// convertQuoteToSale (CustomersModule.tsx, pestaña Clientes y Crédito).
// Cuando se corrigió el bug de "manda a Caja aunque ya esté abierta" en una
// se nos olvidó la otra, y CustomersModule además seguía usando
// window.prompt en vez del modal de PIN compartido. Con este hook las dos
// pantallas comparten la misma lógica: un solo lugar que corregir la
// próxima vez.
export function useSellQuoteToPOS() {
  const { getPinAsync, PinModal } = usePinPrompt();

  const sellQuoteToSale = async (quote: SellableQuote, fallbackCustomerId?: string) => {
    const pin = await getPinAsync(
      "AUTORIZACIÓN REQUERIDA",
      `¿Deseas enviar la Cotización #${quote.quote_number ?? ""} a Punto de Venta para cobrar e imprimir ticket?\nIngresa tu PIN:`,
    );
    if (!pin) return;

    const res = await fetch("/api/auth/verify-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    const json = await res.json();
    if (!res.ok || json.valid !== true) {
      alert("❌ PIN incorrecto. Operación cancelada.");
      return;
    }

    localStorage.setItem("ERIKA_PRINTER_CONNECTED", "true");
    localStorage.setItem("ERIKA_RESTORE_QUOTE", JSON.stringify(quote.items));
    localStorage.setItem("ERIKA_RESTORE_QUOTE_ID", quote.id);
    localStorage.setItem("ERIKA_RESTORE_QUOTE_NUMBER", String(quote.quote_number ?? ""));
    // Si la cotización se guardó con IVA activado y/o un % de descuento o
    // aumento sobre el total del ticket, ese ajuste se debe restaurar
    // también -- ver restoreQuote() en POSModule.tsx. Bug real reportado
    // por el cliente cuando esto faltaba: cotización por $46.80, venta
    // resultante por $45.00.
    localStorage.setItem("ERIKA_RESTORE_QUOTE_DISCOUNT_PCT", String(quote.discount_pct ?? 0));
    localStorage.setItem("ERIKA_RESTORE_QUOTE_APPLY_IVA", String(quote.apply_iva ?? false));

    if (quote.customer_id) {
      localStorage.setItem("ERIKA_RESTORE_CUSTOMER_ID", quote.customer_id);
    } else if (fallbackCustomerId) {
      localStorage.setItem("ERIKA_RESTORE_CUSTOMER_ID", fallbackCustomerId);
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

    // Si no hay una caja abierta, el checkout en Punto de Venta va a
    // rechazar el cobro. En vez de eso, se manda primero a Arqueo de Caja a
    // declarar el fondo inicial -- caja/page.tsx detecta las mismas
    // banderas de localStorage y, en cuanto la caja queda abierta, redirige
    // solo a Punto de Venta para terminar el cobro. Si la caja YA está
    // abierta, ir directo -- antes convertQuoteToSale siempre mandaba a
    // Arqueo de Caja sin importar esto, dejando al cajero varado en la
    // pantalla de Corte de Caja Ciego (que no tiene nada que ver con
    // cobrar un ticket).
    const { data: openSession } = await supabase
      .from("cash_sessions")
      .select("id")
      .eq("status", "open")
      .limit(1)
      .maybeSingle();

    if (openSession) {
      toast.success(`Cotización #${quote.quote_number ?? ""} enviada a Punto de Venta para cobro.`);
      window.location.href = "/";
    } else {
      toast.success(`Cotización #${quote.quote_number ?? ""}: primero declara el fondo inicial para abrir la caja.`);
      window.location.href = "/caja";
    }
  };

  return { sellQuoteToSale, PinModal };
}
