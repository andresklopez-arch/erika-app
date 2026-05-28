import React, { useState } from "react";
import * as XLSX from "xlsx";
import type { InventoryItem } from "./InventoryModule";

interface AuditModuleProps {
  onClose: () => void;
  inventory: InventoryItem[];
}

export default function AuditModule({ onClose, inventory }: AuditModuleProps) {
  const [auditType, setAuditType] = useState<"total" | "aleatorio" | "recomendado" | "inconsistencias">("total");
  const [randomCount, setRandomCount] = useState(50);
  const [locationFilter, setLocationFilter] = useState("");

  const handleGenerateExcel = () => {
    let itemsToAudit: InventoryItem[] = [];

    switch (auditType) {
      case "total":
        itemsToAudit = [...inventory];
        break;
      case "aleatorio":
        const shuffled = [...inventory].sort(() => 0.5 - Math.random());
        itemsToAudit = shuffled.slice(0, randomCount);
        break;
      case "recomendado":
        // Simulated: items not moved recently or critical ones
        itemsToAudit = inventory.filter(i => i.stock < i.minStock || i.stock === 0).slice(0, 100);
        if (itemsToAudit.length === 0) itemsToAudit = inventory.slice(0, 50); // Fallback
        break;
      case "inconsistencias":
        // Negative stock or high discrepancies (for now just negative stock)
        itemsToAudit = inventory.filter(i => i.stock < 0);
        break;
    }

    if (locationFilter) {
      itemsToAudit = itemsToAudit.filter(i => i.location?.toLowerCase().includes(locationFilter.toLowerCase()));
    }

    if (itemsToAudit.length === 0) {
      alert("No hay productos que cumplan con los criterios seleccionados para el arqueo.");
      return;
    }

    // Sort by location so the employee doesn't walk in circles
    itemsToAudit.sort((a, b) => (a.location || "").localeCompare(b.location || ""));

    const wsData: any[][] = [
      ["BODEGA / UBICACION", "CODIGO", "PRODUCTO", "CATEGORIA / PROVEEDOR", "CANTIDAD ENCONTRADA", "FIRMA / OBSERVACIONES"]
    ];

    itemsToAudit.forEach(item => {
      wsData.push([
        item.location || "Pendiente",
        item.code || "",
        item.name || "",
        item.supplier || "",
        "", // Ciego
        ""
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = [{wch: 20}, {wch: 15}, {wch: 40}, {wch: 20}, {wch: 25}, {wch: 30}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Hoja_Arqueo_Ciego");
    
    const today = new Date();
    const dateStr = `${today.getDate()}-${today.toLocaleString('es-ES', { month: 'short' })}-${today.getFullYear()}`;
    XLSX.writeFile(wb, `ERIKA_Arqueo_${auditType}_${dateStr}.xlsx`);
    onClose();
  };

  const handleInteractiveMode = () => {
    alert("¡Próximamente en Fase 2! El Modo Guiado con IA requerirá cargar la misión primero.");
  };

  return (
    <div style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: "rgba(0,0,0,0.85)",
      backdropFilter: "blur(5px)",
      zIndex: 1000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
    }}>
      <div style={{
        background: "var(--color-bg)",
        border: "1px solid var(--color-primary)",
        borderRadius: "15px",
        padding: "30px",
        width: "100%",
        maxWidth: "600px",
        color: "var(--color-text)",
        boxShadow: "0 0 20px rgba(16, 185, 129, 0.2)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h2 style={{ margin: 0, color: "var(--color-primary)", display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "1.5rem" }}>📋</span> Generador de Arqueos
          </h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "white", fontSize: "1.2rem", cursor: "pointer" }}>✖</button>
        </div>

        <p style={{ opacity: 0.8, marginBottom: "20px", fontSize: "0.9rem" }}>
          Selecciona el tipo de misión de conteo que deseas realizar. ERIKA generará una <strong>Hoja Ciega</strong> (sin mostrar el stock del sistema) para garantizar que el conteo sea físico y real.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "15px", marginBottom: "30px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px", background: auditType === "total" ? "rgba(16, 185, 129, 0.2)" : "rgba(255,255,255,0.05)", borderRadius: "8px", cursor: "pointer" }}>
            <input type="radio" name="auditType" checked={auditType === "total"} onChange={() => setAuditType("total")} />
            <div>
              <strong>Arqueo Total</strong>
              <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>Imprime toda la base de datos (Ideal Cierre de Año)</div>
            </div>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px", background: auditType === "aleatorio" ? "rgba(16, 185, 129, 0.2)" : "rgba(255,255,255,0.05)", borderRadius: "8px", cursor: "pointer" }}>
            <input type="radio" name="auditType" checked={auditType === "aleatorio"} onChange={() => setAuditType("aleatorio")} />
            <div style={{ flex: 1 }}>
              <strong>Arqueo Aleatorio (Muestra Rápida)</strong>
              <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>ERIKA elige productos al azar para auditoría sorpresa.</div>
            </div>
            {auditType === "aleatorio" && (
              <input type="number" value={randomCount} onChange={(e) => setRandomCount(Number(e.target.value))} style={{ width: "60px", padding: "5px", background: "var(--glass-bg)", color: "white", border: "1px solid var(--color-primary)", borderRadius: "4px" }} title="Cantidad de productos a auditar" />
            )}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px", background: auditType === "recomendado" ? "rgba(16, 185, 129, 0.2)" : "rgba(255,255,255,0.05)", borderRadius: "8px", cursor: "pointer" }}>
            <input type="radio" name="auditType" checked={auditType === "recomendado"} onChange={() => setAuditType("recomendado")} />
            <div>
              <strong>Arqueo Recomendado (Inteligente)</strong>
              <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>Productos rezagados o en estado crítico.</div>
            </div>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px", background: auditType === "inconsistencias" ? "rgba(16, 185, 129, 0.2)" : "rgba(255,255,255,0.05)", borderRadius: "8px", cursor: "pointer" }}>
            <input type="radio" name="auditType" checked={auditType === "inconsistencias"} onChange={() => setAuditType("inconsistencias")} />
            <div>
              <strong>Con Inconsistencias</strong>
              <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>Productos con stock negativo o alertas graves.</div>
            </div>
          </label>
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Filtro de Bodega / Pasillo (Opcional):</label>
          <input 
            type="text" 
            placeholder="Ej. Pasillo A, Estante 3..." 
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            style={{ width: "100%", padding: "10px", background: "var(--glass-bg)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "8px", color: "white" }}
          />
        </div>

        <div style={{ display: "flex", gap: "15px", marginTop: "30px" }}>
          <button 
            className="btn-primary" 
            onClick={handleInteractiveMode}
            style={{ flex: 1, background: "rgba(59, 130, 246, 0.2)", color: "#3b82f6", border: "1px solid #3b82f6" }}
          >
            📱 Iniciar Modo Tablet (Guiado IA)
          </button>
          <button 
            className="btn-primary" 
            onClick={handleGenerateExcel}
            style={{ flex: 1, background: "var(--color-primary)", color: "black", border: "none" }}
          >
            📥 Descargar Hoja de Conteo
          </button>
        </div>
      </div>
    </div>
  );
}
