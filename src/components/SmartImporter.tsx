"use client";
import { useState, useRef } from "react";
import * as XLSX from "xlsx";

interface SmartImporterProps {
  avgMargin: number;
  onClose: () => void;
  onImport: (products: any[]) => void;
}

export default function SmartImporter({ avgMargin, onClose, onImport }: SmartImporterProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState("");
  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processExcel = async (file: File) => {
    setIsProcessing(true);
    setProgress("🧠 Analizando archivo y calculando márgenes...");
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: "binary" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
        
        if (rawData.length < 2) throw new Error("Documento vacío");

        const headers = rawData[0].map(h => String(h).toLowerCase().trim());
        
        const codeIdx = headers.findIndex(h => h.includes("codigo") || h.includes("código"));
        const nameIdx = headers.findIndex(h => h.includes("nombre") || h.includes("descrip"));
        const costIdx = headers.findIndex(h => h.includes("costo") || h === "aa" || h.includes("iva") || h.includes("compra"));
        const stockIdx = headers.findIndex(h => h.includes("stock") || h.includes("cantidad") || h.includes("totales") || h.includes("almacen"));

        const finalNameIdx = nameIdx >= 0 ? nameIdx : 1; 
        const finalCostIdx = costIdx >= 0 ? costIdx : 5; 
        const finalStockIdx = stockIdx >= 0 ? stockIdx : 4; 
        const finalCodeIdx = codeIdx >= 0 ? codeIdx : 0; 

        // NLP Limpiador: Quitar dobles espacios y capitalizar "tHINNEr" -> "Thinner"
        const cleanAndCapitalize = (str: string) => {
          return str.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        };

        const importedProducts: any[] = [];
        for (let i = 1; i < rawData.length; i++) {
          const row = rawData[i];
          if (!row || !row[finalNameIdx]) continue;
          
          let rawCost = Number(row[finalCostIdx]);
          if (isNaN(rawCost) && typeof row[finalCostIdx] === 'string') {
            rawCost = Number(row[finalCostIdx].replace(/[^0-9.-]+/g,""));
          }
          if (isNaN(rawCost)) rawCost = 0;

          const calculatedPrice = rawCost * (1 + avgMargin);
          const rawCode = row[finalCodeIdx] ? String(row[finalCodeIdx]).trim() : `SKU-${Date.now()}-${i}`;
          const cleanName = cleanAndCapitalize(String(row[finalNameIdx]));

          importedProducts.push({
            id: `imp-${Date.now()}-${i}`,
            code: rawCode,
            name: cleanName,
            cost: rawCost,
            price: calculatedPrice,
            stock: Number(row[finalStockIdx]) || 0,
            supplier: "Pendiente",
            minStock: 5,
            salesIndex: 50,
            autoPriced: true
          });
        }

        setTimeout(() => {
          setPreviewData(importedProducts);
          setIsProcessing(false);
        }, 1000);

      } catch (err) {
        alert("Error al leer el Excel. Revisa el formato de columnas.");
        setIsProcessing(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleFileSelection = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === "xlsx" || ext === "xls" || ext === "csv") processExcel(file);
    else alert("Formato no soportado aún para tablas completas. Sube un XLSX.");
  };

  const confirmImport = () => {
    if (previewData) {
      const globalSupplier = window.prompt("🏢 Nombra al Proveedor General para asignar a todos estos productos:");
      if (!globalSupplier) return;

      let areaChar = "C";
      let areaNum = 1;
      
      const finalProducts = previewData.map(p => {
        const assignedLocation = `${areaChar}-${areaNum}`;
        areaNum++;
        if (areaNum > 20) { areaNum = 1; areaChar = String.fromCharCode(areaChar.charCodeAt(0) + 1); }
        return { ...p, supplier: globalSupplier, location: assignedLocation };
      });

      onImport(finalProducts);
      onClose();
    }
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="glass-panel animate-fade-in" style={{ width: previewData ? '800px' : '500px', textAlign: 'center', padding: '40px', position: 'relative', border: '1px solid var(--color-primary)' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: '15px', right: '15px', background: 'transparent', color: 'white', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}>✖</button>
        
        {previewData ? (
          <div className="animate-fade-in">
            <h2 style={{ color: 'var(--color-primary)', marginBottom: '10px' }}>👀 Revisión y Precios Calculados (AUTO)</h2>
            <p style={{ color: 'var(--color-secondary)', marginBottom: '20px' }}>ERIKA ha limpiado los textos y extraído los costos. Revisa que estén correctos antes de importar.</p>
            
            <div style={{ maxHeight: '300px', overflowY: 'auto', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '10px', marginBottom: '20px' }}>
              <table style={{ width: '100%', fontSize: '0.85rem', textAlign: 'left', borderCollapse: 'collapse' }}>
                <thead style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <tr style={{ color: 'var(--color-secondary)' }}>
                    <th style={{ padding: '8px' }}>CÓDIGO</th>
                    <th style={{ padding: '8px' }}>Producto (Texto Limpio)</th>
                    <th style={{ padding: '8px' }}>Stock</th>
                    <th style={{ padding: '8px' }}>Costo</th>
                    <th style={{ padding: '8px', color: 'white', background: 'rgba(16, 185, 129, 0.2)' }}>Precio Venta (AUTO)</th>
                  </tr>
                </thead>
                <tbody>
                  {previewData.slice(0, 50).map((p, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '8px' }}>{p.code}</td>
                      <td style={{ padding: '8px' }}>{p.name}</td>
                      <td style={{ padding: '8px' }}>{p.stock}</td>
                      <td style={{ padding: '8px' }}>${p.cost.toFixed(2)}</td>
                      <td style={{ padding: '8px', background: 'rgba(16, 185, 129, 0.1)', fontWeight: 'bold' }}>${p.price.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: '15px', justifyContent: 'center' }}>
              <button className="btn-primary" onClick={() => setPreviewData(null)} style={{ background: 'transparent', border: '1px solid var(--color-primary)' }}>Cancelar</button>
              <button className="btn-primary" onClick={confirmImport} style={{ background: 'var(--color-primary)' }}>✅ Asignar Proveedor y Ubicar</button>
            </div>
          </div>
        ) : (
          <div>
            <h2 style={{ color: 'var(--color-primary)', marginBottom: '10px' }}>⚡ Subir Facturas / Costos</h2>
            <p style={{ color: 'var(--color-text)', opacity: 0.8, marginBottom: '25px', fontSize: '0.9rem' }}>Sube tu Excel. La Inteligencia Artificial limpiará los textos feos y protegerá contra duplicados.</p>
            {isProcessing ? (
               <div style={{ padding: '40px 0' }}><p style={{ color: 'var(--color-secondary)' }}>{progress}</p></div>
            ) : (
              <div>
                <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files && handleFileSelection(e.target.files[0])} />
                <button onClick={() => fileInputRef.current?.click()} className="btn-primary" style={{ padding: '20px', width: '100%', marginBottom: '20px' }}>📁 Buscar Archivo Excel</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
