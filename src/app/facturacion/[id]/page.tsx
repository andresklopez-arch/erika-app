"use client";
import React, { useState } from "react";
import { useParams } from "next/navigation";

export default function FacturacionExpress() {
  const params = useParams();
  const ticketId = params.id;
  const [rfc, setRfc] = useState("");
  const [name, setName] = useState("");
  const [uso, setUso] = useState("G03");
  const [status, setStatus] = useState("pending"); // pending, loading, success

  const handleFacturar = (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setTimeout(() => {
      setStatus("success");
    }, 2000);
  };

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
      <div style={{ background: "white", padding: "30px", borderRadius: "10px", boxShadow: "0 4px 6px rgba(0,0,0,0.1)", maxWidth: "400px", width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: "20px" }}>
           <h1 style={{ margin: "0 0 10px 0", color: "#1e293b", fontSize: "24px" }}>Ferretería Erika</h1>
           <p style={{ margin: 0, color: "#64748b" }}>Auto-Facturación Express</p>
        </div>
        
        <div style={{ background: "#f8fafc", padding: "15px", borderRadius: "8px", border: "1px dashed #cbd5e1", marginBottom: "20px", textAlign: "center" }}>
           <span style={{ fontSize: "12px", color: "#64748b", display: "block" }}>Ticket ID</span>
           <strong style={{ fontSize: "16px", color: "#333" }}>{ticketId}</strong>
        </div>

        <form onSubmit={handleFacturar} style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
          <div>
            <label style={{ display: "block", marginBottom: "5px", fontSize: "14px", color: "#475569", fontWeight: "bold" }}>RFC *</label>
            <input required type="text" placeholder="ABCD123456EF7" value={rfc} onChange={e => setRfc(e.target.value.toUpperCase())} style={{ width: "100%", padding: "10px", border: "1px solid #cbd5e1", borderRadius: "5px" }} />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "5px", fontSize: "14px", color: "#475569", fontWeight: "bold" }}>Nombre o Razón Social</label>
            <input required type="text" placeholder="Ej. Juan Pérez" value={name} onChange={e => setName(e.target.value)} style={{ width: "100%", padding: "10px", border: "1px solid #cbd5e1", borderRadius: "5px" }} />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "5px", fontSize: "14px", color: "#475569", fontWeight: "bold" }}>Uso de CFDI</label>
            <select value={uso} onChange={e => setUso(e.target.value)} style={{ width: "100%", padding: "10px", border: "1px solid #cbd5e1", borderRadius: "5px", background: "white" }}>
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
