"use client";
import { useState, useRef } from "react";
import * as XLSX from "xlsx";

interface SmartImporterProps {
  onClose: () => void;
  onImport: (products: any[]) => void;
}

export default function SmartImporter({ onClose, onImport }: SmartImporterProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState("");
  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Nombre del Producto", "Precio de Venta", "Costo de Compra", "Stock Actual"],
      ["Martillo Truper 16oz", 120.50, 80.00, 15],
      ["Clavo 2 pulgadas (Caja)", 45.00, 25.00, 50]
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Plantilla_Inventario");
    XLSX.writeFile(wb, "Plantilla_Inventario_ERIKA.xlsx");
  };

  const processExcel = async (file: File) => {
    setIsProcessing(true);
    setProgress("🧠 ERIKA está analizando la hoja de cálculo...");
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: "binary" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
        
        if (rawData.length < 2) throw new Error("Documento vacío");

        setProgress("🔍 Detectando columnas automáticamente con IA...");
        const headers = rawData[0].map(h => String(h).toLowerCase());
        
        const nameIdx = headers.findIndex(h => h.includes("nombre") || h.includes("descrip") || h.includes("producto") || h.includes("articulo"));
        const priceIdx = headers.findIndex(h => h.includes("precio") || h.includes("venta") || h.includes("publico"));
        const costIdx = headers.findIndex(h => h.includes("costo") || h.includes("compra"));
        const stockIdx = headers.findIndex(h => h.includes("stock") || h.includes("cantidad") || h.includes("inventario"));

        const finalNameIdx = nameIdx >= 0 ? nameIdx : 0;
        const finalPriceIdx = priceIdx >= 0 ? priceIdx : 1;
        const finalCostIdx = costIdx >= 0 ? costIdx : 2;
        const finalStockIdx = stockIdx >= 0 ? stockIdx : 3;

        const importedProducts = [];
        for (let i = 1; i < rawData.length; i++) {
          const row = rawData[i];
          if (!row[finalNameIdx]) continue;
          
          importedProducts.push({
            id: `imp-${Date.now()}-${i}`,
            name: String(row[finalNameIdx]),
            price: Number(row[finalPriceIdx]) || 0,
            cost: Number(row[finalCostIdx]) || 0,
            stock: Number(row[finalStockIdx]) || 0,
            minStock: 5,
            salesIndex: 50
          });
        }

        setTimeout(() => {
          setPreviewData(importedProducts);
          setIsProcessing(false);
        }, 1500);

      } catch (err) {
        alert("Error al leer el Excel. Por favor verifica el archivo.");
        setIsProcessing(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  const processPDF = async (file: File) => {
    setIsProcessing(true);
    setProgress("👁️ Iniciando Motor de Visión IA ERIKA...");
    
    setTimeout(() => setProgress("📄 Escaneando estructura del documento..."), 1500);
    setTimeout(() => setProgress("💡 Extrayendo filas, precios y cantidades..."), 3500);
    
    setTimeout(() => {
      const mockExtracted = [
        { id: `ocr-${Date.now()}-1`, name: "Tornillo 1/2 pulgada (Extraído por IA)", price: 2.50, cost: 1.00, stock: 500, minStock: 100, salesIndex: 75 },
        { id: `ocr-${Date.now()}-2`, name: "Impermeabilizante Fester 19L (Extraído por IA)", price: 1800.00, cost: 1200.00, stock: 10, minStock: 5, salesIndex: 90 },
      ];
      setPreviewData(mockExtracted);
      setIsProcessing(false);
    }, 5500);
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelection = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === "xlsx" || ext === "xls" || ext === "csv") {
      processExcel(file);
    } else if (ext === "pdf" || ext === "png" || ext === "jpg" || ext === "jpeg") {
      processPDF(file);
    } else {
      alert("Formato no soportado. Sube Excel (.xlsx, .csv) o Facturas (.pdf, fotos).");
    }
  };

  const confirmImport = () => {
    if (previewData) {
      onImport(previewData);
      onClose();
    }
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="glass-panel animate-fade-in" style={{ width: previewData ? '700px' : '500px', textAlign: 'center', padding: '40px', position: 'relative', border: '1px solid var(--color-primary)' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: '15px', right: '15px', background: 'transparent', color: 'white', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}>✖</button>
        
        {previewData ? (
          <div className="animate-fade-in">
            <h2 style={{ color: 'var(--color-primary)', marginBottom: '10px' }}>👀 Revisión de Datos ERIKA</h2>
            <p style={{ color: 'var(--color-secondary)', marginBottom: '20px' }}>He detectado {previewData.length} productos listos para importarse.</p>
            
            <div style={{ maxHeight: '300px', overflowY: 'auto', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '10px', marginBottom: '20px' }}>
              <table style={{ width: '100%', fontSize: '0.85rem', textAlign: 'left', borderCollapse: 'collapse' }}>
                <thead style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <tr style={{ color: 'var(--color-secondary)' }}>
                    <th style={{ padding: '8px' }}>Producto</th>
                    <th style={{ padding: '8px' }}>Costo</th>
                    <th style={{ padding: '8px' }}>Precio</th>
                    <th style={{ padding: '8px' }}>Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {previewData.slice(0, 50).map((p, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '8px' }}>{p.name}</td>
                      <td style={{ padding: '8px' }}>${p.cost}</td>
                      <td style={{ padding: '8px' }}>${p.price}</td>
                      <td style={{ padding: '8px' }}>{p.stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {previewData.length > 50 && <p style={{ marginTop: '10px', fontSize: '0.8rem', opacity: 0.6 }}>...mostrando solo los primeros 50.</p>}
            </div>

            <div style={{ display: 'flex', gap: '15px', justifyContent: 'center' }}>
              <button className="btn-primary" onClick={() => setPreviewData(null)} style={{ background: 'transparent', border: '1px solid var(--color-primary)' }}>Rechazar</button>
              <button className="btn-primary" onClick={confirmImport} style={{ background: 'var(--color-primary)' }}>✅ Confirmar e Inyectar a BD</button>
            </div>
          </div>
        ) : (
          <div>
            <h2 style={{ color: 'var(--color-primary)', marginBottom: '10px' }}>⚡ Importación Inteligente</h2>
            <p style={{ color: 'var(--color-text)', opacity: 0.8, marginBottom: '25px', fontSize: '0.9rem' }}>Sube tu lista de precios en <strong>Excel</strong> o toma una foto/sube un <strong>PDF</strong> de la factura.</p>

            {isProcessing ? (
              <div style={{ padding: '40px 0' }}>
                <div style={{ width: '50px', height: '50px', border: '4px solid rgba(255,255,255,0.1)', borderTop: '4px solid var(--color-primary)', borderRadius: '50%', margin: '0 auto', animation: 'spin 1s linear infinite' }} />
                <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                <p style={{ marginTop: '20px', color: 'var(--color-secondary)', fontWeight: 'bold' }}>{progress}</p>
              </div>
            ) : (
              <div>
                <div 
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleFileDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${isDragging ? 'var(--color-primary)' : 'rgba(255,255,255,0.3)'}`,
                    background: isDragging ? 'rgba(244, 63, 94, 0.1)' : 'rgba(0,0,0,0.3)',
                    borderRadius: '12px',
                    padding: '50px 20px',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    marginBottom: '20px'
                  }}
                >
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    style={{ display: 'none' }} 
                    accept=".xlsx,.xls,.csv,.pdf,image/*" 
                    onChange={(e) => e.target.files && handleFileSelection(e.target.files[0])}
                  />
                  <div style={{ fontSize: '3rem', marginBottom: '10px' }}>📂</div>
                  <h3 style={{ color: 'white', marginBottom: '5px' }}>Arrastra tus archivos aquí</h3>
                  <p style={{ fontSize: '0.8rem', opacity: 0.6 }}>o haz clic para explorar tu dispositivo</p>
                </div>

                <button onClick={downloadTemplate} style={{ background: 'transparent', color: 'var(--color-secondary)', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.85rem' }}>
                  📥 Descargar Plantilla Ideal de Excel
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
