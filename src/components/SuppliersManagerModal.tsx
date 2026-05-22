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

  // Historial states
  const [historyModalSupplier, setHistoryModalSupplier] = useState<Supplier | null>(null);
  const [supplierHistory, setSupplierHistory] = useState<any[]>([]);
  
  // WhatsApp Dropdown state
  const [waMenuOpen, setWaMenuOpen] = useState<string | null>(null);

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

  const handleWhatsApp = async (supplier: Supplier, template: "Pedido" | "Cotización" | "Garantía") => {
    if (!supplier.phone) return alert("El proveedor no tiene teléfono.");
    const cleanPhone = supplier.phone.replace(/\D/g, "");
    
    let msg = "";
    if (template === 'Pedido') {
      msg = encodeURIComponent(`Hola ${supplier.contact_name || supplier.name}, necesitamos realizar un pedido para Ferretería Erika...\n`);
    } else if (template === 'Cotización') {
      msg = encodeURIComponent(`Hola ${supplier.contact_name || supplier.name}, ¿podrías apoyarnos con la cotización de los siguientes materiales para Ferretería Erika?...\n`);
    } else {
      msg = encodeURIComponent(`Hola ${supplier.contact_name || supplier.name}, tenemos un tema de garantía con un producto de Ferretería Erika...\n`);
    }

    // Registrar historial
    await supabase.from("supplier_orders").insert({
       supplier_id: supplier.id,
       action_type: template,
       notes: `Mensaje de WhatsApp (${template})`
    });

    setWaMenuOpen(null);
    window.open(`https://wa.me/${cleanPhone}?text=${msg}`, "_blank");
  };

  const handleCall = async (supplier: Supplier) => {
    if (!supplier.phone) return alert("El proveedor no tiene teléfono.");
    await supabase.from("supplier_orders").insert({ supplier_id: supplier.id, action_type: 'Llamada', notes: "Llamada iniciada" });
    window.open(`tel:${supplier.phone}`);
  };

  const handleEmail = async (supplier: Supplier) => {
    if (!supplier.email) return alert("El proveedor no tiene correo electrónico.");
    await supabase.from("supplier_orders").insert({ supplier_id: supplier.id, action_type: 'Email', notes: "Correo electrónico enviado" });
    window.open(`mailto:${supplier.email}?subject=Pedido Ferretería Erika&body=Hola ${supplier.contact_name || supplier.name},`);
  };

  const fetchHistory = async (supplier: Supplier) => {
    setHistoryModalSupplier(supplier);
    const { data, error } = await supabase.from("supplier_orders").select("*").eq("supplier_id", supplier.id).order("created_at", { ascending: false });
    if (!error && data) {
      setSupplierHistory(data);
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
        style={{ width: "900px", maxWidth: "95%", maxHeight: "90vh", display: "flex", flexDirection: "column", position: "relative" }}
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
              <div style={{ overflowY: "auto", flex: 1, paddingBottom: "150px" }}>
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
                        <td style={{ padding: "15px", fontWeight: "bold" }}>
                          {s.name}
                          <div style={{ marginTop: "5px" }}>
                            <button 
                                onClick={() => fetchHistory(s)}
                                style={{ background: "transparent", border: "1px solid var(--color-secondary)", color: "var(--color-secondary)", fontSize: "0.75rem", padding: "2px 6px", borderRadius: "4px", cursor: "pointer" }}
                            >
                                📜 Ver Historial
                            </button>
                          </div>
                        </td>
                        <td style={{ padding: "15px" }}>
                          <div>{s.contact_name}</div>
                          <div style={{ fontSize: "0.8rem", color: "var(--color-secondary)" }}>{s.phone} | {s.email}</div>
                        </td>
                        <td style={{ padding: "15px", display: "flex", gap: "10px", justifyContent: "center", position: "relative" }}>
                          
                          {/* WhatsApp Dropdown */}
                          <div style={{ position: "relative" }}>
                              <button 
                                onClick={() => setWaMenuOpen(waMenuOpen === s.id ? null : s.id)}
                                title="Enviar WhatsApp"
                                style={{ background: "#25D366", color: "white", border: "none", padding: "8px 12px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold", display: "flex", alignItems: "center", gap: "5px" }}
                              >
                                💬 WhatsApp ▾
                              </button>

                              {waMenuOpen === s.id && (
                                  <div style={{ position: "absolute", top: "100%", left: 0, marginTop: "5px", background: "#1a1a1a", border: "1px solid #333", borderRadius: "8px", zIndex: 100, width: "150px", overflow: "hidden", boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}>
                                      <button onClick={() => handleWhatsApp(s, "Pedido")} style={{ display: "block", width: "100%", padding: "10px", textAlign: "left", background: "transparent", border: "none", color: "white", borderBottom: "1px solid #333", cursor: "pointer" }}>📝 Pedido</button>
                                      <button onClick={() => handleWhatsApp(s, "Cotización")} style={{ display: "block", width: "100%", padding: "10px", textAlign: "left", background: "transparent", border: "none", color: "white", borderBottom: "1px solid #333", cursor: "pointer" }}>💰 Cotización</button>
                                      <button onClick={() => handleWhatsApp(s, "Garantía")} style={{ display: "block", width: "100%", padding: "10px", textAlign: "left", background: "transparent", border: "none", color: "white", cursor: "pointer" }}>🛡️ Garantía</button>
                                  </div>
                              )}
                          </div>

                          <button 
                            onClick={() => handleCall(s)}
                            title="Llamar"
                            style={{ background: "var(--color-accent)", color: "white", border: "none", padding: "8px 12px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}
                          >
                            📞 Llamar
                          </button>
                          <button 
                            onClick={() => handleEmail(s)}
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

        {/* Modal de Historial */}
        {historyModalSupplier && (
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.9)", borderRadius: "16px", padding: "20px", display: "flex", flexDirection: "column", zIndex: 200, backdropFilter: "blur(5px)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                    <h3 style={{ margin: 0, color: "var(--color-primary)" }}>Historial: {historyModalSupplier.name}</h3>
                    <button onClick={() => setHistoryModalSupplier(null)} style={{ background: "transparent", border: "none", color: "white", fontSize: "1.5rem", cursor: "pointer" }}>✖</button>
                </div>
                
                <div style={{ flex: 1, overflowY: "auto" }}>
                    {supplierHistory.length === 0 ? (
                        <div style={{ textAlign: "center", color: "var(--color-secondary)", marginTop: "40px" }}>No hay registros de interacciones con este proveedor.</div>
                    ) : (
                        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                            <thead>
                                <tr style={{ borderBottom: "1px solid #333", color: "var(--color-secondary)" }}>
                                    <th style={{ padding: "10px" }}>Fecha</th>
                                    <th style={{ padding: "10px" }}>Acción</th>
                                    <th style={{ padding: "10px" }}>Notas / Tipo</th>
                                </tr>
                            </thead>
                            <tbody>
                                {supplierHistory.map(h => (
                                    <tr key={h.id} style={{ borderBottom: "1px solid #222" }}>
                                        <td style={{ padding: "10px" }}>{new Date(h.created_at).toLocaleString()}</td>
                                        <td style={{ padding: "10px", fontWeight: "bold" }}>
                                            {h.action_type === "Llamada" ? "📞 Llamada" : h.action_type === "Email" ? "✉️ Email" : `💬 WA: ${h.action_type}`}
                                        </td>
                                        <td style={{ padding: "10px", color: "#bbb" }}>{h.notes}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        )}

      </div>
    </div>
  );
}
