"use client";
import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import toast from "react-hot-toast";
import { LoggerService } from "../services/loggerService";

interface ClientCaptureModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function ClientCaptureModal({ onClose, onSuccess }: ClientCaptureModalProps) {
  const [name, setName] = useState("");
  const [requiresInvoice, setRequiresInvoice] = useState(false);
  const [rfc, setRfc] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [creditLimit, setCreditLimit] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (requiresInvoice) {
      if (!rfc || !companyName) {
        alert("⚠️ Si el cliente requiere factura, RFC y Razón Social son obligatorios.");
        return;
      }
      // Validación básica de RFC del SAT (Persona física o moral)
      const rfcRegex = /^([A-ZÑ&]{3,4})\d{6}([A-Z\d]{3})?$/;
      if (!rfcRegex.test(rfc)) {
        alert("❌ El RFC ingresado no tiene un formato válido según el SAT.");
        return;
      }
    }

    setIsSubmitting(true);
    const { error } = await supabase.from("customers").insert({
      name,
      rfc: requiresInvoice ? rfc : "XAXX010101000",
      company_name: requiresInvoice ? companyName : name,
      email: email || "sin_correo@erika.com",
      credit_limit: creditLimit,
      balance: 0,
    });

    setIsSubmitting(false);

    if (error) {
      console.error(error);
      LoggerService.logError("ClientCaptureModal", error);
      toast.error(`Error de Supabase: ${error.message || JSON.stringify(error)}`);
    } else {
      toast.success(`Cliente ${name} registrado con éxito.`);
      onSuccess();
      onClose();
    }
  };

  const handleRfcChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase();
    setRfc(val);
    
    // Auto-completado simulado (Mock SAT API)
    if (val.length >= 12 && val.length <= 13 && !companyName) {
      const match = val.match(/^([A-ZÑ&]{3,4})/);
      if (match) {
         setCompanyName(match[1] + " EMPRESAS S.A. DE C.V.");
      }
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
        backgroundColor: "rgba(0,0,0,0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
        backdropFilter: "blur(5px)",
      }}
    >
      <div
        className="glass-panel animate-fade-in"
        style={{ width: "500px", maxWidth: "90%", position: "relative" }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: "15px",
            right: "15px",
            background: "transparent",
            border: "none",
            color: "white",
            fontSize: "1.5rem",
            cursor: "pointer",
          }}
        >
          ✖
        </button>
        <h2 style={{ color: "var(--color-primary)", marginBottom: "20px" }}>
          👤 Capturar Nuevo Cliente
        </h2>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
          <div>
            <label style={{ display: "block", marginBottom: "5px", color: "var(--color-secondary)" }}>
              Nombre Completo / Alias *
            </label>
            <input
              autoFocus
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "8px",
                border: "1px solid var(--glass-border)",
                background: "rgba(0,0,0,0.3)",
                color: "white",
              }}
              placeholder="Ej. Juan Pérez"
            />
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", padding: "10px", background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
            <input
              type="checkbox"
              checked={requiresInvoice}
              onChange={(e) => setRequiresInvoice(e.target.checked)}
              style={{ width: "20px", height: "20px", accentColor: "var(--color-secondary)" }}
            />
            <span style={{ fontWeight: "bold" }}>🧾 Este cliente requiere Factura</span>
          </label>

          {requiresInvoice && (
            <div style={{ display: "flex", gap: "15px" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", marginBottom: "5px" }}>RFC *</label>
                <input
                  type="text"
                  required={requiresInvoice}
                  value={rfc}
                  onChange={handleRfcChange}
                  style={{
                    width: "100%",
                    padding: "10px",
                    borderRadius: "8px",
                    border: "1px solid var(--color-primary)",
                    background: "rgba(0,0,0,0.3)",
                    color: "white",
                  }}
                  placeholder="XAXX010101000"
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", marginBottom: "5px" }}>Razón Social *</label>
                <input
                  type="text"
                  required={requiresInvoice}
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value.toUpperCase())}
                  style={{
                    width: "100%",
                    padding: "10px",
                    borderRadius: "8px",
                    border: "1px solid var(--color-primary)",
                    background: "rgba(0,0,0,0.3)",
                    color: "white",
                  }}
                  placeholder="JUAN PEREZ SA DE CV"
                />
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: "15px" }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", marginBottom: "5px", color: "var(--color-secondary)" }}>
                Correo Electrónico
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "8px",
                  border: "1px solid var(--glass-border)",
                  background: "rgba(0,0,0,0.3)",
                  color: "white",
                }}
                placeholder="correo@ejemplo.com"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", marginBottom: "5px", color: "var(--color-secondary)" }}>
                Límite de Crédito ($)
              </label>
              <input
                type="number"
                min="0"
                value={creditLimit}
                onChange={(e) => setCreditLimit(Number(e.target.value))}
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "8px",
                  border: "1px solid var(--glass-border)",
                  background: "rgba(0,0,0,0.3)",
                  color: "white",
                }}
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn-primary"
            disabled={isSubmitting}
            style={{ width: "100%", marginTop: "10px", padding: "15px", fontSize: "1.1rem" }}
          >
            {isSubmitting ? "Guardando..." : "💾 Guardar Cliente"}
          </button>
        </form>
      </div>
    </div>
  );
}
