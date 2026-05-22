"use client";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

interface Supplier {
  id: string;
  name: string;
  phone: string;
  email: string;
  contact_name: string;
  notes: string;
}

interface SuppliersManagerModalProps {
  onClose: () => void;
}

export default function SuppliersManagerModal({ onClose }: SuppliersManagerModalProps) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Form states
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");

  const fetchSuppliers = async () => {
    setIsLoading(true);
    const { data, error } = await supabase.from("suppliers").select("*").order("name");
    if (!error && data) setSuppliers(data);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("suppliers").insert({
      name,
      contact_name: contactName,
      phone,
      email,
      notes,
    });
    if (error) {
      alert("Error al guardar. Asegúrate de haber ejecutado el script SQL en Supabase para crear la tabla 'suppliers'.");
      console.error(error);
    } else {
      alert("✅ Proveedor registrado.");
      setIsAdding(false);
      setName(""); setContactName(""); setPhone(""); setEmail(""); setNotes("");
      fetchSuppliers();
    }
  };

  const handleWhatsApp = (phone: string, name: string) => {
    if (!phone) return alert("El proveedor no tiene teléfono.");
    const cleanPhone = phone.replace(/\D/g, "");
    const msg = encodeURIComponent(`Hola ${name}, necesitamos realizar un pedido para Ferretería Erika. ¿Me puedes enviar tu lista de precios actualizada?`);
    window.open(`https://wa.me/${cleanPhone}?text=${msg}`, "_blank");
  };

  const handleCall = (phone: string) => {
    if (!phone) return alert("El proveedor no tiene teléfono.");
    window.open(`tel:${phone}`);
  };

  const handleEmail = (email: string, name: string) => {
    if (!email) return alert("El proveedor no tiene correo electrónico.");
    window.open(`mailto:${email}?subject=Pedido Ferretería Erika&body=Hola ${name},`);
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
        style={{ width: "800px", maxWidth: "95%", maxHeight: "90vh", display: "flex", flexDirection: "column", position: "relative" }}
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
          🏭 Gestión de Proveedores y Pedidos
        </h2>

        {!isAdding ? (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "15px" }}>
              <button className="btn-primary" onClick={() => setIsAdding(true)}>
                ➕ Agregar Nuevo Proveedor
              </button>
            </div>
            
            {isLoading ? (
              <div style={{ textAlign: "center", padding: "20px", color: "var(--color-secondary)" }}>Cargando proveedores...</div>
            ) : suppliers.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px", background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
                No hay proveedores registrados aún.
              </div>
            ) : (
              <div style={{ overflowY: "auto", flex: 1 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                  <thead style={{ background: "rgba(255,255,255,0.05)", borderBottom: "1px solid var(--glass-border)" }}>
                    <tr>
                      <th style={{ padding: "12px" }}>Proveedor</th>
                      <th style={{ padding: "12px" }}>Contacto</th>
                      <th style={{ padding: "12px", textAlign: "center" }}>Acciones Rápidas (Pedidos)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.map(s => (
                      <tr key={s.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        <td style={{ padding: "15px", fontWeight: "bold" }}>{s.name}</td>
                        <td style={{ padding: "15px" }}>
                          <div>{s.contact_name}</div>
                          <div style={{ fontSize: "0.8rem", color: "var(--color-secondary)" }}>{s.phone} | {s.email}</div>
                        </td>
                        <td style={{ padding: "15px", display: "flex", gap: "10px", justifyContent: "center" }}>
                          <button 
                            onClick={() => handleWhatsApp(s.phone, s.contact_name || s.name)}
                            title="Enviar WhatsApp"
                            style={{ background: "#25D366", color: "white", border: "none", padding: "8px 12px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}
                          >
                            💬 WhatsApp
                          </button>
                          <button 
                            onClick={() => handleCall(s.phone)}
                            title="Llamar"
                            style={{ background: "var(--color-accent)", color: "white", border: "none", padding: "8px 12px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}
                          >
                            📞 Llamar
                          </button>
                          <button 
                            onClick={() => handleEmail(s.email, s.contact_name || s.name)}
                            title="Enviar Correo"
                            style={{ background: "var(--color-primary)", color: "white", border: "none", padding: "8px 12px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}
                          >
                            ✉️ Email
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <form onSubmit={handleSave} className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
            <div style={{ display: "flex", gap: "15px" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", marginBottom: "5px", color: "var(--color-secondary)" }}>Empresa / Marca *</label>
                <input required value={name} onChange={e => setName(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} placeholder="Ej. Truper" />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", marginBottom: "5px", color: "var(--color-secondary)" }}>Nombre del Agente/Contacto</label>
                <input value={contactName} onChange={e => setContactName(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} placeholder="Ej. Roberto Sánchez" />
              </div>
            </div>
            
            <div style={{ display: "flex", gap: "15px" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", marginBottom: "5px", color: "var(--color-secondary)" }}>Teléfono (WhatsApp/Llamada) *</label>
                <input required type="tel" value={phone} onChange={e => setPhone(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--color-primary)", background: "rgba(0,0,0,0.3)", color: "white" }} placeholder="+52 55 1234 5678" />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", marginBottom: "5px", color: "var(--color-secondary)" }}>Correo Electrónico</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} placeholder="ventas@empresa.com" />
              </div>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "5px", color: "var(--color-secondary)" }}>Notas Adicionales</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white", minHeight: "80px" }} placeholder="Ej. Entregan los martes antes del mediodía." />
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
              <button type="button" onClick={() => setIsAdding(false)} style={{ flex: 1, padding: "12px", borderRadius: "8px", background: "transparent", border: "1px solid var(--glass-border)", color: "white", cursor: "pointer" }}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" style={{ flex: 2, padding: "12px", fontSize: "1.1rem" }}>
                💾 Guardar Proveedor
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
