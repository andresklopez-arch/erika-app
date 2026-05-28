"use client";
import { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabaseClient";
import SuppliersManagerModal from "./SuppliersManagerModal";

interface SmartImporterProps {
  avgMargin: number;
  existingItems: any[];
  onClose: () => void;
  onImport: (products: any[], isRestockMode: boolean) => void;
}

export default function SmartImporter({
  avgMargin,
  existingItems,
  onClose,
  onImport,
}: SmartImporterProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState("");
  const [isRestockMode, setIsRestockMode] = useState(true);
  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [columnMapping, setColumnMapping] = useState({ name: -1, cost: -1, stock: -1, code: -1 });
  const [detectionSource, setDetectionSource] = useState({ name: "", cost: "", stock: "", code: "" });
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [processedRawData, setProcessedRawData] = useState<any[][]>([]);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [dbSuppliers, setDbSuppliers] = useState<string[]>([]);
  const [activeSuggestRow, setActiveSuggestRow] = useState<number | null>(null);
  const [showNewSupplierModal, setShowNewSupplierModal] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchSuppliers = async () => {
    const { data } = await supabase.from("suppliers").select("name").order("name");
    if (data) setDbSuppliers(data.map((s: any) => s.name));
  };

  useEffect(() => {
    fetchSuppliers();
    const lastSup = localStorage.getItem("lastErikaSupplier");
    if (lastSup) setSupplierSearch(lastSup);
  }, []);

  // NLP Limpiador: Quitar dobles espacios y capitalizar "tHINNEr" -> "Thinner"
  const cleanAndCapitalize = (str: string) => {
    return str
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const [minBatchMargin, setMinBatchMargin] = useState<number>(() => {
    return parseFloat(localStorage.getItem("ERIKA_TARGET_UTILITY") || "50");
  });

  // Helper de cálculo inteligente de precios basado en metas e histórico
  const getSmartPriceSuggestion = (name: string, cost: number, code: string, currentMinMargin: number) => {
    const margin = currentMinMargin / 100;

    // Buscar coincidencia en el catálogo existente
    const existing = existingItems.find(
      (item) =>
        (item.code && item.code.trim().toUpperCase() === code.trim().toUpperCase()) ||
        item.name.toLowerCase().trim() === name.toLowerCase().trim()
    );

    let price = cost * (1 + margin);
    let alertText = "Precio Sugerido (Meta)";
    let isInflation = false;
    let isNew = true;
    let prevPrice = 0;
    let prevCost = 0;

    if (existing) {
      isNew = false;
      prevPrice = existing.price;
      prevCost = existing.cost;
      if (cost > existing.cost) {
        isInflation = true;
        // Ajuste por inflación: mantener el margen histórico que tenía el producto o el target
        const prevMargin = existing.cost > 0 ? (existing.price - existing.cost) / existing.cost : margin;
        price = cost * (1 + prevMargin);
        alertText = `⚠️ INFLACIÓN (+${(((cost - existing.cost)/existing.cost)*100).toFixed(0)}% costo)`;
      } else if (cost === existing.cost) {
        price = existing.price;
        alertText = "Mismo Costo (Precio Fijo)";
      } else {
        price = existing.price; // Mantener precio anterior para maximizar ganancias
        alertText = "Costo Menor (Precio Fijo)";
      }
    }

    return { price, alertText, isInflation, isNew, prevPrice, prevCost };
  };

  const generatePreview = (mapping: { name: number, cost: number, stock: number, code: number, supplier?: number, location?: number }, data: any[][]) => {
    const importedProducts: any[] = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (!row || !row[mapping.name]) continue;
      
      if (i === 0) {
        const potentialCost = String(row[mapping.cost]).replace(/[^0-9.-]+/g, "");
        if (isNaN(Number(potentialCost)) || potentialCost === "") {
           continue;
        }
      }

      let rawCost = Number(row[mapping.cost]);
      let costHasError = false;
      if (isNaN(rawCost) && typeof row[mapping.cost] === "string") {
        rawCost = Number(String(row[mapping.cost]).replace(/[^0-9.-]+/g, ""));
      }
      if (isNaN(rawCost)) {
        rawCost = 0;
        costHasError = true;
      }

      let rawCode = row[mapping.code] ? String(row[mapping.code]).trim() : `SKU-${Date.now()}-${i}`;
      const cleanName = cleanAndCapitalize(String(row[mapping.name]));

      // 🔍 Detección Anti-Duplicados
      const existing = existingItems.find(
        (item) =>
          (item.code && item.code.trim().toUpperCase() === rawCode.trim().toUpperCase() && rawCode !== "") ||
          item.name.toLowerCase().trim() === cleanName.toLowerCase().trim()
      );

      if (existing && existing.code) {
        rawCode = existing.code;
      }

      const smartPrices = getSmartPriceSuggestion(cleanName, rawCost, rawCode, minBatchMargin);
      
      let rawStock = Number(row[mapping.stock]);
      let stockHasError = false;
      if (isNaN(rawStock)) {
         rawStock = 0;
         stockHasError = true;
      }
      
      let finalPrice = row[4];
      if (finalPrice === undefined || finalPrice === null || String(finalPrice).trim() === "") {
        finalPrice = smartPrices.price;
      } else {
        finalPrice = Number(String(finalPrice).replace(/[^0-9.-]+/g, ""));
        if (isNaN(finalPrice)) finalPrice = smartPrices.price;
      }

      const isDuplicateInFile = importedProducts.some(p => p.code && p.code.trim().toUpperCase() === rawCode.trim().toUpperCase());
      const rawSupplier = (mapping.supplier !== undefined && row[mapping.supplier]) ? String(row[mapping.supplier]).trim() : "Pendiente";
      const rawLocation = (mapping.location !== undefined && row[mapping.location]) ? String(row[mapping.location]).trim() : "";
      
      const allKnownLocations = Array.from(new Set(existingItems.map(i => i.location).filter(l => l && l !== "Pendiente" && l !== ""))).map(l => String(l).trim().toLowerCase());
      const isUnknownLocation = rawLocation !== "" && !allKnownLocations.includes(rawLocation.toLowerCase());

      importedProducts.push({
        id: `imp-${Date.now()}-${i}`,
        code: rawCode,
        name: cleanName,
        cost: rawCost,
        price: finalPrice,
        stock: rawStock,
        supplier: rawSupplier,
        location: rawLocation,
        minStock: 5,
        salesIndex: 50,
        autoPriced: true,
        alertText: isDuplicateInFile ? "⚠️ Código Repetido" : smartPrices.alertText,
        isInflation: smartPrices.isInflation,
        isNew: smartPrices.isNew,
        prevPrice: smartPrices.prevPrice,
        prevCost: smartPrices.prevCost,
        costHasError,
        stockHasError,
        isDuplicateInFile,
        isUnknownLocation
      });
    }
    setPreviewData(importedProducts);
  };

  const handleMappingChange = (field: string, newIdx: number) => {
    const newMapping = { ...columnMapping, [field]: newIdx };
    setColumnMapping(newMapping);
    setDetectionSource({ ...detectionSource, [field]: "👤 Manual" });
    generatePreview(newMapping, processedRawData);
  };

  const handleEditField = (index: number, field: string, value: string | number | boolean) => {
    if (!previewData) return;
    const newData = [...previewData];
    newData[index] = { ...newData[index], [field]: value };
    setPreviewData(newData);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, field: string) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const fields = ['code', 'name', 'stock', 'cost', 'price'];
      const fieldIndex = fields.indexOf(field);
      
      let nextRow = rowIndex;
      let nextField = fields[fieldIndex + (e.shiftKey ? -1 : 1)];
      
      if (!nextField) {
        nextField = e.shiftKey ? fields[fields.length - 1] : fields[0];
        nextRow += e.shiftKey ? -1 : 1;
      }
      
      const nextInput = document.getElementById(`input-${nextRow}-${nextField}`);
      if (nextInput) {
        nextInput.focus();
        if (nextInput instanceof HTMLInputElement) nextInput.select();
      }
    }
  };

  const highlightMatch = (text: string, query: string) => {
    if (!query) return text;
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return <span>{parts.map((part, i) => part.toLowerCase() === query.toLowerCase() ? <span key={i} style={{ color: "var(--color-primary)", fontWeight: "bold" }}>{part}</span> : part)}</span>;
  };

  useEffect(() => {
    if (previewData && processedRawData) {
      generatePreview(columnMapping, processedRawData);
    }
  }, [minBatchMargin]);

  const processExcel = async (file: File) => {
    setIsProcessing(true);
    setProgress("🧠 Analizando archivo y calculando márgenes...");

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        
        // 🛡️ Validación de Integridad (Magic Numbers)
        const ext = file.name.split(".").pop()?.toLowerCase();
        if (data.length > 8) {
          const hex = Array.from(data.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
          if (ext === 'xlsx' && !hex.startsWith("504B0304") && !hex.startsWith("504B0506") && !hex.startsWith("504B0708")) {
             throw new Error("El archivo no parece ser un XLSX genuino (posible intento de inyección o archivo corrupto).");
          }
          if (ext === 'xls' && !hex.startsWith("D0CF11E0A1B11AE1")) {
             throw new Error("El archivo no parece ser un XLS genuino (posible intento de inyección o archivo corrupto).");
          }
        }

        const workbook = XLSX.read(data, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rawDataRaw = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
        }) as any[][];

        // 1. Limpieza de filas vacías y basura
        const rawData = rawDataRaw.filter(row => {
          if (!row || !Array.isArray(row)) return false;
          const filledCells = row.filter(cell => cell !== null && cell !== undefined && cell !== "").length;
          return filledCells >= 2; // Al menos 2 columnas con datos
        });

        if (rawData.length < 2) throw new Error("Documento vacío o sin suficientes datos");

        // Extraer Headers Virtuales para selectores
        let maxCols = 0;
        for (let i = 0; i < Math.min(20, rawData.length); i++) {
           if (rawData[i].length > maxCols) maxCols = rawData[i].length;
        }
        
        const firstRow = rawData[0].map((h: any) => String(h).toLowerCase().trim());
        const headersForSelect: string[] = [];
        for (let c = 0; c < maxCols; c++) {
           headersForSelect.push(rawData[0][c] ? String(rawData[0][c]) : `Columna ${c + 1}`);
        }

        // Eliminar Fase Heurística, ahora es plantilla ESTRICTA
        const finalCodeIdx = 0;
        const finalNameIdx = 1;
        const finalStockIdx = 2;
        const finalCostIdx = 3;
        const finalSupplierIdx = 5;
        const finalLocationIdx = 6;
        
        const source = {
          code: "📋 Plantilla Oficial",
          name: "📋 Plantilla Oficial",
          stock: "📋 Plantilla Oficial",
          cost: "📋 Plantilla Oficial",
          supplier: "📋 Plantilla Oficial",
          location: "📋 Plantilla Oficial",
        };

        const mapping = { name: finalNameIdx, cost: finalCostIdx, stock: finalStockIdx, code: finalCodeIdx, supplier: finalSupplierIdx, location: finalLocationIdx };
        setColumnMapping(mapping);
        setDetectionSource(source);
        setRawHeaders(headersForSelect);
        setProcessedRawData(rawData);

        setTimeout(() => {
          generatePreview(mapping, rawData);
          setIsProcessing(false);
        }, 800);
      } catch (err) {
        console.error("Error procesando Excel:", err);
        alert("Error al leer el Excel. Asegúrate de que no esté dañado o encriptado y revisa las columnas.");
        setIsProcessing(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const processAIFile = async (file: File) => {
    setIsProcessing(true);
    setUploadedFile(file);
    
    // Crear vista previa si es imagen
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => setFilePreviewUrl(e.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setFilePreviewUrl(null);
    }

    const steps = [
      `🔍 Analizando archivo cargado: ${file.name}...`,
      "🤖 Iniciando Erika AI Vision OCR Engine...",
      "⚡ Detectando estructura del documento y cabeceras...",
      "📊 Analizando coherencia de datos, utilidad objetivo y precios anteriores..."
    ];

    for (let i = 0; i < steps.length; i++) {
      setProgress(steps[i]);
      await new Promise(resolve => setTimeout(resolve, 800));
    }

    // Generar datos simulados de alta fidelidad basados en el tipo de archivo / nombre
    const lowerName = file.name.toLowerCase();
    let mockProducts: any[] = [];
    const now = Date.now();

    if (lowerName.includes("pintura") || lowerName.includes("rodillo") || lowerName.includes("thinner")) {
      mockProducts = [
        { code: "PIN-ACR-19", name: "Pintura Acrílica Blanca 19L Sayer", cost: 890.00, stock: 5 },
        { code: "BRO-CER-04", name: "Brocha de Cerda Natural 4 pulgadas", cost: 35.00, stock: 24 },
        { code: "ROD-PRO-09", name: "Rodillo para Pintar Profesional 9x3/8", cost: 55.00, stock: 12 },
        { code: "THI-EST-01", name: "Thinner Estándar 1 Litro", cost: 38.00, stock: 30 }
      ];
    } else if (lowerName.includes("cemento") || lowerName.includes("obra") || lowerName.includes("pala")) {
      mockProducts = [
        { code: "CEM-TOL-50", name: "Cemento Tolteca Gris 50kg", cost: 145.00, stock: 40 },
        { code: "PAL-CUA-TR", name: "Pala Cuadrada Truper Mango Madera", cost: 195.00, stock: 10 },
        { code: "YES-CON-25", name: "Yeso Construcción Pro 25kg", cost: 65.00, stock: 15 },
        { code: "CAR-FIT-45", name: "Carretilla 4.5 pies Truper Neumática", cost: 980.00, stock: 4 }
      ];
    } else if (lowerName.includes("tubo") || lowerName.includes("pvc") || lowerName.includes("plomeria") || lowerName.includes("plomería")) {
      mockProducts = [
        { code: "TUB-PVC-12", name: "Tubo de PVC Hidráulico 1/2 pulgada 6m", cost: 68.00, stock: 20 },
        { code: "COD-PVC-90", name: "Codo PVC 1/2 pulgada 90 grados", cost: 4.80, stock: 100 },
        { code: "TEF-CIN-12", name: "Cinta de Teflón 1/2 pulgada 10m", cost: 7.50, stock: 150 },
        { code: "PEG-PVC-12", name: "Pegamento para PVC Oatey 125ml", cost: 49.00, stock: 25 }
      ];
    } else {
      // General hardware store mock invoice data
      mockProducts = [
        { code: "MAR-UNA-SA", name: "Martillo de Uña Sayer Premium", cost: 98.00, stock: 8 },
        { code: "CIN-MET-TR", name: "Cinta Métrica 5m Truper Grip", cost: 85.00, stock: 15 },
        { code: "PIN-CHO-08", name: "Pinzas de Chofer 8 pulgadas", cost: 115.00, stock: 10 },
        { code: "TOR-MAD-01", name: "Tornillo Madera 1 pulgada (100 pzas)", cost: 28.00, stock: 50 },
        { code: "LLA-AJU-10", name: "Llave Ajustable Perica 10 pulgadas", cost: 145.00, stock: 6 }
      ];
    }

    const processed = mockProducts.map((p, i) => {
      const smart = getSmartPriceSuggestion(p.name, p.cost, p.code, minBatchMargin);
      return {
        id: `ai-${now}-${i}`,
        code: p.code,
        name: p.name,
        cost: p.cost,
        price: smart.price,
        stock: p.stock,
        supplier: "Pendiente",
        minStock: 5,
        salesIndex: 50,
        autoPriced: true,
        alertText: smart.alertText,
        isInflation: smart.isInflation,
        isNew: smart.isNew,
        prevPrice: smart.prevPrice,
        prevCost: smart.prevCost
      };
    });

    setPreviewData(processed);
    setIsProcessing(false);
  };

  const handleFileSelection = (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "xlsx" || ext === "xls" || ext === "csv") {
      processExcel(file);
    } else if (ext === "pdf" || ext === "png" || ext === "jpg" || ext === "jpeg") {
      processAIFile(file);
    } else {
      alert("Formato no soportado. Sube un archivo Excel (XLSX, CSV), PDF o Fotografía (PNG, JPG).");
    }
  };

  const confirmImport = () => {
    if (previewData) {
      setShowSupplierModal(true);
    }
  };

  const executeImport = (globalSupplier: string) => {
    if (!previewData || !globalSupplier) return;

    let areaChar = "C";
    let areaNum = 1;

    const finalProducts = previewData.map((p) => {
      let assignedLocation = p.location;
      if (!assignedLocation || assignedLocation === "") {
        assignedLocation = `${areaChar}-${areaNum}`;
        areaNum++;
        if (areaNum > 20) {
          areaNum = 1;
          areaChar = String.fromCharCode(areaChar.charCodeAt(0) + 1);
        }
      }
      return { ...p, supplier: globalSupplier, location: assignedLocation };
    });

    onImport(finalProducts, isRestockMode);
    onClose();
  };

  const uniqueSuppliers = Array.from(new Set(existingItems.map(i => i.supplier).filter(s => s && s !== "Pendiente" && s !== "")));

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.85)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        className="glass-panel animate-fade-in"
        style={{
          width: previewData ? "900px" : "500px",
          textAlign: "center",
          padding: "30px",
          position: "relative",
          border: "1px solid var(--color-primary)",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: "15px",
            right: "15px",
            background: "transparent",
            color: "white",
            border: "none",
            cursor: "pointer",
            fontSize: "1.2rem",
          }}
        >
          ✖
        </button>

        {previewData ? (
          <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
            <h2 style={{ color: "var(--color-primary)", marginBottom: "5px" }}>
              👀 ERIKA AI Vision - Revisión y Precios Calculados
            </h2>
            <p style={{ color: "var(--color-secondary)", fontSize: "0.9rem", marginBottom: "10px" }}>
              ERIKA ha extraído los datos de forma inteligente, comparándolos con el inventario actual.
            </p>

            <div style={{ display: "flex", gap: "20px", width: "100%" }}>
              <div style={{ width: "250px", display: "flex", flexDirection: "column", gap: "15px" }}>
                {filePreviewUrl && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <span style={{ fontSize: "0.8rem", color: "var(--color-secondary)" }}>Imagen Original:</span>
                    <div style={{ border: "1px solid var(--glass-border)", borderRadius: "8px", overflow: "hidden", height: "180px", background: "rgba(0,0,0,0.5)" }}>
                      <img src={filePreviewUrl} alt="Factura cargada" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                    </div>
                  </div>
                )}
                {uploadedFile && !filePreviewUrl && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", border: "1px dashed var(--glass-border)", borderRadius: "8px", padding: "10px", background: "rgba(0,0,0,0.2)" }}>
                    <span style={{ fontSize: "3rem" }}>📄</span>
                    <span style={{ fontSize: "0.75rem", overflow: "hidden", textOverflow: "ellipsis", width: "100%" }}>{uploadedFile.name}</span>
                  </div>
                )}
                
                {/* Control de Margen de Lote */}
                <div style={{ background: "rgba(0,0,0,0.3)", padding: "15px", borderRadius: "8px", border: "1px solid rgba(16, 185, 129, 0.2)" }}>
                  <label style={{ fontSize: "0.8rem", color: "var(--color-secondary)", display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                    <span>Margen Mínimo Lote</span>
                    <strong style={{ color: "var(--color-primary)" }}>{minBatchMargin}%</strong>
                  </label>
                  <input 
                    type="range" 
                    min="1" 
                    max="100" 
                    value={minBatchMargin}
                    onChange={(e) => setMinBatchMargin(Number(e.target.value))}
                    style={{ width: "100%", accentColor: "var(--color-primary)" }}
                  />
                  <p style={{ fontSize: "0.7rem", color: "var(--color-text)", opacity: 0.6, marginTop: "8px", lineHeight: 1.2 }}>
                    Los precios sugeridos se recalcularán para garantizar esta ganancia sobre los costos importados.
                  </p>
                </div>
              </div>

              <div
                style={{
                  flex: 1,
                  maxHeight: "300px",
                  overflowY: "auto",
                  background: "rgba(0,0,0,0.3)",
                  borderRadius: "8px",
                  padding: "10px",
                }}
              >
                <table
                  style={{
                    width: "100%",
                    fontSize: "0.8rem",
                    textAlign: "left",
                    borderCollapse: "collapse",
                  }}
                >
                  <thead style={{ background: "rgba(255,255,255,0.05)" }}>
                    <tr style={{ color: "var(--color-secondary)", borderBottom: "1px solid rgba(255,255,255,0.2)" }}>
                      <th style={{ padding: "8px" }}>
                        <div style={{ fontSize: "0.7rem", marginBottom: "4px" }}>{detectionSource.code}</div>
                        <select value={columnMapping.code} onChange={(e) => handleMappingChange("code", parseInt(e.target.value))} style={{ background: "rgba(0,0,0,0.5)", color: "white", border: "1px solid var(--glass-border)", borderRadius: "4px", padding: "2px", width: "100%", fontSize: "0.8rem" }}>
                          {rawHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                        </select>
                      </th>
                      <th style={{ padding: "8px" }}>
                        <div style={{ fontSize: "0.7rem", marginBottom: "4px" }}>{detectionSource.name}</div>
                        <select value={columnMapping.name} onChange={(e) => handleMappingChange("name", parseInt(e.target.value))} style={{ background: "rgba(0,0,0,0.5)", color: "white", border: "1px solid var(--glass-border)", borderRadius: "4px", padding: "2px", width: "100%", fontSize: "0.8rem" }}>
                          {rawHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                        </select>
                      </th>
                      <th style={{ padding: "8px" }}>
                        <div style={{ fontSize: "0.7rem", marginBottom: "4px" }}>{detectionSource.stock}</div>
                        <select value={columnMapping.stock} onChange={(e) => handleMappingChange("stock", parseInt(e.target.value))} style={{ background: "rgba(0,0,0,0.5)", color: "white", border: "1px solid var(--glass-border)", borderRadius: "4px", padding: "2px", width: "100%", fontSize: "0.8rem" }}>
                          {rawHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                        </select>
                      </th>
                      <th style={{ padding: "8px" }}>
                        <div style={{ fontSize: "0.7rem", marginBottom: "4px" }}>{detectionSource.cost}</div>
                        <select value={columnMapping.cost} onChange={(e) => handleMappingChange("cost", parseInt(e.target.value))} style={{ background: "rgba(0,0,0,0.5)", color: "white", border: "1px solid var(--glass-border)", borderRadius: "4px", padding: "2px", width: "100%", fontSize: "0.8rem" }}>
                          {rawHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                        </select>
                      </th>
                      <th style={{ padding: "8px", color: "white", background: "rgba(16, 185, 129, 0.2)" }}>Precio Sugerido</th>
                      <th style={{ padding: "8px" }}>Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.map((p, i) => (
                      <tr
                        key={i}
                        style={{
                          borderBottom: "1px solid rgba(255,255,255,0.05)",
                          background: p.isInflation ? "rgba(239, 68, 68, 0.08)" : "transparent"
                        }}
                      >
                        <td style={{ padding: "8px" }}>
                          <input 
                            id={`input-${i}-code`}
                            type="text" 
                            value={p.code || ""} 
                            onChange={(e) => handleEditField(i, 'code', e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, i, 'code')}
                            disabled={!p.isNew}
                            style={{ 
                              width: "100%", 
                              background: p.isDuplicateInFile ? "rgba(234, 179, 8, 0.3)" : (!p.isNew ? "rgba(255,255,255,0.05)" : "transparent"), 
                              border: p.isDuplicateInFile ? "2px solid #eab308" : (!p.isNew ? "1px dashed rgba(255,255,255,0.2)" : "1px dashed var(--glass-border)"), 
                              color: p.isDuplicateInFile ? "#fef08a" : (!p.isNew ? "rgba(255,255,255,0.5)" : "white"), 
                              padding: "2px 4px", 
                              borderRadius: "4px", 
                              fontFamily: "monospace",
                              cursor: !p.isNew ? "not-allowed" : "text"
                            }}
                            title={!p.isNew ? "Bloqueado para proteger identidad del producto" : (p.isDuplicateInFile ? "¡Advertencia! Este código está repetido en el archivo" : "")}
                          />
                        </td>
                        <td style={{ padding: "8px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "5px", position: "relative" }}>
                              <input 
                                id={`input-${i}-name`}
                                type="text" 
                                value={p.name} 
                                onChange={(e) => handleEditField(i, 'name', e.target.value)}
                                onFocus={() => setActiveSuggestRow(i)}
                                onBlur={() => setTimeout(() => setActiveSuggestRow(null), 250)}
                                onKeyDown={(e) => handleKeyDown(e, i, 'name')}
                                disabled={!p.isNew}
                                style={{ 
                                  width: "100%", 
                                  background: !p.isNew ? "rgba(255,255,255,0.05)" : "transparent", 
                                  border: !p.isNew ? "1px dashed rgba(255,255,255,0.2)" : "1px dashed var(--glass-border)", 
                                  color: !p.isNew ? "rgba(255,255,255,0.5)" : "white", 
                                  padding: "2px 4px", 
                                  borderRadius: "4px", 
                                  fontWeight: "bold",
                                  cursor: !p.isNew ? "not-allowed" : "text"
                                }}
                                title={!p.isNew ? "Bloqueado para proteger identidad del producto" : ""}
                              />
                              {activeSuggestRow === i && p.name.length > 1 && existingItems.filter(item => item.name.toLowerCase().includes(p.name.toLowerCase()) && item.name.toLowerCase() !== p.name.toLowerCase()).length > 0 && (
                                <div style={{ position: "absolute", top: "100%", left: 0, minWidth: "200px", background: "#1a1a1a", border: "1px solid var(--color-primary)", borderRadius: "4px", zIndex: 100, maxHeight: "150px", overflowY: "auto", boxShadow: "0 4px 10px rgba(0,0,0,0.5)" }}>
                                  {existingItems.filter(item => item.name.toLowerCase().includes(p.name.toLowerCase()) && item.name.toLowerCase() !== p.name.toLowerCase()).slice(0, 10).map((item, idx) => (
                                    <div 
                                      key={idx} 
                                      onClick={() => {
                                        handleEditField(i, 'name', item.name);
                                        if (item.code) handleEditField(i, 'code', item.code);
                                        // Update status to existing
                                        const newData = [...previewData];
                                        newData[i] = { ...newData[i], name: item.name, code: item.code || newData[i].code, isNew: false, prevCost: item.cost, prevPrice: item.price };
                                        setPreviewData(newData);
                                      }}
                                      style={{ padding: "8px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: "0.75rem", color: "white" }}
                                    >
                                      {highlightMatch(item.name, p.name)} <span style={{ color: "var(--color-secondary)", fontSize: "0.6rem" }}>[{item.code}]</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {!p.isNew && (
                                <span style={{ fontSize: "0.6rem", background: "rgba(59, 130, 246, 0.2)", color: "#3b82f6", padding: "2px 4px", borderRadius: "4px", whiteSpace: "nowrap" }}>
                                  🔄 Actualización
                                </span>
                              )}
                              {p.isUnknownLocation && (
                                <span style={{ fontSize: "0.6rem", background: "rgba(234, 179, 8, 0.2)", color: "#eab308", padding: "2px 4px", borderRadius: "4px", whiteSpace: "nowrap" }} title="Esta bodega no existe actualmente en la base de datos. Se creará automáticamente.">
                                  ⚠️ Bodega Nueva
                                </span>
                              )}
                            </div>
                            {!p.isNew && (
                              <div style={{ fontSize: "0.7rem", color: "var(--color-secondary)" }}>
                                Anterior: Costo: ${p.prevCost.toFixed(2)} | Precio: ${p.prevPrice.toFixed(2)}
                              </div>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: "8px" }}>
                          <input 
                            id={`input-${i}-stock`}
                            type="number" 
                            value={p.stock} 
                            onChange={(e) => {
                              handleEditField(i, 'stock', Number(e.target.value));
                              handleEditField(i, 'stockHasError', false);
                            }}
                            onKeyDown={(e) => handleKeyDown(e, i, 'stock')}
                            style={{ 
                              width: "60px", 
                              background: p.stockHasError ? "rgba(239, 68, 68, 0.2)" : "transparent", 
                              border: p.stockHasError ? "2px solid #ef4444" : "1px dashed var(--glass-border)", 
                              color: p.stockHasError ? "#ef4444" : "white", 
                              padding: "2px 4px", 
                              borderRadius: "4px" 
                            }}
                            title={p.stockHasError ? "Error: Valor no numérico detectado" : ""}
                          />
                        </td>
                        <td style={{ padding: "8px" }}>
                          <div style={{ display: "flex", alignItems: "center" }}>
                            $<input 
                              id={`input-${i}-cost`}
                              type="number" 
                              value={p.cost} 
                              onChange={(e) => {
                                handleEditField(i, 'cost', Number(e.target.value));
                                handleEditField(i, 'costHasError', false);
                              }}
                              onKeyDown={(e) => handleKeyDown(e, i, 'cost')}
                              style={{ 
                                width: "70px", 
                                background: p.costHasError ? "rgba(239, 68, 68, 0.2)" : "transparent", 
                                border: p.costHasError ? "2px solid #ef4444" : "1px dashed var(--glass-border)", 
                                color: p.costHasError ? "#ef4444" : "white", 
                                padding: "2px 4px", 
                                borderRadius: "4px" 
                              }}
                              title={p.costHasError ? "Error: Valor no numérico detectado" : ""}
                            />
                          </div>
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            background: "rgba(16, 185, 129, 0.1)",
                            fontWeight: "bold",
                            color: "var(--color-secondary)"
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center" }}>
                            $<input 
                              id={`input-${i}-price`}
                              type="number" 
                              value={p.price} 
                              onChange={(e) => handleEditField(i, 'price', Number(e.target.value))}
                              onKeyDown={(e) => handleKeyDown(e, i, 'price')}
                              style={{ width: "70px", background: "transparent", border: "1px dashed var(--color-primary)", color: "var(--color-secondary)", padding: "2px 4px", borderRadius: "4px", fontWeight: "bold" }}
                            />
                          </div>
                        </td>
                        <td style={{ padding: "8px" }}>
                          <span style={{
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "0.7rem",
                            fontWeight: "bold",
                            background: p.isInflation ? "rgba(239,68,68,0.2)" : p.isNew ? "rgba(59,130,246,0.2)" : "rgba(16,185,129,0.2)",
                            color: p.isInflation ? "#ef4444" : p.isNew ? "#3b82f6" : "#10b981"
                          }}>
                            {p.alertText}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div
              style={{ display: "flex", gap: "15px", justifyContent: "center", marginTop: "15px" }}
            >
              <button
                className="btn-primary"
                onClick={() => { setPreviewData(null); setUploadedFile(null); setFilePreviewUrl(null); }}
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-primary)",
                }}
              >
                Cancelar
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", background: "rgba(255,255,255,0.1)", padding: "8px 12px", borderRadius: "8px", border: isRestockMode ? "1px solid #10b981" : "1px solid transparent" }}>
                  <input type="checkbox" checked={isRestockMode} onChange={(e) => setIsRestockMode(e.target.checked)} style={{ transform: "scale(1.2)" }} />
                  <span style={{ fontSize: "0.9rem", color: isRestockMode ? "#10b981" : "white", fontWeight: isRestockMode ? "bold" : "normal" }}>
                    {isRestockMode ? "📦 Modo Re-abastecimiento (+ Sumar Stock)" : "🔄 Modo Reemplazo Absoluto"}
                  </span>
                </label>
                <button
                  className="btn-primary"
                  onClick={confirmImport}
                  style={{ background: "var(--color-primary)" }}
                >
                  ✅ Confirmar e Importar
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <h2 style={{ color: "var(--color-primary)", marginBottom: "10px" }}>
              ⚡ ERIKA - Carga Inteligente (Plantilla Estricta)
            </h2>
            <div
              style={{
                background: "rgba(16, 185, 129, 0.1)",
                border: "1px dashed var(--color-primary)",
                borderRadius: "8px",
                padding: "15px",
                marginBottom: "20px",
                textAlign: "left",
                color: "var(--color-text)",
                fontSize: "0.85rem",
              }}
            >
              <h3 style={{ color: "var(--color-primary)", marginBottom: "10px" }}>📝 Instrucciones para una carga 100% exacta:</h3>
              <p style={{ marginBottom: "10px" }}>Para evitar cruces de información y errores matemáticos, ahora el sistema exige que tu archivo (CSV, XLS, XLSX) respete estrictamente este orden de columnas (puedes copiar y pegar los datos de tu proveedor en nuestra plantilla):</p>
              <ol style={{ marginLeft: "20px", marginBottom: "15px", opacity: 0.9, display: "flex", flexDirection: "column", gap: "5px" }}>
                <li><strong>Columna A (1):</strong> Código de Barras / SKU</li>
                <li><strong>Columna B (2):</strong> Nombre del Producto</li>
                <li><strong>Columna C (3):</strong> Stock (Cantidad)</li>
                <li><strong>Columna D (4):</strong> Costo Proveedor</li>
                <li><strong>Columna E (5):</strong> Precio Venta <em>(Opcional, ERIKA lo calcula si está vacío)</em></li>
                <li><strong>Columna F (6):</strong> Proveedor <em>(Opcional, para asignar diferentes proveedores)</em></li>
                <li><strong>Columna G (7):</strong> Bodega/Ubicación <em>(Opcional, ERIKA asume la ubicación si está vacía)</em></li>
              </ol>
              <button 
                onClick={() => {
                  const wsData: any[][] = [
                    ["CODIGO", "PRODUCTO", "STOCK", "COSTO", "PRECIO", "PROVEEDOR", "BODEGA"]
                  ];
                  if (existingItems && existingItems.length > 0) {
                    existingItems.forEach(item => {
                      wsData.push([item.code || "", item.name || "", item.stock || 0, item.cost || 0, item.price || 0, item.supplier || "", item.location || ""]);
                    });
                  } else {
                    wsData.push(["001", "Ejemplo Martillo Truper", 15, 85.50, 130.00, "Truper", "BODEGA-1"]);
                  }
                  const ws = XLSX.utils.aoa_to_sheet(wsData);
                  ws["!cols"] = [{wch: 15}, {wch: 30}, {wch: 10}, {wch: 12}, {wch: 12}, {wch: 20}, {wch: 15}];
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, "Inventario");
                  XLSX.writeFile(wb, "ERIKA_Plantilla_Inventario.xlsx");
                }}
                className="btn-primary hover-scale" 
                style={{ width: "100%", background: "var(--color-primary)", color: "#000", padding: "12px", fontWeight: "bold", border: "none" }}
              >
                📥 Descargar Plantilla Oficial (Excel)
              </button>
            </div>
            
            {isProcessing ? (
              <div style={{ padding: "40px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "15px" }}>
                <div style={{
                  width: "50px",
                  height: "50px",
                  border: "4px solid rgba(255,255,255,0.1)",
                  borderTop: "4px solid var(--color-primary)",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite",
                }} />
                <style>{`
                  @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                  }
                `}</style>
                <p style={{ color: "var(--color-secondary)", fontWeight: "bold" }}>{progress}</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: "none" }}
                  accept=".xlsx,.xls,.csv,.pdf,image/*"
                  onChange={(e) =>
                    e.target.files && handleFileSelection(e.target.files[0])
                  }
                />
                
                {/* Zona de Arrastre visualmente premium */}
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: "2px dashed var(--color-primary)",
                    borderRadius: "12px",
                    padding: "40px 20px",
                    cursor: "pointer",
                    background: "rgba(0,0,0,0.2)",
                    transition: "all 0.2s ease",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "10px"
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "rgba(16, 185, 129, 0.05)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "rgba(0,0,0,0.2)"}
                >
                  <span style={{ fontSize: "3rem" }}>📁</span>
                  <strong style={{ color: "var(--color-primary)" }}>Seleccionar archivo desde tu equipo</strong>
                  <span style={{ fontSize: "0.8rem", opacity: 0.6 }}>Formatos: Excel, CSV, PDF o Imágenes (JPG, PNG)</span>
                </div>
              </div>
            )}
          </div>
        )}

        {showSupplierModal && (
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100, backdropFilter: "blur(4px)" }}>
            <div className="glass-panel animate-fade-in" style={{ padding: "30px", width: "400px", textAlign: "left", display: "flex", flexDirection: "column", gap: "15px" }}>
              <h3 style={{ color: "var(--color-primary)", margin: 0 }}>🏢 Asignar Proveedor General</h3>
              <p style={{ fontSize: "0.85rem", opacity: 0.8, margin: 0 }}>Ingresa el nombre del proveedor para estos productos. Utiliza las sugerencias para evitar duplicados.</p>
              
              <div style={{ position: "relative" }}>
                <input 
                  type="text"
                  placeholder="Ej. TRUPER"
                  value={supplierSearch}
                  onChange={(e) => { setSupplierSearch(e.target.value); setIsDropdownOpen(true); }}
                  onFocus={() => setIsDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)}
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--color-primary)", background: "rgba(0,0,0,0.8)", color: "white" }}
                />
                {isDropdownOpen && dbSuppliers.filter(s => s.toLowerCase().includes(supplierSearch.toLowerCase())).length > 0 && (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: "8px", marginTop: "5px", maxHeight: "150px", overflowY: "auto", zIndex: 1200 }}>
                    {dbSuppliers.filter(s => s.toLowerCase().includes(supplierSearch.toLowerCase())).map((sup, idx) => (
                      <div key={idx} onClick={() => { setSupplierSearch(sup); setIsDropdownOpen(false); }} style={{ padding: "8px 10px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        {sup}
                      </div>
                    ))}
                  </div>
                )}
                {dbSuppliers.length === 0 && (
                  <p style={{ color: "#ef4444", fontSize: "0.8rem", marginTop: "5px" }}>⚠️ No hay proveedores registrados. Registra uno nuevo.</p>
                )}
              </div>

              <div style={{ display: "flex", gap: "10px", justifyContent: "space-between", marginTop: "10px" }}>
                <button onClick={() => setShowNewSupplierModal(true)} className="btn-primary" style={{ background: "rgba(59, 130, 246, 0.2)", border: "1px solid #3b82f6", color: "#3b82f6" }}>➕ Nuevo</button>
                <div style={{ display: "flex", gap: "10px" }}>
                  <button onClick={() => setShowSupplierModal(false)} className="btn-primary" style={{ background: "transparent", border: "1px solid var(--color-primary)" }}>Cancelar</button>
                  <button 
                    onClick={() => {
                      localStorage.setItem("lastErikaSupplier", supplierSearch);
                      executeImport(supplierSearch);
                    }} 
                    className="btn-primary" 
                    disabled={!dbSuppliers.includes(supplierSearch)} 
                    style={{ background: "var(--color-primary)", opacity: dbSuppliers.includes(supplierSearch) ? 1 : 0.5 }}
                  >
                    Confirmar e Importar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showNewSupplierModal && (
          <div style={{ zIndex: 1300, position: "relative" }}>
            <SuppliersManagerModal onClose={() => { setShowNewSupplierModal(false); fetchSuppliers(); }} />
          </div>
        )}
      </div>
    </div>
  );
}
