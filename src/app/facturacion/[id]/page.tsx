"use client";
import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

export default function FacturacionExpress() {
  const params = useParams();
  const ticketId = params.id as string;
  const [rfc, setRfc] = useState("");
  const [name, setName] = useState("");
  const [uso, setUso] = useState("G03");
  const [status, setStatus] = useState("loading_ticket"); // loading_ticket, pending, loading, success, error
  const [errorMsg, setErrorMsg] = useState("");
  const [ticketData, setTicketData] = useState<any>(null);

  useEffect(() => {
    const fetchTicket = async () => {
       // 1. Intentar buscar por token en invoice_claims
       const { data: claim, error: claimError } = await supabase
          .from("invoice_claims")
          .select("*")
          .eq("token", ticketId)
          .single();

       if (!claimError && claim) {
          if (claim.claimed) {
             setStatus("error");
             setErrorMsg("Esta factura ya ha sido reclamada o procesada.");
             return;
          }
          // Si encontramos el reclamo, buscamos el ticket por su ticket_id
          const { data: ticket, error: ticketError } = await supabase
             .from("quotes")
             .select("*")
             .eq("id", claim.ticket_id)
             .single();

          if (ticketError || !ticket) {
             setStatus("error");
             setErrorMsg("El ticket asociado no se pudo encontrar.");
          } else {
             setTicketData(ticket);
             setStatus("pending");
          }
       } else {
          // Fallback: buscar directamente en quotes por ID (por si no se ha migrado la tabla o es un ticket antiguo)
          const { data: ticket, error: ticketError } = await supabase
             .from("quotes")
             .select("*")
             .eq("id", ticketId)
             .single();

          if (ticketError || !ticket) {
             setStatus("error");
             setErrorMsg("Ticket no encontrado o token invalido.");
          } else if (ticket.status !== "ticket") {
             setStatus("error");
             setErrorMsg("Este ticket ya ha sido facturado o no esta disponible.");
          } else {
             setTicketData(ticket);
             setStatus("pending");
          }
       }
    };
    if (ticketId) fetchTicket();
  }, [ticketId]);

  const handleFacturar = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    
    try {
      const res = await fetch("/api/facturacion", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
            ticketId: ticketData.id, // Enviar el ID real del ticket
            rfc,
            name,
            uso,
            items: ticketData.items,
            total: ticketData.total
         })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al facturar.");
      
      // Marcar el token como reclamado en invoice_claims
      try {
         await supabase
            .from("invoice_claims")
            .update({ claimed: true })
            .eq("token", ticketId);
      } catch (err) {
         console.warn("No se pudo marcar el token como reclamado en la BD:", err);
      }

      // Marcar el ticket como facturado (converted) en la tabla quotes
      try {
         await supabase
            .from("quotes")
            .update({ status: "converted" })
            .eq("id", ticketData.id);
      } catch (err) {
         console.warn("No se pudo actualizar el estado del ticket en quotes:", err);
      }

      setStatus("success");
    } catch (err: any) {
      alert(err.message);
      setStatus("pending");
    }
  };

  if (status === "loading_ticket") {
     return <div style={{ padding: "50px", textAlign: "center" }}>Buscando tu ticket...</div>;
  }

  if (status === "error") {
     return <div style={{ padding: "50px", textAlign: "center", color: "red" }}>{errorMsg}</div>;
  }

  if (status === "success") {
     return (
       <div style={{ minHeight: "100vh", background: "#f0f2f5", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
         <div style={{ background: "white", padding: "40px", borderRadius: "10px", boxShadow: "0 4px 6px rgba(0,0,0,0.1)", textAlign: "center", maxWidth: "400px" }}>
           <h1 style={{ color: "#10b981", fontSize: "48px", margin: "0 0 20px 0" }}>✅</h1>
           <h2 style={{ color: "#1e293b", marginBottom: "10px" }}>¡Factura Generada!</h2>
           <p style={{ color: "#64748b", marginBottom: "20px" }}>Hemos timbrado tu comprobante fiscal exitosamente y ha sido enviado al portal del SAT. Los archivos XML y PDF también han sido descargados en este dispositivo.</p>
           <button onClick={() => window.location.href = "/"} style={{ background: "#3b82f6", color: "white", border: "none", padding: "10px 20px", borderRadius: "5px", cursor: "pointer", width: "100%" }}>Cerrar</button>
         </div>
       </div>
     );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f0f2f5", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      <div style={{ background: "white", padding: "30px", borderRadius: "10px", boxShadow: "0 4px 6px rgba(0,0,0,0.1)", maxWidth: "500px", width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: "20px" }}>
           <h1 style={{ margin: "0 0 10px 0", color: "#1e293b", fontSize: "24px" }}>Ferretería Erika</h1>
           <p style={{ margin: 0, color: "#64748b" }}>Auto-Facturación Express</p>
        </div>
        
        <div style={{ background: "#f8fafc", padding: "15px", borderRadius: "8px", border: "1px dashed #cbd5e1", marginBottom: "20px" }}>
           <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
              <span style={{ fontSize: "12px", color: "#64748b" }}>Ticket ID</span>
              <strong style={{ fontSize: "14px", color: "#333" }}>#{ticketId}</strong>
           </div>
           <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: "10px", marginBottom: "10px" }}>
              <strong style={{ fontSize: "12px", color: "#475569" }}>Resumen de Compra:</strong>
              <ul style={{ paddingLeft: "20px", margin: "5px 0", fontSize: "12px", color: "#334155" }}>
                 {ticketData?.items?.map((item: any, i: number) => (
                    <li key={i}>{item.qty}x {item.name} - ${(item.qty * item.price).toFixed(2)}</li>
                 ))}
              </ul>
           </div>
           <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #e2e8f0", paddingTop: "10px" }}>
              <span style={{ fontSize: "14px", color: "#64748b" }}>Total Facturable:</span>
              <strong style={{ fontSize: "18px", color: "#10b981" }}>${ticketData?.total?.toFixed(2)}</strong>
           </div>
        </div>

        <form onSubmit={handleFacturar} style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
          <div>
            <label style={{ display: "block", marginBottom: "5px", fontSize: "14px", color: "#475569", fontWeight: "bold" }}>RFC *</label>
            <input required type="text" placeholder="ABCD123456EF7" value={rfc} onChange={e => setRfc(e.target.value.toUpperCase())} style={{ width: "100%", padding: "10px", border: "1px solid #cbd5e1", borderRadius: "5px", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "5px", fontSize: "14px", color: "#475569", fontWeight: "bold" }}>Nombre o Razón Social</label>
            <input required type="text" placeholder="Ej. Juan Pérez" value={name} onChange={e => setName(e.target.value)} style={{ width: "100%", padding: "10px", border: "1px solid #cbd5e1", borderRadius: "5px", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "5px", fontSize: "14px", color: "#475569", fontWeight: "bold" }}>Uso de CFDI</label>
            <select value={uso} onChange={e => setUso(e.target.value)} style={{ width: "100%", padding: "10px", border: "1px solid #cbd5e1", borderRadius: "5px", background: "white", boxSizing: "border-box" }}>
               <option value="G03">G03 - Gastos en general</option>
               <option value="G01">G01 - Adquisición de mercancías</option>
               <option value="P01">P01 - Por definir</option>
            </select>
          </div>
          
          <button type="submit" disabled={status === "loading"} style={{ marginTop: "10px", padding: "12px", background: "#10b981", color: "white", border: "none", borderRadius: "5px", fontSize: "16px", fontWeight: "bold", cursor: "pointer" }}>
            {status === "loading" ? "Timbrando Factura..." : "Generar Factura Electrónica"}
          </button>
        </form>
      </div>
    </div>
  );
}
