"use client";
import { useState, useEffect } from "react";
import CustomersModule from "../../components/CustomersModule";
import ServicesModule from "../../components/ServicesModule";
import { useAuth } from "../../components/AuthProvider";

export default function ClientesPage() {
  const { currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<"clientes" | "agenda">("clientes");
  
  const isAdmin = currentUser?.role === "admin";
  const p = currentUser?.permissions || {};
  
  const canSeeClientes = isAdmin || p.pos || p.inventario;
  const canSeeAgenda = isAdmin || p.servicios;

  useEffect(() => {
    if (!canSeeClientes && canSeeAgenda) {
      setActiveTab("agenda");
    } else if (canSeeClientes && !canSeeAgenda) {
      setActiveTab("clientes");
    }
  }, [canSeeClientes, canSeeAgenda]);

  return (
    <div className="p-6">
      <div style={{ marginBottom: "20px", display: "flex", gap: "10px", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "10px" }}>
        {canSeeClientes && (
          <button
            onClick={() => setActiveTab("clientes")}
            style={{
              background: activeTab === "clientes" ? "rgba(59, 130, 246, 0.2)" : "transparent",
              color: activeTab === "clientes" ? "#60a5fa" : "var(--color-text)",
              border: "none",
              padding: "10px 20px",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: activeTab === "clientes" ? "bold" : "normal",
              transition: "all 0.2s ease"
            }}
          >
            👥 Clientes y Crédito
          </button>
        )}
        
        {canSeeAgenda && (
          <button
            onClick={() => setActiveTab("agenda")}
            style={{
              background: activeTab === "agenda" ? "rgba(59, 130, 246, 0.2)" : "transparent",
              color: activeTab === "agenda" ? "#60a5fa" : "var(--color-text)",
              border: "none",
              padding: "10px 20px",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: activeTab === "agenda" ? "bold" : "normal",
              transition: "all 0.2s ease"
            }}
          >
            📅 Agenda de Servicios
          </button>
        )}
      </div>

      {activeTab === "clientes" && canSeeClientes && <CustomersModule />}
      {activeTab === "agenda" && canSeeAgenda && <ServicesModule />}
    </div>
  );
}
