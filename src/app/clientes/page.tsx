"use client";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import CustomersModule from "../../components/CustomersModule";
import ServicesModule from "../../components/ServicesModule";
import LayawaysModule from "../../components/LayawaysModule";
import QuotesModule from "../../components/QuotesModule";
import { useAuth } from "../../components/AuthProvider";

function ClientesPageContent() {
  const { currentUser } = useAuth();
  const searchParams = useSearchParams();
  const tab = searchParams ? searchParams.get("tab") : null;
  const [activeTab, setActiveTab] = useState<"clientes" | "agenda" | "apartados" | "presupuestos">("clientes");
  
  const isAdmin = currentUser?.role === "admin";
  const p = currentUser?.permissions || {};
  
  const canSeeClientes = isAdmin || p.pos || p.inventario;
  const canSeeAgenda = isAdmin || p.servicios;

  useEffect(() => {
    if (tab === "agenda" && canSeeAgenda) {
      setActiveTab("agenda");
    } else if (tab === "apartados" && canSeeClientes) {
      setActiveTab("apartados");
    } else if (tab === "presupuestos" && canSeeClientes) {
      setActiveTab("presupuestos");
    } else if (tab === "clientes" && canSeeClientes) {
      setActiveTab("clientes");
    } else {
      if (!canSeeClientes && canSeeAgenda) {
        setActiveTab("agenda");
      } else if (canSeeClientes && !canSeeAgenda) {
        setActiveTab("clientes");
      }
    }
  }, [tab, canSeeClientes, canSeeAgenda]);

  return (
    <div className="p-6">
      <div style={{ marginBottom: "20px", display: "flex", gap: "10px", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "10px", flexWrap: "wrap" }}>
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

        {canSeeClientes && (
          <button
            onClick={() => setActiveTab("apartados")}
            style={{
              background: activeTab === "apartados" ? "rgba(59, 130, 246, 0.2)" : "transparent",
              color: activeTab === "apartados" ? "#60a5fa" : "var(--color-text)",
              border: "none",
              padding: "10px 20px",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: activeTab === "apartados" ? "bold" : "normal",
              transition: "all 0.2s ease"
            }}
          >
            📦 Apartados
          </button>
        )}

        {canSeeClientes && (
          <button
            onClick={() => setActiveTab("presupuestos")}
            style={{
              background: activeTab === "presupuestos" ? "rgba(59, 130, 246, 0.2)" : "transparent",
              color: activeTab === "presupuestos" ? "#60a5fa" : "var(--color-text)",
              border: "none",
              padding: "10px 20px",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: activeTab === "presupuestos" ? "bold" : "normal",
              transition: "all 0.2s ease"
            }}
          >
            📄 Presupuestos
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
      {activeTab === "apartados" && canSeeClientes && <LayawaysModule />}
      {activeTab === "presupuestos" && canSeeClientes && <QuotesModule />}
      {activeTab === "agenda" && canSeeAgenda && <ServicesModule />}
    </div>
  );
}

export default function ClientesPage() {
  return (
    <Suspense fallback={<div className="p-6 text-white">Cargando módulo...</div>}>
      <ClientesPageContent />
    </Suspense>
  );
}
