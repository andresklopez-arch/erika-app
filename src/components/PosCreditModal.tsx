"use client";
import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

interface Props {
  show: boolean;
  onClose: () => void;
  finalTotal: number;
  customers: any[];
  activeTicketId: number;
  onSuccess: () => void;
  reloadCustomers: () => void;
}

export default function PosCreditModal({
  show,
  onClose,
  finalTotal,
  customers,
  activeTicketId,
  onSuccess,
  reloadCustomers,
}: Props) {
  const [selectedCustomerId, setSelectedCustomerId] = useState("");

  if (!show) return null;

  const handleConfirm = async () => {
    if (!selectedCustomerId) return alert("Selecciona un cliente.");
    const customer = customers.find((c) => c.id === selectedCustomerId);
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

    const { error: txError } = await supabase
      .from("credit_transactions")
      .insert({
        customer_id: customer.id,
        type: "charge",
        amount: finalTotal,
        notes: `Venta a Crédito Ticket #${activeTicketId}`,
      });

    await supabase
      .from("customers")
      .update({
        balance: customer.balance + finalTotal,
      })
      .eq("id", customer.id);

    if (txError) return alert("Error al cobrar a crédito: " + txError.message);

    alert(`✅ Venta a crédito registrada a ${customer.name}.`);
    setSelectedCustomerId("");
    onSuccess();
    reloadCustomers();
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
            style={{ flex: 1 }}
            onClick={handleConfirm}
          >
            Confirmar
          </button>
          <button
            className="btn-primary"
            style={{ flex: 1, background: "#ef4444" }}
            onClick={onClose}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
