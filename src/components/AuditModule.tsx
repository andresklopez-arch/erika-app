import React, { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import type { InventoryItem } from "./InventoryModule";

interface AuditModuleProps {
  onClose: () => void;
  inventory: InventoryItem[];
}

interface InconsistencyRecord {
  item: InventoryItem;
  expected: number;
  found: number;
}

export default function AuditModule({ onClose, inventory }: AuditModuleProps) {
  const [auditType, setAuditType] = useState<"total" | "aleatorio" | "recomendado" | "inconsistencias">("total");
  const [randomCount, setRandomCount] = useState(50);
  const [locationFilter, setLocationFilter] = useState("");
  const [lastAuditDate, setLastAuditDate] = useState<string | null>(null);

  // Interactive Mode States
  const [isInteractiveMode, setIsInteractiveMode] = useState(false);
  const [missionItems, setMissionItems] = useState<InventoryItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentInput, setCurrentInput] = useState("");
  const [inconsistencies, setInconsistencies] = useState<InconsistencyRecord[]>([]);
  const [missionComplete, setMissionComplete] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedDate = localStorage.getItem("erika_last_audit_date");
      if (storedDate) {
        setLastAuditDate(storedDate);
      }
    }
  }, []);

  const getFilteredItems = (): InventoryItem[] => {
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
        itemsToAudit = inventory.filter(i => i.stock < i.minStock || i.stock === 0).slice(0, 100);
        if (itemsToAudit.length === 0) itemsToAudit = inventory.slice(0, 50);
        break;
      case "inconsistencias":
        itemsToAudit = inventory.filter(i => i.stock < 0);
        break;
    }

    if (locationFilter) {
      itemsToAudit = itemsToAudit.filter(i => i.location?.toLowerCase().includes(locationFilter.toLowerCase()));
    }

    itemsToAudit.sort((a, b) => (a.location || "").localeCompare(b.location || ""));
    return itemsToAudit;
  };

  const saveAuditLog = () => {
    const today = new Date();
    const dateStr = today.toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' });
    if (typeof window !== "undefined") {
      localStorage.setItem("erika_last_audit_date", dateStr);
    }
    setLastAuditDate(dateStr);
  };

  const handleGenerateExcel = () => {
    const itemsToAudit = getFilteredItems();
    if (itemsToAudit.length === 0) {
      alert("No hay productos que cumplan con los criterios seleccionados.");
      return;
    }

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
    const fileDate = `${today.getDate()}-${today.getMonth() + 1}-${today.getFullYear()}`;
    XLSX.writeFile(wb, `ERIKA_Arqueo_${auditType}_${fileDate}.xlsx`);
    
    saveAuditLog();
    onClose();
  };

  const handleInteractiveMode = () => {
    const itemsToAudit = getFilteredItems();
    if (itemsToAudit.length === 0) {
      alert("No hay productos que cumplan con los criterios seleccionados.");
      return;
    }
    setMissionItems(itemsToAudit);
    setIsInteractiveMode(true);
    setCurrentIndex(0);
    setInconsistencies([]);
    setMissionComplete(false);
    saveAuditLog();

    speak(`Misión de arqueo iniciada. Dirígete a la ubicación del primer producto: ${itemsToAudit[0].name}. Bodega: ${itemsToAudit[0].location || 'Pendiente'}`);
  };

  const speak = (text: string) => {
    if (typeof window !== "undefined" && 'speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'es-MX';
      utterance.rate = 1.1;
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleNextItem = (e: React.FormEvent) => {
    e.preventDefault();
    const foundQty = parseInt(currentInput);
    if (isNaN(foundQty)) return;

    const currentItem = missionItems[currentIndex];
    
    // Blind Audit (Option B): Don't tell the employee if they made a mistake
    if (foundQty !== currentItem.stock) {
      setInconsistencies(prev => [...prev, { item: currentItem, expected: currentItem.stock, found: foundQty }]);
    }

    if (currentIndex + 1 < missionItems.length) {
      setCurrentIndex(prev => prev + 1);
      setCurrentInput("");
      const nextItem = missionItems[currentIndex + 1];
      speak(`Siguiente: ${nextItem.name}. Ubicación: ${nextItem.location || 'Pendiente'}`);
    } else {
      setMissionComplete(true);
      speak("Misión completada. Mostrando reporte de inconsistencias al administrador.");
    }
  };

  const handleExportInconsistencies = () => {
    const wsData: any[][] = [
      ["UBICACION", "CODIGO", "PRODUCTO", "ESPERADO (SISTEMA)", "ENCONTRADO (FISICO)", "DIFERENCIA"]
    ];

    inconsistencies.forEach(inc => {
      wsData.push([
        inc.item.location || "Pendiente",
        inc.item.code || "",
        inc.item.name || "",
        inc.expected,
        inc.found,
        inc.found - inc.expected
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inconsistencias");
    XLSX.writeFile(wb, `Reporte_Inconsistencias_${new Date().getTime()}.xlsx`);
  };

  // --- RENDERS ---

  if (isInteractiveMode) {
    if (missionComplete) {
      return (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.95)", zIndex: 1000, display: "flex", flexDirection: "column", padding: "30px", color: "white", overflowY: "auto" }}>
          <div style={{ maxWidth: "800px", margin: "0 auto", width: "100%" }}>
            <h1 style={{ color: "var(--color-primary)", textAlign: "center" }}>🏁 Misión Completada</h1>
            <p style={{ textAlign: "center", fontSize: "1.2rem", marginBottom: "30px" }}>Productos auditados: {missionItems.length}</p>
            
            <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: "10px", padding: "20px" }}>
              <h2 style={{ color: inconsistencies.length > 0 ? "#ef4444" : "#10b981" }}>
                {inconsistencies.length > 0 ? `⚠️ Se encontraron ${inconsistencies.length} inconsistencias (Auditoría Ciega)` : "✅ Inventario Perfecto"}
              </h2>
              
              {inconsistencies.length > 0 && (
                <div style={{ marginTop: "20px" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.2)" }}>
                        <th style={{ padding: "10px" }}>Producto</th>
                        <th style={{ padding: "10px" }}>Ubicación</th>
                        <th style={{ padding: "10px" }}>Físico</th>
                        <th style={{ padding: "10px" }}>Sistema</th>
                        <th style={{ padding: "10px" }}>Dif</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inconsistencies.map((inc, idx) => (
                        <tr key={idx} style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                          <td style={{ padding: "10px" }}>{inc.item.name}</td>
                          <td style={{ padding: "10px" }}>{inc.item.location}</td>
                          <td style={{ padding: "10px", fontWeight: "bold" }}>{inc.found}</td>
                          <td style={{ padding: "10px", opacity: 0.7 }}>{inc.expected}</td>
                          <td style={{ padding: "10px", color: (inc.found - inc.expected) < 0 ? "#ef4444" : "#f59e0b" }}>
                            {inc.found - inc.expected}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button onClick={handleExportInconsistencies} className="btn-primary" style={{ marginTop: "20px", background: "var(--color-primary)", border: "none", color: "black", width: "100%" }}>
                    📥 Exportar Reporte de Mermas (Excel)
                  </button>
                </div>
              )}
            </div>
            
            <button onClick={onClose} style={{ marginTop: "30px", background: "transparent", border: "1px solid white", color: "white", padding: "15px", borderRadius: "8px", width: "100%", cursor: "pointer", fontSize: "1.1rem" }}>
              Cerrar y Salir
            </button>
          </div>
        </div>
      );
    }

    const currentItem = missionItems[currentIndex];
    return (
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.95)", zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "20px", color: "white" }}>
        <div style={{ width: "100%", maxWidth: "500px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", opacity: 0.7, marginBottom: "20px" }}>
            <span>Auditoría Ciega Activa</span>
            <span>Producto {currentIndex + 1} de {missionItems.length}</span>
          </div>
          
          <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "15px", padding: "30px", textAlign: "center", boxShadow: "0 0 30px rgba(59, 130, 246, 0.2)" }}>
            <h3 style={{ color: "#3b82f6", margin: "0 0 10px 0" }}>📍 {currentItem.location || "Ubicación Pendiente"}</h3>
            <h1 style={{ fontSize: "2rem", margin: "0 0 30px 0" }}>{currentItem.name}</h1>
            
            <form onSubmit={handleNextItem}>
              <label style={{ display: "block", fontSize: "1.2rem", marginBottom: "15px" }}>Cantidad Física Encontrada:</label>
              <input 
                type="number" 
                value={currentInput}
                onChange={e => setCurrentInput(e.target.value)}
                autoFocus
                style={{ width: "100%", fontSize: "3rem", textAlign: "center", padding: "20px", borderRadius: "10px", background: "var(--color-bg)", color: "var(--color-primary)", border: "2px solid #3b82f6" }}
                placeholder="0"
              />
              <button type="submit" className="btn-primary" style={{ width: "100%", padding: "20px", fontSize: "1.5rem", marginTop: "20px", background: "#3b82f6", border: "none", color: "white" }} disabled={currentInput === ""}>
                Confirmar y Siguiente ➡️
              </button>
            </form>
          </div>

          <button onClick={() => { if(confirm("¿Abandonar la misión? Se perderá el progreso.")) setIsInteractiveMode(false); }} style={{ background: "transparent", border: "none", color: "#ef4444", marginTop: "30px", width: "100%", padding: "15px", cursor: "pointer", fontSize: "1.1rem" }}>
            🛑 Abortar Misión
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(5px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px",
    }}>
      <div style={{
        background: "var(--color-bg)", border: "1px solid var(--color-primary)", borderRadius: "15px", padding: "30px", width: "100%", maxWidth: "600px", color: "var(--color-text)", boxShadow: "0 0 20px rgba(16, 185, 129, 0.2)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
          <h2 style={{ margin: 0, color: "var(--color-primary)", display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "1.5rem" }}>📋</span> Misiones de Arqueo
          </h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "white", fontSize: "1.2rem", cursor: "pointer" }}>✖</button>
        </div>

        {lastAuditDate && (
          <div style={{ background: "rgba(168, 85, 247, 0.1)", border: "1px solid rgba(168, 85, 247, 0.3)", padding: "10px", borderRadius: "8px", marginBottom: "15px", color: "#d8b4fe", fontSize: "0.9rem" }}>
            <strong>⏱️ Última misión asignada:</strong> {lastAuditDate}
          </div>
        )}

        <p style={{ opacity: 0.8, marginBottom: "20px", fontSize: "0.9rem" }}>
          Genera una misión ciega. Puedes imprimirla en Excel o usar el <strong>Modo Interactivo</strong>.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
          {["total", "aleatorio", "recomendado", "inconsistencias"].map((type) => (
            <label key={type} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px", background: auditType === type ? "rgba(16, 185, 129, 0.2)" : "rgba(255,255,255,0.05)", borderRadius: "8px", cursor: "pointer" }}>
              <input type="radio" name="auditType" checked={auditType === type} onChange={() => setAuditType(type as any)} />
              <div style={{ flex: 1, textTransform: "capitalize" }}>
                <strong>{type === "inconsistencias" ? "Solo Inconsistencias" : `Arqueo ${type}`}</strong>
              </div>
              {type === "aleatorio" && auditType === "aleatorio" && (
                <input type="number" value={randomCount} onChange={(e) => setRandomCount(Number(e.target.value))} style={{ width: "60px", padding: "5px", background: "var(--glass-bg)", color: "white", border: "1px solid var(--color-primary)", borderRadius: "4px" }} />
              )}
            </label>
          ))}
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Filtro Específico (Bodega, Proveedor, Nombre):</label>
          <input 
            type="text" 
            placeholder="Ej. Pasillo A, Truper, Martillo..." 
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            style={{ width: "100%", padding: "10px", background: "var(--glass-bg)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "8px", color: "white" }}
          />
        </div>

        <div style={{ display: "flex", gap: "15px", marginTop: "20px" }}>
          <button onClick={handleInteractiveMode} style={{ flex: 1, background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", color: "white", border: "none", padding: "15px", borderRadius: "8px", cursor: "pointer", fontWeight: "bold", fontSize: "1.1rem" }}>
            📱 Modo Interactivo (Voz IA)
          </button>
          <button onClick={handleGenerateExcel} style={{ flex: 1, background: "var(--color-primary)", color: "black", border: "none", padding: "15px", borderRadius: "8px", cursor: "pointer", fontWeight: "bold", fontSize: "1.1rem" }}>
            📥 Descargar Excel (Ciego)
          </button>
        </div>
      </div>
    </div>
  );
}
