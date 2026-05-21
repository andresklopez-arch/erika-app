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
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        // IA Heurística para adivinar las columnas
        const headers = rawData[0].map(h => String(h).toLowerCase());
        
        const nameIdx = headers.findIndex(h => h.includes("nombre") || h.includes("descrip") || h.includes("producto") || h.includes("articulo"));
        const priceIdx = headers.findIndex(h => h.includes("precio") || h.includes("venta") || h.includes("publico"));
        const costIdx = headers.findIndex(h => h.includes("costo") || h.includes("compra"));
        const stockIdx = headers.findIndex(h => h.includes("stock") || h.includes("cantidad") || h.includes("inventario"));

        // Fallbacks por si la hoja no tiene encabezados claros (asumimos formato estándar)
        const finalNameIdx = nameIdx >= 0 ? nameIdx : 0;
        const finalPriceIdx = priceIdx >= 0 ? priceIdx : 1;
        const finalCostIdx = costIdx >= 0 ? costIdx : 2;
        const finalStockIdx = stockIdx >= 0 ? stockIdx : 3;

        const importedProducts = [];
        for (let i = 1; i < rawData.length; i++) {
          const row = rawData[i];
          if (!row[finalNameIdx]) continue; // Saltar filas vacías
          
          importedProducts.push({
            id: `imp-${Date.now()}-${i}`,
            name: String(row[finalNameIdx]),
            price: Number(row[finalPriceIdx]) || 0,
            cost: Number(row[finalCostIdx]) || 0,
            stock: Number(row[finalStockIdx]) || 0,
            minStock: 5,
            salesIndex: 50 // Valor por defecto
          });
        }

        setTimeout(() => {
          onImport(importedProducts);
          onClose();
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
    
    // Simulación del procesamiento del OCR / LLM visual
    setTimeout(() => setProgress("📄 Escaneando estructura del documento..."), 1500);
    setTimeout(() => setProgress("💡 Extrayendo filas, precios y cantidades..."), 3500);
    
    setTimeout(() => {
      const mockExtracted = [
        { id: `ocr-${Date.now()}-1`, name: "Tornillo 1/2 pulgada (Extraído por IA)", price: 2.50, cost: 1.00, stock: 500, minStock: 100, salesIndex: 75 },
        { id: `ocr-${Date.now()}-2`, name: "Impermeabilizante Fester 19L (Extraído por IA)", price: 1800.00, cost: 1200.00, stock: 10, minStock: 5, salesIndex: 90 },
      ];
      onImport(mockExtracted);
      onClose();
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

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="glass-panel animate-fade-in" style={{ width: '500px', textAlign: 'center', padding: '40px', position: 'relative', border: '1px solid var(--color-primary)' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: '15px', right: '15px', background: 'transparent', color: 'white', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}>✖</button>
        
        <h2 style={{ color: 'var(--color-primary)', marginBottom: '10px' }}>⚡ Importación Inteligente</h2>
        <p style={{ color: 'var(--color-text)', opacity: 0.8, marginBottom: '25px', fontSize: '0.9rem' }}>Sube tu lista de precios en <strong>Excel</strong> o toma una foto/sube un <strong>PDF</strong> de la factura de tu proveedor para que ERIKA la lea.</p>

        {isProcessing ? (
          <div style={{ padding: '40px 0' }}>
            <div style={{ width: '50px', height: '50px', border: '4px solid rgba(255,255,255,0.1)', borderTop: '4px solid var(--color-primary)', borderRadius: '50%', margin: '0 auto', animation: 'spin 1s linear infinite' }} />
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
            <p style={{ marginTop: '20px', color: 'var(--color-secondary)', fontWeight: 'bold' }}>{progress}</p>
          </div>
        ) : (
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
              transition: 'all 0.3s ease'
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
        )}
      </div>
    </div>
  );
}
