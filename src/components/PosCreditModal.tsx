"use client";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

interface Props {
  show: boolean;
  onClose: () => void;
  finalTotal: number;
  customers: any[];
  activeTicketId: number;
  items: any[];
  globalCatalog: any[];
  currentUserName?: string;
  onSuccess: () => void;
  onInventoryReduced?: () => void;
  reloadCustomers: () => void;
}

export default function PosCreditModal({
  show,
  onClose,
  finalTotal,
  customers,
  activeTicketId,
  items,
  globalCatalog,
  currentUserName,
  onSuccess,
  onInventoryReduced,
  reloadCustomers,
}: Props) {
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      const invItem = globalCatalog.find((i) => i.name === item.name);
      return !invItem || item.qty > invItem.stock;
    });
    if (itemsExceedingStock.length > 0) {
      const itemNames = itemsExceedingStock
        .map(
          (i) =>
            `• ${i.name} (Venta: ${i.qty}, Stock: ${globalCatalog.find((cat) => cat.name === i.name)?.stock ?? 0})`,
        )
        .join("\n");
      const stockPin = window.prompt(
        `⚠️ STOCK INSUFICIENTE\nLos siguientes artículos superan las existencias físicas en inventario:\n${itemNames}\n\nIngresa el PIN de Administrador para autorizar:`,
      );
      if (!stockPin) return;
      const { data: stockAdmin, error: stockAdminErr } = await supabase
        .from("users")
        .select("id")
        .eq("pin", stockPin)
        .eq("role", "admin")
        .single();
      if (stockAdminErr || !stockAdmin) {
        return alert("❌ PIN incorrecto o sin privilegios de administrador. Venta a crédito cancelada.");
      }
    }

    if (customer.balance + finalTotal > customer.credit_limit) {
      const pin = window.prompt(
        `🚩 ALERTA ROJA: Límite de crédito excedido. Disponible: $${(customer.credit_limit - customer.balance).toFixed(2)}\n\nIngrese PIN Maestro para autorizar la venta (Sobregiro):`
      );
      if (!pin) return alert("❌ Operación cancelada.");

      const { data: admin, error: adminError } = await supabase
        .from("users")
        .select("*")
        .eq("pin", pin)
        .eq("role", "admin")
        .single();

      if (adminError || !admin) {
         return alert("❌ Acceso Denegado. Venta a crédito cancelada.");
      }
      alert("⚠️ Sobregiro autorizado por Administrador.");
    }

    setIsSubmitting(true);
    try {
      const { error: txError } = await supabase
        .from("credit_transactions")
        .insert({
          customer_id: customer.id,
          type: "charge",
          amount: finalTotal,
          notes: `Venta a Crédito Ticket #${activeTicketId}`,
        });

      if (txError) return alert("Error al cobrar a crédito: " + txError.message);

      // Incremento atómico en el servidor (evita que dos ventas a crédito
      // casi simultáneas al mismo cliente se pisen el saldo entre sí). Si
      // el RPC aún no está desplegado, se cae al cálculo local anterior.
      const { error: rpcBalanceErr } = await supabase.rpc("increment_customer_balance", {
        p_customer_id: customer.id,
        p_delta: finalTotal,
      });
      if (rpcBalanceErr) {
        const { error: balanceError } = await supabase
          .from("customers")
          .update({
            balance: customer.balance + finalTotal,
          })
          .eq("id", customer.id);

        if (balanceError) {
          return alert(
            "⚠️ Se registró el cargo pero falló la actualización del saldo del cliente. Revisa manualmente: " +
              balanceError.message,
          );
        }
      }

      // Descontar existencias, igual que en ventas de contado/tarjeta.
      try {
        const { error: rpcErr } = await supabase.rpc("reduce_inventory_stock", {
          items: items.map((item) => {
            const invItem = globalCatalog.find((i) => i.name === item.name);
            return { id: invItem ? invItem.id : null, qty: item.qty };
          }).filter((item) => item.id !== null),
          ref_id: activeTicketId.toString(),
          user_name: currentUserName || "Venta Mostrador",
          move_type: "sale",
        });

        if (rpcErr) {
          for (const item of items) {
            const invItem = globalCatalog.find((i) => i.name === item.name);
            if (invItem) {
              await supabase
                .from("inventory")
                .update({ stock: invItem.stock - item.qty })
                .eq("id", invItem.id);
            }
          }
        }
        onInventoryReduced?.();
      } catch (invErr) {
        console.error("Error crítico al actualizar inventario en venta a crédito:", invErr);
        alert("⚠️ La venta a crédito se registró, pero el inventario NO se pudo actualizar. Revisa y ajusta el stock manualmente.");
      }

      alert(`✅ Venta a crédito registrada a ${customer.name}.`);
      setSelectedCustomerId("");
      onSuccess();
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
    </div>
  );
}
