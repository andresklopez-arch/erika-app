"use client";
import React, { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

interface ServiceAppointment {
  id: string;
  created_at: string;
  customer_name: string;
  customer_phone: string;
  technician_name: string;
  service_type: string;
  scheduled_at: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  cost: number;
  notes: string;
}

export default function ServicesModule() {
  const [services, setServices] = useState<ServiceAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingService, setEditingService] = useState<ServiceAppointment | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [techFilter, setTechFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Form State
  const [formData, setFormData] = useState({
    customer_name: "",
    customer_phone: "",
    technician_name: "Juan Plomero",
    service_type: "Instalación",
    scheduled_date: "",
    scheduled_time: "",
    cost: 0,
    notes: "",
  });

  const fetchServices = async () => {
    setLoading(true);
    setDbError(false);
    try {
      const { data, error } = await supabase
        .from("services")
        .select("*")
        .order("scheduled_at", { ascending: true });

      if (error) {
        console.error("Supabase error fetching services:", error);
        setDbError(true);
      } else if (data) {
        setServices(data);
      }
    } catch (err) {
      console.error("Connection error fetching services:", err);
      setDbError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServices();
  }, []);

  const handleOpenModal = (service?: ServiceAppointment) => {
    if (service) {
      setEditingService(service);
      const sDate = new Date(service.scheduled_at);
      const localDate = sDate.toISOString().split("T")[0];
      const localTime = sDate.toTimeString().split(" ")[0].substring(0, 5);

      setFormData({
        customer_name: service.customer_name,
        customer_phone: service.customer_phone || "",
        technician_name: service.technician_name,
        service_type: service.service_type,
        scheduled_date: localDate,
        scheduled_time: localTime,
        cost: service.cost,
        notes: service.notes || "",
      });
    } else {
      setEditingService(null);
      // Default to today + current time
      const now = new Date();
      const localDate = now.toISOString().split("T")[0];
      const localTime = now.toTimeString().split(" ")[0].substring(0, 5);

      setFormData({
        customer_name: "",
        customer_phone: "",
        technician_name: "Juan Plomero",
        service_type: "Instalación",
        scheduled_date: localDate,
        scheduled_time: localTime,
        cost: 350,
        notes: "",
      });
    }
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const scheduledAt = new Date(`${formData.scheduled_date}T${formData.scheduled_time}`).toISOString();

    const payload = {
      customer_name: formData.customer_name,
      customer_phone: formData.customer_phone,
      technician_name: formData.technician_name,
      service_type: formData.service_type,
      scheduled_at: scheduledAt,
      cost: Number(formData.cost),
      notes: formData.notes,
    };

    try {
      if (editingService) {
        const { error } = await supabase
          .from("services")
          .update(payload)
          .eq("id", editingService.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("services")
          .insert([{ ...payload, status: "pending" }]);
        if (error) throw error;
      }
      setShowModal(false);
      fetchServices();
    } catch (err) {
      alert("Error al guardar la cita en la base de datos.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from("services")
        .update({ status: newStatus })
        .eq("id", id);
      if (error) throw error;
      
      fetchServices();

      if (newStatus === "completed") {
        const service = services.find((s) => s.id === id);
        if (service && service.customer_phone) {
          if (confirm(`¿Deseas enviar una notificación por WhatsApp a ${service.customer_phone}?`)) {
            const msg = `Hola ${service.customer_name}, te informamos que el servicio de ${service.service_type} ha sido completado exitosamente. ¡Gracias por tu preferencia!`;
            const waLink = `https://wa.me/${service.customer_phone.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`;
            window.open(waLink, "_blank");
          }
        }
      }
    } catch (err) {
      alert("Error al actualizar el estado.");
      console.error(err);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm("¿Estás seguro de eliminar esta cita de servicio?")) {
      try {
        const { error } = await supabase.from("services").delete().eq("id", id);
        if (error) throw error;
        fetchServices();
      } catch (err) {
        alert("Error al eliminar la cita.");
        console.error(err);
      }
    }
  };

  // Filter lists
  const uniqueTechnicians = Array.from(new Set(services.map((s) => s.technician_name)));

  const filteredServices = services.filter((service) => {
    const matchesStatus = statusFilter === "all" || service.status === statusFilter;
    const matchesTech = techFilter === "all" || service.technician_name === techFilter;
    const matchesSearch =
      service.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      service.service_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (service.notes && service.notes.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesStatus && matchesTech && matchesSearch;
  });

  // KPI Calculations
  const totalCost = filteredServices.reduce((sum, s) => sum + s.cost, 0);
  const pendingCount = services.filter((s) => s.status === "pending").length;
  const inProgressCount = services.filter((s) => s.status === "in_progress").length;
  const completedCount = services.filter((s) => s.status === "completed").length;

  return (
    <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "25px" }}>
      {/* Title block */}
      <div className="flex-between">
        <div>
          <h1 style={{ color: "var(--color-primary)", textShadow: "0 0 10px rgba(16,185,129,0.2)", margin: 0 }}>
            📅 Agenda de Servicios y Visitas
          </h1>
          <p style={{ color: "var(--color-secondary)", margin: "5px 0 0 0" }}>
            Administración de visitas técnicas, instalaciones y servicios a domicilio.
          </p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="btn-primary"
          style={{
            padding: "12px 24px",
            fontSize: "1rem",
            background: "linear-gradient(135deg, var(--color-primary), #059669)",
            border: "none",
            boxShadow: "0 4px 15px rgba(16,185,129,0.3)",
          }}
        >
          + Programar Visita
        </button>
      </div>

      {/* SQL Fallback warning if services table doesn't exist */}
      {dbError && (
        <div
          style={{
            background: "rgba(239, 68, 68, 0.15)",
            border: "2px solid #ef4444",
            borderRadius: "12px",
            padding: "20px",
            color: "white",
          }}
        >
          <h3 style={{ color: "#ef4444", marginTop: 0, display: "flex", alignItems: "center", gap: "10px" }}>
            ⚠️ Tabla de Supabase Faltante
          </h3>
          <p style={{ color: "#fca5a5", fontSize: "0.95rem" }}>
            ERIKA no pudo leer la tabla <code>services</code>. Ejecuta la siguiente consulta SQL en tu consola de Supabase:
          </p>
          <pre
            style={{
              background: "rgba(0,0,0,0.5)",
              padding: "15px",
              borderRadius: "8px",
              fontSize: "0.85rem",
              fontFamily: "monospace",
              color: "#38bdf8",
              overflowX: "auto",
              border: "1px solid rgba(255,255,255,0.1)",
              marginTop: "10px",
            }}
          >
{`CREATE TABLE IF NOT EXISTS public.services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    technician_name TEXT NOT NULL,
    service_type TEXT NOT NULL,
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    cost NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    notes TEXT
);

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read/write access for all authenticated users" 
ON public.services FOR ALL TO authenticated USING (true) WITH CHECK (true);`}
          </pre>
          <button
            onClick={fetchServices}
            className="btn-primary"
            style={{ marginTop: "15px", background: "#ef4444", color: "white" }}
          >
            🔄 Reintentar Conexión
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
        <div
          className="glass-panel"
          style={{
            background: "linear-gradient(135deg, rgba(59, 130, 246, 0.15), transparent)",
            borderLeft: "4px solid #3b82f6",
          }}
        >
          <span style={{ fontSize: "0.9rem", color: "var(--color-secondary)" }}>Servicios Pendientes</span>
          <h2 style={{ fontSize: "2rem", margin: "10px 0 0 0", color: "#3b82f6" }}>{pendingCount}</h2>
        </div>
        <div
          className="glass-panel"
          style={{
            background: "linear-gradient(135deg, rgba(245, 158, 11, 0.15), transparent)",
            borderLeft: "4px solid #f59e0b",
          }}
        >
          <span style={{ fontSize: "0.9rem", color: "var(--color-secondary)" }}>En Proceso</span>
          <h2 style={{ fontSize: "2rem", margin: "10px 0 0 0", color: "#f59e0b" }}>{inProgressCount}</h2>
        </div>
        <div
          className="glass-panel"
          style={{
            background: "linear-gradient(135deg, rgba(16, 185, 129, 0.15), transparent)",
            borderLeft: "4px solid #10b981",
          }}
        >
          <span style={{ fontSize: "0.9rem", color: "var(--color-secondary)" }}>Completados</span>
          <h2 style={{ fontSize: "2rem", margin: "10px 0 0 0", color: "#10b981" }}>{completedCount}</h2>
        </div>
        <div
          className="glass-panel"
          style={{
            background: "linear-gradient(135deg, rgba(16, 185, 129, 0.25), transparent)",
            borderLeft: "4px solid #10b981",
          }}
        >
          <span style={{ fontSize: "0.9rem", color: "var(--color-secondary)" }}>Ingresos Estimados</span>
          <h2 style={{ fontSize: "2rem", margin: "10px 0 0 0", color: "#fff" }}>${totalCost.toFixed(2)}</h2>
        </div>
      </div>

      {/* Filter bar */}
      <div className="glass-panel" style={{ display: "flex", gap: "15px", flexWrap: "wrap", alignItems: "center" }}>
        {/* Search */}
        <div style={{ flex: 1, minWidth: "200px" }}>
          <input
            type="text"
            placeholder="🔍 Buscar por cliente o tipo de servicio..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 15px",
              background: "rgba(0,0,0,0.5)",
              border: "1px solid var(--color-primary)",
              borderRadius: "6px",
              color: "white",
            }}
          />
        </div>

        {/* Technician Filter */}
        <div style={{ minWidth: "180px" }}>
          <select
            value={techFilter}
            onChange={(e) => setTechFilter(e.target.value)}
            style={{
              width: "100%",
              padding: "10px",
              background: "rgba(0,0,0,0.5)",
              border: "1px solid var(--color-primary)",
              borderRadius: "6px",
              color: "white",
            }}
          >
            <option value="all">👥 Todos los Técnicos</option>
            {uniqueTechnicians.map((t) => (
              <option key={t} value={t}>
                👤 {t}
              </option>
            ))}
            <option value="Juan Plomero">Juan Plomero</option>
            <option value="Pedro Electricista">Pedro Electricista</option>
            <option value="Sofía Instaladora">Sofía Instaladora</option>
            <option value="Carlos Herrero">Carlos Herrero</option>
          </select>
        </div>

        {/* Status Filter tabs */}
        <div style={{ display: "flex", gap: "5px" }}>
          {[
            { id: "all", label: "Todos" },
            { id: "pending", label: "Pendiente" },
            { id: "in_progress", label: "En Proceso" },
            { id: "completed", label: "Completado" },
            { id: "cancelled", label: "Cancelado" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className="btn-primary"
              style={{
                padding: "8px 14px",
                fontSize: "0.85rem",
                opacity: statusFilter === tab.id ? 1 : 0.4,
                background: statusFilter === tab.id ? "var(--color-primary)" : "transparent",
                color: statusFilter === tab.id ? "black" : "white",
                border: "1px solid var(--color-primary)",
                borderRadius: "6px",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Services List Grid */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--color-secondary)" }}>
          Cargando agenda de servicios...
        </div>
      ) : filteredServices.length === 0 ? (
        <div
          className="glass-panel"
          style={{
            textAlign: "center",
            padding: "50px",
            color: "var(--color-secondary)",
            border: "1px dashed rgba(255,255,255,0.1)",
          }}
        >
          📅 No hay citas registradas para los filtros seleccionados.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: "20px" }}>
          {filteredServices.map((service) => {
            const formattedDate = new Date(service.scheduled_at).toLocaleString("es-MX", {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });

            // Color code states
            let statusColor = "#3b82f6"; // pending
            let statusBg = "rgba(59, 130, 246, 0.15)";
            let statusText = "Pendiente";
            if (service.status === "in_progress") {
              statusColor = "#f59e0b";
              statusBg = "rgba(245, 158, 11, 0.15)";
              statusText = "En Proceso";
            } else if (service.status === "completed") {
              statusColor = "#10b981";
              statusBg = "rgba(16, 185, 129, 0.15)";
              statusText = "Completado";
            } else if (service.status === "cancelled") {
              statusColor = "#ef4444";
              statusBg = "rgba(239, 68, 68, 0.15)";
              statusText = "Cancelado";
            }

            const isWithin24Hours = (new Date(service.scheduled_at).getTime() - new Date().getTime()) > 0 && 
                                    (new Date(service.scheduled_at).getTime() - new Date().getTime()) <= 24 * 60 * 60 * 1000;
            const noPhone = !service.customer_phone || service.customer_phone.trim() === "";

            return (
              <div
                key={service.id}
                className="glass-panel animate-fade-in"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  borderLeft: `4px solid ${statusColor}`,
                  boxShadow: `0 4px 20px rgba(0,0,0,0.2)`,
                  position: "relative",
                  gap: "15px",
                  border: isWithin24Hours ? "1px solid #f59e0b" : "none",
                  backgroundColor: isWithin24Hours ? "rgba(245, 158, 11, 0.05)" : "rgba(0,0,0,0.3)"
                }}
              >
                <div>
                  {/* Card Header */}
                  <div className="flex-between" style={{ marginBottom: "10px" }}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <span
                        style={{
                          background: statusBg,
                          color: statusColor,
                          padding: "4px 10px",
                          borderRadius: "4px",
                          fontSize: "0.75rem",
                          fontWeight: "bold",
                          border: `1px solid ${statusColor}40`,
                        }}
                      >
                        {statusText}
                      </span>
                      {isWithin24Hours && service.status !== "completed" && service.status !== "cancelled" && (
                        <span title="Próximas 24 horas" style={{ fontSize: "1.2rem" }}>⏰</span>
                      )}
                      {noPhone && (
                        <span title="Sin teléfono de contacto" style={{ fontSize: "1.2rem" }}>🔴</span>
                      )}
                    </div>
                    <strong style={{ fontSize: "1.1rem", color: "white" }}>${service.cost.toFixed(2)}</strong>
                  </div>

                  {/* Customer Details */}
                  <h3 style={{ margin: "5px 0", color: "#fff", fontSize: "1.2rem" }}>{service.customer_name}</h3>
                  {service.customer_phone && (
                    <p style={{ margin: "2px 0 10px 0", fontSize: "0.85rem", color: "var(--color-secondary)" }}>
                      📞 {service.customer_phone}
                    </p>
                  )}

                  <hr style={{ border: "0", borderTop: "1px solid rgba(255,255,255,0.05)", margin: "10px 0" }} />

                  {/* Details of Service */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "0.9rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--color-secondary)" }}>Servicio:</span>
                      <strong style={{ color: "white" }}>{service.service_type}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--color-secondary)" }}>Técnico:</span>
                      <span style={{ color: "var(--color-accent)", fontWeight: "bold" }}>{service.technician_name}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--color-secondary)" }}>Fecha:</span>
                      <span style={{ color: "white" }}>{formattedDate}</span>
                    </div>
                  </div>

                  {service.notes && (
                    <div
                      style={{
                        background: "rgba(0,0,0,0.2)",
                        padding: "8px 12px",
                        borderRadius: "6px",
                        fontSize: "0.85rem",
                        marginTop: "12px",
                        color: "rgba(255,255,255,0.7)",
                        borderLeft: "2px solid rgba(255,255,255,0.15)",
                      }}
                    >
                      {service.notes}
                    </div>
                  )}
                </div>

                {/* Card Actions */}
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    borderTop: "1px solid rgba(255,255,255,0.05)",
                    paddingTop: "15px",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ display: "flex", gap: "5px" }}>
                    {service.status === "pending" && (
                      <button
                        onClick={() => handleUpdateStatus(service.id, "in_progress")}
                        className="btn-primary"
                        style={{ padding: "6px 12px", fontSize: "0.8rem", background: "#f59e0b", color: "black" }}
                      >
                        ⚡ Iniciar
                      </button>
                    )}
                    {service.status === "in_progress" && (
                      <button
                        onClick={() => handleUpdateStatus(service.id, "completed")}
                        className="btn-primary"
                        style={{ padding: "6px 12px", fontSize: "0.8rem", background: "#10b981", color: "black" }}
                      >
                        ✓ Completar
                      </button>
                    )}
                    {service.status !== "completed" && service.status !== "cancelled" && (
                      <button
                        onClick={() => handleUpdateStatus(service.id, "cancelled")}
                        className="btn-primary"
                        style={{ padding: "6px 12px", fontSize: "0.8rem", background: "#ef4444", color: "white" }}
                      >
                        ✕ Cancelar
                      </button>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: "5px" }}>
                    <button
                      onClick={() => handleOpenModal(service)}
                      style={{
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "1.1rem",
                      }}
                      title="Editar"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleDelete(service.id)}
                      style={{
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "1.1rem",
                      }}
                      title="Eliminar"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CRUD Modal */}
      {showModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            className="glass-panel animate-fade-in"
            style={{
              width: "550px",
              padding: "35px",
              maxHeight: "90vh",
              overflowY: "auto",
              border: "1px solid rgba(16,185,129,0.3)",
              boxShadow: "0 8px 32px 0 rgba(0, 0, 0, 0.5)",
            }}
          >
            <h2 style={{ color: "var(--color-primary)", marginTop: 0, fontSize: "1.5rem" }}>
              {editingService ? "✏️ Editar Cita Técnica" : "📅 Programar Nueva Cita"}
            </h2>
            <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "18px", marginTop: "20px" }}>
              {/* Customer */}
              <div>
                <label style={{ color: "var(--color-secondary)", fontSize: "0.85rem", display: "block", marginBottom: "6px" }}>
                  Nombre del Cliente
                </label>
                <input
                  required
                  type="text"
                  placeholder="Ej. Constructora Alfa"
                  value={formData.customer_name}
                  onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "10px",
                    background: "rgba(0,0,0,0.5)",
                    border: "1px solid var(--color-primary)",
                    borderRadius: "5px",
                    color: "white",
                  }}
                />
              </div>

              {/* Phone & Cost */}
              <div style={{ display: "flex", gap: "15px" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ color: "var(--color-secondary)", fontSize: "0.85rem", display: "block", marginBottom: "6px" }}>
                    Teléfono de Contacto
                  </label>
                  <input
                    type="tel"
                    placeholder="555-0100"
                    value={formData.customer_phone}
                    onChange={(e) => setFormData({ ...formData, customer_phone: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "10px",
                      background: "rgba(0,0,0,0.5)",
                      border: "1px solid var(--color-primary)",
                      borderRadius: "5px",
                      color: "white",
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ color: "var(--color-secondary)", fontSize: "0.85rem", display: "block", marginBottom: "6px" }}>
                    Costo Estimado ($)
                  </label>
                  <input
                    required
                    type="number"
                    value={formData.cost}
                    onChange={(e) => setFormData({ ...formData, cost: Number(e.target.value) })}
                    style={{
                      width: "100%",
                      padding: "10px",
                      background: "rgba(0,0,0,0.5)",
                      border: "1px solid var(--color-primary)",
                      borderRadius: "5px",
                      color: "white",
                    }}
                  />
                </div>
              </div>

              {/* Tech & Service Type */}
              <div style={{ display: "flex", gap: "15px" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ color: "var(--color-secondary)", fontSize: "0.85rem", display: "block", marginBottom: "6px" }}>
                    Técnico Asignado
                  </label>
                  <select
                    value={formData.technician_name}
                    onChange={(e) => setFormData({ ...formData, technician_name: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "10px",
                      background: "rgba(0,0,0,0.5)",
                      border: "1px solid var(--color-primary)",
                      borderRadius: "5px",
                      color: "white",
                    }}
                  >
                    <option value="Juan Plomero">Juan Plomero</option>
                    <option value="Pedro Electricista">Pedro Electricista</option>
                    <option value="Sofía Instaladora">Sofía Instaladora</option>
                    <option value="Carlos Herrero">Carlos Herrero</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ color: "var(--color-secondary)", fontSize: "0.85rem", display: "block", marginBottom: "6px" }}>
                    Tipo de Servicio
                  </label>
                  <select
                    value={formData.service_type}
                    onChange={(e) => setFormData({ ...formData, service_type: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "10px",
                      background: "rgba(0,0,0,0.5)",
                      border: "1px solid var(--color-primary)",
                      borderRadius: "5px",
                      color: "white",
                    }}
                  >
                    <option value="Instalación">Instalación</option>
                    <option value="Plomería">Plomería</option>
                    <option value="Electricidad">Electricidad</option>
                    <option value="Soporte Técnico">Soporte Técnico</option>
                    <option value="Herrería">Herrería</option>
                  </select>
                </div>
              </div>

              {/* Date & Time */}
              <div style={{ display: "flex", gap: "15px" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ color: "var(--color-secondary)", fontSize: "0.85rem", display: "block", marginBottom: "6px" }}>
                    Fecha Programada
                  </label>
                  <input
                    required
                    type="date"
                    value={formData.scheduled_date}
                    onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "10px",
                      background: "rgba(0,0,0,0.5)",
                      border: "1px solid var(--color-primary)",
                      borderRadius: "5px",
                      color: "white",
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ color: "var(--color-secondary)", fontSize: "0.85rem", display: "block", marginBottom: "6px" }}>
                    Hora Programada
                  </label>
                  <input
                    required
                    type="time"
                    value={formData.scheduled_time}
                    onChange={(e) => setFormData({ ...formData, scheduled_time: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "10px",
                      background: "rgba(0,0,0,0.5)",
                      border: "1px solid var(--color-primary)",
                      borderRadius: "5px",
                      color: "white",
                    }}
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label style={{ color: "var(--color-secondary)", fontSize: "0.85rem", display: "block", marginBottom: "6px" }}>
                  Notas / Detalles del Servicio
                </label>
                <textarea
                  rows={3}
                  placeholder="Detalles sobre lo que se necesita hacer, dirección, herramientas requeridas..."
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "10px",
                    background: "rgba(0,0,0,0.5)",
                    border: "1px solid var(--color-primary)",
                    borderRadius: "5px",
                    color: "white",
                    resize: "none",
                  }}
                />
              </div>

              {/* Modal Buttons */}
              <div style={{ display: "flex", gap: "10px", marginTop: "15px" }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{
                    flex: 1,
                    padding: "12px",
                    background: "transparent",
                    border: "1px solid #555",
                    color: "#fff",
                    borderRadius: "5px",
                    cursor: "pointer",
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary"
                  style={{
                    flex: 1,
                    padding: "12px",
                    borderRadius: "5px",
                    cursor: "pointer",
                  }}
                >
                  {loading ? "Guardando..." : "Guardar Visita"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
