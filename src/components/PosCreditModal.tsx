"use client";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { reduceInventoryStock } from "../lib/inventoryClient";
import { matchesProduct } from "../lib/posItemMatch";
import { usePinPrompt } from "../hooks/usePinPrompt";

interface Props {
  show: boolean;
  onClose: () => void;
  finalTotal: number;
  customers: any[];
  items: any[];
  globalCatalog: any[];
  currentUserName?: string;
  discountPct: number;
  applyIva: boolean;
  saveTicketToQuotes: (params: {
    customerName: string;
    customerId: string | null;
    items: any[];
    total: number;
    discountPct: number;
    applyIva: boolean;
    notes: string;
  }) => Promise<{ realTicketId: number; quoteNumber: number | null; quoteUuid: string | null }>;
  onSuccess: (customer: any, realTicketId: number, quoteUuid: string | null) => void;
  onInventoryReduced?: () => void;
  reloadCustomers: () => void;
}

export default function PosCreditModal({
  show,
  onClose,
  finalTotal,
  customers,
  items,
  globalCatalog,
  currentUserName,
  discountPct,
  applyIva,
  saveTicketToQuotes,
  onSuccess,
  onInventoryReduced,
  reloadCustomers,
}: Props) {
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { getPinAsync, PinModal } = usePinPrompt();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    if (show) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [show, onClose]);

  if (!show) return null;

  // Verifica un PIN de administrador del lado del servidor (Service Role
  // Key, nunca expuesta al cliente) — antes se comparaba directamente
  // contra `users` desde el navegador con la llave pública.
  const verifyAdminPinRemote = async (pin: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/auth/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, requireRole: "admin" }),
      });
      const json = await res.json();
      return res.ok && json.valid === true;
    } catch (e) {
      console.error("Error al verificar PIN de administrador:", e);
      return false;
    }
  };

  const handleConfirm = async () => {
    if (isSubmitting) return;
    if (!selectedCustomerId) return alert("Selecciona un cliente.");
    const customer = customers.find((c) => c.id === selectedCustomerId);

    // Validación de stock estricta, igual que en el cobro de contado/tarjeta
    // (antes la venta a crédito no la tenía en absoluto: se podía vender sin
    // ninguna autorización productos sin existencias, o llevar el stock a
    // negativo, algo que en efectivo/tarjeta sí quedaba bloqueado con PIN).
    const itemsExceedingStock = items.filter((item) => {
      if (item.price < 0) return false;
      const invItem = globalCatalog.find((i) => matchesProduct(item, i));
      return !invItem || item.qty > invItem.stock;
    });
    if (itemsExceedingStock.length > 0) {
      const itemNames = itemsExceedingStock
        .map(
          (i) =>
            `• ${i.name} (Venta: ${i.qty}, Stock: ${globalCatalog.find((cat) => matchesProduct(i, cat))?.stock ?? 0})`,
        )
        .join("\n");
      const stockPin = await getPinAsync(
        "⚠️ STOCK INSUFICIENTE",
        `Los siguientes artículos superan las existencias físicas en inventario:\n${itemNames}\n\nIngresa el PIN de Administrador para autorizar:`,
      );
      if (!stockPin) return;
      if (!(await verifyAdminPinRemote(stockPin))) {
        return alert("❌ PIN incorrecto o sin privilegios de administrador. Venta a crédito cancelada.");
      }
    }

    let overdraftPin: string | undefined;
    if (customer.balance + finalTotal > customer.credit_limit) {
      const pin = await getPinAsync(
        "🚩 ALERTA ROJA",
        `Límite de crédito excedido. Disponible: $${(customer.credit_limit - customer.balance).toFixed(2)}\n\nIngrese PIN Maestro para autorizar la venta (Sobregiro):`
      );
      if (!pin) return alert("❌ Operación cancelada.");
      overdraftPin = pin;
    }

    setIsSubmitting(true);
    try {
      // Guardar el ticket en `quotes` PRIMERO (mismo camino que efectivo/
      // tarjeta) -- antes una venta a crédito nunca quedaba ahí: no salía en
      // "Consulta de Tickets Anteriores", no se podía reimprimir, y la nota
      // del cargo citaba activeTicketId (el id interno de la pestaña del
      // carrito, casi siempre "1"), no un folio real. Se hace antes del
      // cargo para poder usar el id real en la nota de credit_transactions.
      const { realTicketId, quoteNumber, quoteUuid } = await saveTicketToQuotes({
        customerName: customer.name,
        customerId: customer.id,
        items,
        total: finalTotal,
        discountPct,
        applyIva,
        notes: "Pago: CREDITO",
      });
      // quoteNumber es el folio real y buscable (entero secuencial); si por
      // algún motivo no se pudo guardar el ticket en `quotes` (columna
      // faltante, red caída, etc.), cae de regreso al id interno anterior
      // para no dejar la nota vacía -- la venta y el cargo a crédito ya se
      // cobraron bien de cualquier forma, esto es solo la referencia.
      const noteTicketRef = quoteNumber ?? realTicketId;

      // El INSERT en credit_transactions y el incremento atómico del saldo
      // ahora ocurren en el servidor (Service Role Key), que además vuelve
      // a validar ahí mismo el límite de crédito/PIN de sobregiro — antes
      // cualquiera con la consola del navegador abierta podía forjar un
      // cargo a cualquier cliente saltándose por completo esa validación.
      // Antes el "Historial de Movimientos" de Cuentas por Cobrar solo
      // mostraba "Venta a Crédito Ticket #X" -- sin decir qué se vendió, el
      // dueño no podía saber a qué correspondía el cargo sin ir a buscar el
      // ticket original. Se manda un resumen corto de los artículos para
      // que quede en la nota del cargo (y por lo tanto en el Estado de
      // Cuenta impreso).
      const itemsSummary = items.map((i) => `${i.qty}x ${i.name}`).join(", ");
      const res = await fetch("/api/credit/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customer.id,
          amount: finalTotal,
          ticketId: noteTicketRef,
          adminPin: overdraftPin,
          itemsSummary,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        return alert(
          res.status === 403
            ? "❌ Acceso Denegado. Venta a crédito cancelada."
            : "Error al cobrar a crédito: " + (json.error || "Error desconocido"),
        );
      }
      if (overdraftPin) alert("⚠️ Sobregiro autorizado por Administrador.");

      // Descontar existencias, igual que en ventas de contado/tarjeta.
      try {
        const { error: invErr } = await reduceInventoryStock(
          items.map((item) => {
            const invItem = globalCatalog.find((i) => matchesProduct(item, i));
            return { id: invItem ? invItem.id : null, qty: item.qty };
          }).filter((item): item is { id: string; qty: number } => item.id !== null),
          "sale",
          realTicketId.toString(),
        );
        if (invErr) console.error("Error al ajustar inventario en venta a crédito:", invErr.message);
        onInventoryReduced?.();
      } catch (invErr) {
        console.error("Error crítico al actualizar inventario en venta a crédito:", invErr);
        alert("⚠️ La venta a crédito se registró, pero el inventario NO se pudo actualizar. Revisa y ajusta el stock manualmente.");
      }

      alert(`✅ Venta a crédito registrada a ${customer.name}.`);
      setSelectedCustomerId("");
      onSuccess(customer, realTicketId, quoteUuid);
      reloadCustomers();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.9)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div className="glass-panel" style={{ width: "400px", padding: "20px" }}>
        <h3 style={{ color: "var(--color-primary)" }}>Cobrar a Crédito</h3>
        {/* Antes solo se veía el total, no qué se estaba cargando a la
            cuenta -- el cajero confirmaba a ciegas. Este mismo resumen es
            el que ahora queda guardado en la nota del cargo (ver
            handleConfirm), así que lo que se ve aquí es justo lo que
            después aparecerá en el Historial de Movimientos del cliente. */}
        {items.length > 0 && (
          <ul
            style={{
              listStyle: "none",
              padding: "8px 10px",
              margin: "0 0 12px 0",
              background: "rgba(255,255,255,0.04)",
              borderRadius: "8px",
              fontSize: "0.85rem",
              maxHeight: "120px",
              overflowY: "auto",
            }}
          >
            {items.map((item, idx) => (
              <li key={idx} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                <span>{item.qty} {item.unit && item.unit !== "pz" ? item.unit : "x"} {item.name}</span>
              </li>
            ))}
          </ul>
        )}
        <p>
          Total a cobrar: <strong>${finalTotal.toFixed(2)}</strong>
        </p>
        <select
          value={selectedCustomerId}
          onChange={(e) => setSelectedCustomerId(e.target.value)}
          style={{
            width: "100%",
            padding: "10px",
            marginBottom: "20px",
            borderRadius: "8px",
            background: "rgba(0,0,0,0.5)",
            color: "white",
          }}
        >
          <option value="">-- Selecciona un Cliente --</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} (Límite: ${c.credit_limit} | Saldo: ${c.balance})
            </option>
          ))}
        </select>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            className="btn-primary"
            style={{ flex: 1, opacity: isSubmitting ? 0.6 : 1 }}
            onClick={handleConfirm}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Procesando..." : "Confirmar"}
          </button>
          <button
            className="btn-primary"
            style={{ flex: 1, background: "#ef4444" }}
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancelar
          </button>
        </div>
      </div>
      {PinModal}
    </div>
  );
}
