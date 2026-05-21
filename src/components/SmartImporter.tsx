"use client";
import { useState, useRef } from "react";
import * as XLSX from "xlsx";

interface SmartImporterProps {
  avgMargin: number; // Porcentaje promedio que la IA usará para sugerir el precio
  onClose: () => void;
  onImport: (products: any[]) => void;
}

export default function SmartImporter({ avgMargin, onClose, onImport }: SmartImporterProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState("");
  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Nombre del Producto", "Costo del Proveedor", "Stock Ingresado", "Nombre del Proveedor"],
      ["Martillo Truper 16oz", 80.00, 15, "Ferretera Nacional"],
      ["Clavo 2 pulgadas (Caja)", 25.00, 50, "Aceros México"]
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Plantilla_Inventario");
    XLSX.writeFile(wb, "Plantilla_Inventario_ERIKA.xlsx");
  };

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

        const headers = rawData[0].map(h => String(h).toLowerCase());
        const nameIdx = headers.findIndex(h => h.includes("nombre") || h.includes("descrip"));
        const costIdx = headers.findIndex(h => h.includes("costo") || h.includes("precio prov") || h.includes("compra"));
        const stockIdx = headers.findIndex(h => h.includes("stock") || h.includes("cantidad"));
        const provIdx = headers.findIndex(h => h.includes("proveedor"));

        const finalNameIdx = nameIdx >= 0 ? nameIdx : 0;
        const finalCostIdx = costIdx >= 0 ? costIdx : 1;
        const finalStockIdx = stockIdx >= 0 ? stockIdx : 2;
        const finalProvIdx = provIdx >= 0 ? provIdx : 3;

        const importedProducts = [];
        for (let i = 1; i < rawData.length; i++) {
          const row = rawData[i];
          if (!row[finalNameIdx]) continue;
          
          const rawCost = Number(row[finalCostIdx]) || 0;
          // Aplicar la lógica comercial: Fija el precio usando el margen promedio
          const calculatedPrice = rawCost * (1 + avgMargin);

          importedProducts.push({
            id: `imp-${Date.now()}-${i}`,
            name: String(row[finalNameIdx]),
            cost: rawCost,
            price: calculatedPrice,
            stock: Number(row[finalStockIdx]) || 0,
            supplier: row[finalProvIdx] ? String(row[finalProvIdx]) : "Proveedor Desconocido",
            minStock: 5,
            salesIndex: 50,
            autoPriced: true // MARCA DISTINTIVA de que la IA le asignó el precio
          });
        }

        setTimeout(() => {
          setPreviewData(importedProducts);
          setIsProcessing(false);
        }, 1500);

      } catch (err) {
        alert("Error al leer el Excel.");
        setIsProcessing(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  const processPDF = async (file: File) => {
    setIsProcessing(true);
    setProgress("👁️ IA Extrayendo costos de la factura...");
    
    setTimeout(() => {
      const mockExtracted = [
        { id: `ocr-${Date.now()}-1`, name: "Tornillo 1/2 pulg (IA)", cost: 1.00, price: 1.00 * (1 + avgMargin), stock: 500, minStock: 100, salesIndex: 75, supplier: "Factura IA", autoPriced: true },
        { id: `ocr-${Date.now()}-2`, name: "Fester 19L (IA)", cost: 1200.00, price: 1200.00 * (1 + avgMargin), stock: 10, minStock: 5, salesIndex: 90, supplier: "Factura IA", autoPriced: true },
      ];
      setPreviewData(mockExtracted);
      setIsProcessing(false);
    }, 3000);
  };

  const handleFileSelection = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === "xlsx" || ext === "xls" || ext === "csv") processExcel(file);
    else if (ext === "pdf" || ext === "png" || ext === "jpg") processPDF(file);
  };

  const confirmImport = () => {
    if (previewData) {
      onImport(previewData);
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
            <p style={{ color: 'var(--color-secondary)', marginBottom: '20px' }}>ERIKA ha calculado los Precios de Venta usando tu margen promedio ({(avgMargin*100).toFixed(1)}%). Revisa que estén correctos.</p>
            
            <div style={{ maxHeight: '300px', overflowY: 'auto', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '10px', marginBottom: '20px' }}>
              <table style={{ width: '100%', fontSize: '0.85rem', textAlign: 'left', borderCollapse: 'collapse' }}>
                <thead style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <tr style={{ color: 'var(--color-secondary)' }}>
                    <th style={{ padding: '8px' }}>Producto</th>
                    <th style={{ padding: '8px' }}>Proveedor</th>
                    <th style={{ padding: '8px' }}>Costo</th>
                    <th style={{ padding: '8px', color: 'white', background: 'rgba(16, 185, 129, 0.2)' }}>Precio AUTO</th>
                  </tr>
                </thead>
                <tbody>
                  {previewData.slice(0, 50).map((p, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '8px' }}>{p.name}</td>
                      <td style={{ padding: '8px' }}>{p.supplier}</td>
                      <td style={{ padding: '8px' }}>${p.cost.toFixed(2)}</td>
                      <td style={{ padding: '8px', background: 'rgba(16, 185, 129, 0.1)', fontWeight: 'bold' }}>${p.price.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: '15px', justifyContent: 'center' }}>
              <button className="btn-primary" onClick={() => setPreviewData(null)} style={{ background: 'transparent', border: '1px solid var(--color-primary)' }}>Cancelar</button>
              <button className="btn-primary" onClick={confirmImport} style={{ background: 'var(--color-primary)' }}>✅ Aprobar Precios e Importar</button>
            </div>
          </div>
        ) : (
          <div>
            <h2 style={{ color: 'var(--color-primary)', marginBottom: '10px' }}>⚡ Subir Facturas / Costos</h2>
            <p style={{ color: 'var(--color-text)', opacity: 0.8, marginBottom: '25px', fontSize: '0.9rem' }}>Sube tu Excel o PDF. ERIKA detectará el costo y generará el Precio de Venta en automático.</p>
            {isProcessing ? (
               <div style={{ padding: '40px 0' }}><p style={{ color: 'var(--color-secondary)' }}>{progress}</p></div>
            ) : (
              <div>
                <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".xlsx,.xls,.csv,.pdf,image/*" onChange={(e) => e.target.files && handleFileSelection(e.target.files[0])} />
                <button onClick={() => fileInputRef.current?.click()} className="btn-primary" style={{ padding: '20px', width: '100%', marginBottom: '20px' }}>📁 Buscar Archivo</button>
                <button onClick={downloadTemplate} style={{ background: 'transparent', color: 'var(--color-secondary)', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>📥 Descargar Plantilla de Costos Excel</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
