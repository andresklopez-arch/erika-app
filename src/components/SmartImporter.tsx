"use client";
import { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabaseClient";
import SuppliersManagerModal from "./SuppliersManagerModal";

interface SmartImporterProps {
  avgMargin: number;
  existingItems: any[];
  onClose: () => void;
  onImport: (products: any[], importOption: "sustituir" | "complementar" | "nuevo", accumulateStock?: boolean) => void;
}

export default function SmartImporter({
  avgMargin,
  existingItems,
  onClose,
  onImport,
}: SmartImporterProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState("");
  const [importOption, setImportOption] = useState<"sustituir" | "complementar" | "nuevo" | "">("");
  const [accumulateStock, setAccumulateStock] = useState<boolean>(true);
  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [columnMapping, setColumnMapping] = useState({ code: 0, name: 1, supplier: 2, stock: 3, cost: 4, price: 5, location: 6 });
  const [detectionSource, setDetectionSource] = useState({ supplier: "", name: "", cost: "", stock: "", code: "", price: "" });
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [processedRawData, setProcessedRawData] = useState<any[][]>([]);
  const [showSupplierModal, setShowSupplierModal] = useState(false); // conservado por compatibilidad
  const [supplierSearch, setSupplierSearch] = useState(""); // conservado por compatibilidad
  const [dbSuppliers, setDbSuppliers] = useState<string[]>([]);
  const [activeSuggestRow, setActiveSuggestRow] = useState<number | null>(null);
  const [showNewSupplierModal, setShowNewSupplierModal] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false); // conservado por compatibilidad
  const [dragRowIndex, setDragRowIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  // Sugerencia 2: Umbral de similitud fuzzy ajustable (0.05 a 0.30), persiste en localStorage (con fallback seguro)
  const [fuzzyThreshold, setFuzzyThreshold] = useState<number>(() => {
    const stored = localStorage.getItem("erika_fuzzy_threshold");
    if (stored) {
      const val = parseFloat(stored);
      if (!isNaN(val) && val >= 0.03 && val <= 0.30) {
        return val;
      }
    }
    return 0.15;
  });
  // Sugerencia 3: Panel de colisiones colapsable
  const [showCollisionsPanel, setShowCollisionsPanel] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  interface ToastItem {
    id: string;
    message: string;
  }
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [isGeneratingCsv, setIsGeneratingCsv] = useState(false);
  const [downloadCount, setDownloadCount] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("erika_csv_download_count");
      return stored ? parseInt(stored, 10) : 0;
    }
    return 0;
  });
  const [csvDownloadSuccess, setCsvDownloadSuccess] = useState(false);

  const showToast = (message: string) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  useEffect(() => {
    const handleGlobalEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setToasts([]);
      }
    };
    window.addEventListener("keydown", handleGlobalEscape);
    return () => window.removeEventListener("keydown", handleGlobalEscape);
  }, []);

  const fetchSuppliers = async () => {
    const { data } = await supabase.from("suppliers").select("name").order("name");
    if (data) setDbSuppliers(data.map((s: any) => s.name));
  };

  useEffect(() => {
    fetchSuppliers();
  }, []);

  // 📋 SUGERENCIA 3: Escuchar Ctrl+V para pegar datos de Excel directo
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      // Solo activar si no hay un input activo (para no interferir con la edición de celdas)
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;
      if (previewData) return; // Ya hay datos cargados

      const text = e.clipboardData?.getData('text/plain');
      if (!text || text.trim() === '') return;

      const lines = text.trim().split('\n').map(l => l.split('\t'));
      if (lines.length < 2) return; // Necesita al menos cabecera + 1 fila

      e.preventDefault();
      setIsProcessing(true);
      setProgress('📋 Procesando datos pegados del portapapeles...');

      setTimeout(() => {
        const rawData = lines.map(row => row.map(cell => cell.trim()));
        const headers = rawData[0].map((h, i) => h || `Columna ${i + 1}`);
        setRawHeaders(headers);
        setProcessedRawData(rawData);
        setUploadedFile(null);

        // Detectar columnas igual que en processExcel
        let finalCodeIdx = 0, finalNameIdx = 1, finalSupplierIdx = 2;
        let finalStockIdx = 3, finalCostIdx = 4, finalPriceIdx = 5, finalLocationIdx = 6;
        let detectedSupplier = false, detectedCode = false, detectedName = false;
        let detectedStock = false, detectedCost = false, detectedPrice = false;

        headers.forEach((h, idx) => {
          const val = h.toLowerCase().trim();
          if (val.includes('prove') || val.includes('supplier') || val.includes('brand')) { finalSupplierIdx = idx; detectedSupplier = true; }
          else if (val.includes('cod') || val.includes('sku') || val.includes('barr')) { finalCodeIdx = idx; detectedCode = true; }
          else if (val.includes('nom') || val.includes('prod') || val.includes('desc') || val.includes('art')) { finalNameIdx = idx; detectedName = true; }
          else if (val.includes('cant') || val.includes('stock') || val.includes('exis')) { finalStockIdx = idx; detectedStock = true; }
          else if (val.includes('cost') || val.includes('comp') || val.includes('costo')) { finalCostIdx = idx; detectedCost = true; }
          else if (val.includes('prec') || val.includes('vent') || val.includes('precio')) { finalPriceIdx = idx; detectedPrice = true; }
          else if (val.includes('ubica') || val.includes('bod') || val.includes('loc')) { finalLocationIdx = idx; }
        });

        const source = {
          supplier: detectedSupplier ? '🤖 Auto-detectado' : '📋 Plantilla Oficial',
          code: detectedCode ? '🤖 Auto-detectado' : '📋 Plantilla Oficial',
          name: detectedName ? '🤖 Auto-detectado' : '📋 Plantilla Oficial',
          stock: detectedStock ? '🤖 Auto-detectado' : '📋 Plantilla Oficial',
          cost: detectedCost ? '🤖 Auto-detectado' : '📋 Plantilla Oficial',
          price: detectedPrice ? '🤖 Auto-detectado' : '📋 Plantilla Oficial',
          location: '📋 Plantilla Oficial',
        };
        setDetectionSource(source);

        const mapping = { supplier: finalSupplierIdx, code: finalCodeIdx, name: finalNameIdx, stock: finalStockIdx, cost: finalCostIdx, price: finalPriceIdx, location: finalLocationIdx };
        setColumnMapping(mapping);
        generatePreviewAndReturnWarnings(mapping, rawData);
        setIsProcessing(false);
      }, 400);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [previewData, dbSuppliers, existingItems]);

  // NLP Limpiador: Quitar dobles espacios y capitalizar "tHINNEr" -> "Thinner"
  const cleanAndCapitalize = (str: string) => {
    return str
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const normalizeString = (str: string) => {
    if (!str) return "";
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  };

  const getLevenshteinDistance = (a: string, b: string) => {
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const arr = [];
    for (let i = 0; i <= b.length; i++) { arr[i] = [i]; }
    for (let j = 0; j <= a.length; j++) { arr[0][j] = j; }
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) == a.charAt(j - 1)) {
          arr[i][j] = arr[i - 1][j - 1];
        } else {
          arr[i][j] = Math.min(arr[i - 1][j - 1] + 1, Math.min(arr[i][j - 1] + 1, arr[i - 1][j] + 1));
        }
      }
    }
    return arr[b.length][a.length];
  };

  const findExistingItem = (code: string, name: string) => {
    const cleanCode = code ? code.trim().toUpperCase() : "";
    const cleanName = name ? normalizeString(name) : "";

    // 1. Coincidencia exacta por código
    if (cleanCode) {
      const matchByCode = existingItems.find(item => item.code && item.code.trim().toUpperCase() === cleanCode);
      if (matchByCode) return { item: matchByCode, isFuzzy: false };
    }

    // 2. Coincidencia exacta por nombre normalizado
    if (cleanName) {
      const matchByName = existingItems.find(item => normalizeString(item.name) === cleanName);
      if (matchByName) return { item: matchByName, isFuzzy: false };
    }

    // 3. Coincidencia difusa (Fuzzy Matching) usando Levenshtein
    if (cleanName && cleanName.length > 5) {
      let bestMatch: any = null;
      let minDistance = 999;
      
      for (const item of existingItems) {
        const normItemName = normalizeString(item.name);
        
        if (Math.abs(normItemName.length - cleanName.length) <= 5) {
          const dist = getLevenshteinDistance(cleanName, normItemName);
          // Usar el umbral dinámico configurado por el usuario
          const threshold = Math.max(3, Math.floor(cleanName.length * fuzzyThreshold));
          if (dist <= threshold && dist < minDistance) {
            minDistance = dist;
            bestMatch = item;
          }
        }
      }
      
      if (bestMatch) {
        return { item: bestMatch, isFuzzy: true };
      }
    }

    return { item: null, isFuzzy: false };
  };

  const [minBatchMargin, setMinBatchMargin] = useState<number>(() => {
    return parseFloat(localStorage.getItem("ERIKA_TARGET_UTILITY") || "50");
  });

  // Helper de cálculo inteligente de precios basado en metas e histórico
  const getSmartPriceSuggestion = (name: string, cost: number, code: string, currentMinMargin: number) => {
    const margin = currentMinMargin / 100;

    // Buscar coincidencia en el catálogo existente usando la lógica mejorada (difusa)
    const { item: existing, isFuzzy } = findExistingItem(code, name);

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
      
      if (existing.autoPriced) {
        // Si el producto está configurado como autoPriced en la base de datos, siempre recalculamos con el margen meta actual
        price = cost * (1 + margin);
        alertText = "Precio Sugerido (Meta Auto)";
      } else {
        // Si es precio fijo/manual, preservamos el precio histórico a menos que haya inflación
        if (cost > existing.cost) {
          isInflation = true;
          // Ajuste por inflación: mantener el margen histórico limitado a un valor razonable (máx 300%) o el target
          const prevMargin = (existing.cost > 0 && (existing.price - existing.cost) / existing.cost < 3.0) 
            ? (existing.price - existing.cost) / existing.cost 
            : margin;
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
    }

    return { price, alertText, isInflation, isNew, prevPrice, prevCost, isFuzzy, originalExistingName: existing ? existing.name : undefined, originalExistingCode: existing ? existing.code : undefined };
  };

  const generatePreviewAndReturnWarnings = (mapping: { name: number, cost: number, stock: number, code: number, price: number, supplier?: number, location?: number }, data: any[][]) => {
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

      const rawCostVal = row[mapping.cost];
      let rawCost = Number(rawCostVal);
      let costHasError = false;
      const costIsEmpty = rawCostVal === undefined || rawCostVal === null || String(rawCostVal).trim() === "";
      if (costIsEmpty) {
        rawCost = 0;
      } else if (isNaN(rawCost) && typeof rawCostVal === "string") {
        const cleanedStr = String(rawCostVal).replace(/[^0-9.-]+/g, "");
        if (cleanedStr === "") {
          rawCost = NaN;
        } else {
          rawCost = Number(cleanedStr);
        }
      }
      if (isNaN(rawCost)) {
        rawCost = 0;
        costHasError = true;
      }

      let rawCode = row[mapping.code] ? String(row[mapping.code]).trim() : `SKU-${Date.now()}-${i}`;
      let cleanName = cleanAndCapitalize(String(row[mapping.name]));

      // 🔍 Detección Anti-Duplicados usando findExistingItem (difusa)
      let { item: existing, isFuzzy } = findExistingItem(rawCode, cleanName);

      // ⚠️ SEGURIDAD CRÍTICA: Solo reemplazar código y nombre cuando la coincidencia
      // es EXACTA (por código o nombre idéntico). Para coincidencias difusas (fuzzy),
      // conservar siempre el código y nombre ORIGINALES del Excel.
      // Un fuzzy match solo se usa para calcular precio sugerido y mostrar advertencia
      // en la vista previa — NUNCA para reemplazar datos reales.
      const importedCode = rawCode; // Guardar código original del Excel
      const importedName = cleanName; // Guardar nombre original del Excel

      if (existing && !isFuzzy) {
        // Solo para coincidencias exactas: usar el código/nombre de la BD (por si hay variantes de mayúsculas)
        if (existing.code) rawCode = existing.code;
        if (existing.name) cleanName = existing.name;
      }
      // Para isFuzzy: rawCode y cleanName permanecen con el valor original del Excel

      const smartPrices = getSmartPriceSuggestion(cleanName, rawCost, rawCode, minBatchMargin);
      
      const rawStockVal = row[mapping.stock];
      let rawStock = Number(rawStockVal);
      let stockHasError = false;
      const stockIsEmpty = rawStockVal === undefined || rawStockVal === null || String(rawStockVal).trim() === "";
      if (stockIsEmpty) {
         rawStock = 0;
      } else if (isNaN(rawStock)) {
         rawStock = 0;
         stockHasError = true;
      }
      
      let priceHasError = false;
      let finalPrice = (mapping.price !== undefined && mapping.price !== -1 && row[mapping.price] !== undefined) ? row[mapping.price] : undefined;
      let autoPriced = true;
      const priceIsEmpty = finalPrice === undefined || finalPrice === null || String(finalPrice).trim() === "";
      if (priceIsEmpty) {
        finalPrice = smartPrices.price;
        autoPriced = true;
      } else {
        let numericPrice = Number(finalPrice);
        if (isNaN(numericPrice) && typeof finalPrice === "string") {
          const cleanedStr = String(finalPrice).replace(/[^0-9.-]+/g, "");
          if (cleanedStr === "") {
            numericPrice = NaN;
          } else {
            numericPrice = Number(cleanedStr);
          }
        }
        if (isNaN(numericPrice)) {
          finalPrice = smartPrices.price;
          autoPriced = true;
          priceHasError = true;
        } else {
          finalPrice = numericPrice;
          autoPriced = false;
        }
      }

      const isDuplicateInFile = importedProducts.some(p => p.code && p.code.trim().toUpperCase() === rawCode.trim().toUpperCase());
      const rawSupplier = (mapping.supplier !== undefined && row[mapping.supplier]) ? String(row[mapping.supplier]).trim() : "Pendiente";
      const rawLocation = (mapping.location !== undefined && row[mapping.location]) ? String(row[mapping.location]).trim() : "";
      
      const allKnownLocations = Array.from(new Set(existingItems.map(i => i.location).filter(l => l && l !== "Pendiente" && l !== ""))).map(l => String(l).trim().toLowerCase());
      const isUnknownLocation = rawLocation !== "" && !allKnownLocations.includes(rawLocation.toLowerCase());

      // 🏢 SUGERENCIA 1: Validar proveedor contra BD en tiempo real
      const isUnknownSupplier = rawSupplier !== "" && rawSupplier !== "Pendiente" &&
        !dbSuppliers.some(s => s.toLowerCase() === rawSupplier.toLowerCase());

      const isIllegible = !cleanName || cleanName.trim() === "" || cleanName.trim().toLowerCase() === "producto sin nombre";
      const hasLoss = rawCost > 0 && finalPrice <= rawCost;

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
        autoPriced: autoPriced,
        alertText: isDuplicateInFile ? "⚠️ Código Repetido" : smartPrices.alertText,
        isInflation: smartPrices.isInflation,
        isNew: smartPrices.isNew,
        prevPrice: smartPrices.prevPrice,
        prevCost: smartPrices.prevCost,
        isFuzzy: smartPrices.isFuzzy || isFuzzy,
        originalExistingName: smartPrices.originalExistingName || (existing ? existing.name : undefined),
        originalExistingCode: smartPrices.originalExistingCode || (existing ? existing.code : undefined),
        importedCode,    // Código original del Excel — siempre usar este para el import real
        importedName,    // Nombre original del Excel — siempre usar este para el import real
        priceHasError,
        costHasError,
        stockHasError,
        costIsEmpty,
        stockIsEmpty,
        isDuplicateInFile,
        isUnknownLocation,
        isUnknownSupplier,
        isIllegible,
        hasLoss
      });
    }

    // 🤖 Generar advertencias de IA sobre datos sospechosos
    const warnings: string[] = [];
    const emptySup = importedProducts.filter(p => !p.supplier || p.supplier === "Pendiente" || p.supplier.trim() === "");
    const unknownSupList = importedProducts.filter(p => p.isUnknownSupplier);
    const zeroCost = importedProducts.filter(p => p.cost === 0 && !p.costIsEmpty);
    const highPrice = importedProducts.filter(p => p.cost > 0 && p.price > p.cost * 5);
    const hasLossItems = importedProducts.filter(p => p.hasLoss);
    if (emptySup.length > 0) warnings.push(`⚠️ ${emptySup.length} artículo(s) sin proveedor asignado en la columna PROVEEDOR. Revisa el archivo antes de importar.`);
    if (unknownSupList.length > 0) {
      const newSupNames = Array.from(new Set(unknownSupList.map(p => p.supplier))).slice(0, 5).join(", ");
      warnings.push(`🏢 Proveedor(es) nuevo(s) no registrado(s) en el sistema: ${newSupNames}. Se registrarán automáticamente al importar.`);
    }
    if (zeroCost.length > 0) warnings.push(`💰 ${zeroCost.length} artículo(s) con costo = $0 aunque la celda no está vacía. Verifica los precios de compra.`);
    if (highPrice.length > 0) warnings.push(`📈 ${highPrice.length} artículo(s) con precio de venta mayor a 5x el costo. Confirma que el precio es correcto.`);
    if (hasLossItems.length > 0) warnings.push(`🔴 ${hasLossItems.length} artículo(s) se venderían a pérdida (precio ≤ costo). Revisa antes de confirmar.`);
    setAiWarnings(warnings);

    setPreviewData(importedProducts);
  };

  const handleMappingChange = (field: string, newIdx: number) => {
    const newMapping = { ...columnMapping, [field]: newIdx };
    setColumnMapping(newMapping);
    const newDetection = { ...detectionSource, [field]: "👤 Manual" };
    setDetectionSource(newDetection);

    // Guardar plantilla de mapeo manual en localStorage
    localStorage.setItem("erika_excel_mapping", JSON.stringify(newMapping));
    localStorage.setItem("erika_excel_detection", JSON.stringify(newDetection));

    generatePreviewAndReturnWarnings(newMapping, processedRawData);
  };

  const handleEditRow = (index: number, updates: Partial<any>) => {
    if (!previewData) return;
    const newData = [...previewData];
    
    if (updates.name !== undefined) {
      const nameVal = updates.name || "";
      updates.isIllegible = !nameVal || nameVal.trim() === "" || nameVal.trim().toLowerCase() === "producto sin nombre";
    }

    // Recalcular isUnknownSupplier al editar proveedor
    if (updates.supplier !== undefined) {
      const sup = updates.supplier.trim();
      updates.isUnknownSupplier = sup !== "" && sup !== "Pendiente" &&
        !dbSuppliers.some((s: string) => s.toLowerCase() === sup.toLowerCase());
    }

    const costVal = updates.cost !== undefined ? updates.cost : newData[index].cost;
    const priceVal = updates.price !== undefined ? updates.price : newData[index].price;
    updates.hasLoss = costVal > 0 && priceVal <= costVal;

    newData[index] = { ...newData[index], ...updates };
    setPreviewData(newData);
  };

  const handleLinkFuzzyProduct = (originalIndex: number, existingCode: string, existingName: string) => {
    const existing = existingItems.find(item => item.code === existingCode);
    const prevPrice = existing ? existing.price : 0;
    const prevCost = existing ? existing.cost : 0;
    
    handleEditRow(originalIndex, {
      code: existingCode,
      name: existingName,
      isNew: false,
      isFuzzy: false,
      prevPrice,
      prevCost,
      alertText: "🔄 Vincular al Inventario"
    });
    showToast(`Vinculado: "${existingName}"`);
  };

  const handleUndoLink = (index: number) => {
    if (!previewData) return;
    const p = previewData[index];
    const originalCode = p.importedCode || p.code;
    const originalName = p.importedName || p.name;
    
    const smart = getSmartPriceSuggestion(originalName, p.cost, originalCode, minBatchMargin);
    let { isFuzzy } = findExistingItem(originalCode, originalName);

    handleEditRow(index, {
      code: originalCode,
      name: originalName,
      isNew: smart.isNew,
      isFuzzy: isFuzzy,
      prevPrice: smart.prevPrice,
      prevCost: smart.prevCost,
      alertText: smart.alertText,
      price: smart.price
    });
    
    showToast(`Deshecho: "${originalName}"`);
  };

  const downloadCollisionReport = (fuzzyItems: any[]) => {
    setIsGeneratingCsv(true);
    setDownloadCount(prev => {
      const nextCount = prev + 1;
      if (typeof window !== "undefined") {
        localStorage.setItem("erika_csv_download_count", String(nextCount));
      }
      setTimeout(() => {
        const headers = ["Nombre en Excel", "Codigo en Excel", "Producto Existente en Catalogo", "Codigo Existente en Catalogo"];
        const rows = fuzzyItems.map(p => [
          p.importedName || p.name || "",
          p.importedCode || p.code || "",
          p.originalExistingName || "",
          p.originalExistingCode || ""
        ]);
        
        const csvContent = "\uFEFF" + [
          headers.join(","),
          ...rows.map(row => row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(","))
        ].join("\r\n");
        
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `reporte_colisiones_erika_v${nextCount}_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        setIsGeneratingCsv(false);
        setCsvDownloadSuccess(true);
        showToast(`Reporte CSV (v${nextCount}) descargado con éxito`);
        
        setTimeout(() => {
          setCsvDownloadSuccess(false);
        }, 1500);
      }, 600);
      return nextCount;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, field: string) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const fields = ['code', 'name', 'supplier', 'stock', 'cost', 'price', 'location'];
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

  // 🔀 SUGERENCIA 2: Drag & Drop para reordenar filas en la tabla de previsualización
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragRowIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (dragRowIndex === null || dragRowIndex === dropIndex || !previewData) return;
    const newData = [...previewData];
    const [moved] = newData.splice(dragRowIndex, 1);
    newData.splice(dropIndex, 0, moved);
    setPreviewData(newData);
    setDragRowIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragRowIndex(null);
    setDragOverIndex(null);
  };

  const highlightMatch = (text: string, query: string) => {
    if (!query) return text;
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return <span>{parts.map((part, i) => part.toLowerCase() === query.toLowerCase() ? <span key={i} style={{ color: "var(--color-primary)", fontWeight: "bold" }}>{part}</span> : part)}</span>;
  };

  useEffect(() => {
    if (previewData) {
      setPreviewData(prev => {
        if (!prev) return null;
        return prev.map(p => {
          if (p.autoPriced) {
            const smartPrices = getSmartPriceSuggestion(p.name, p.cost, p.code, minBatchMargin);
            return {
              ...p,
              price: smartPrices.price,
              alertText: smartPrices.alertText,
              isInflation: smartPrices.isInflation,
              prevPrice: smartPrices.prevPrice,
              prevCost: smartPrices.prevCost
            };
          }
          return p;
        });
      });
    }
  }, [minBatchMargin]);

  const isUTF8 = (bytes: Uint8Array): boolean => {
    let i = 0;
    while (i < bytes.length) {
      if (bytes[i] <= 0x7f) {
        i += 1;
      } else if (bytes[i] >= 0xc2 && bytes[i] <= 0xdf) {
        if (i + 1 >= bytes.length) return false;
        if (bytes[i + 1] < 0x80 || bytes[i + 1] > 0xbf) return false;
        i += 2;
      } else if (bytes[i] >= 0xe0 && bytes[i] <= 0xef) {
        if (i + 2 >= bytes.length) return false;
        if (bytes[i + 1] < 0x80 || bytes[i + 1] > 0xbf) return false;
        if (bytes[i + 2] < 0x80 || bytes[i + 2] > 0xbf) return false;
        i += 3;
      } else if (bytes[i] >= 0xf0 && bytes[i] <= 0xf4) {
        if (i + 3 >= bytes.length) return false;
        if (bytes[i + 1] < 0x80 || bytes[i + 1] > 0xbf) return false;
        if (bytes[i + 2] < 0x80 || bytes[i + 2] > 0xbf) return false;
        if (bytes[i + 3] < 0x80 || bytes[i + 3] > 0xbf) return false;
        i += 4;
      } else {
        return false;
      }
    }
    return true;
  };

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

        let workbook;
        if (ext === "csv") {
          const isUtf = isUTF8(data);
          if (!isUtf) {
            const decoder = new TextDecoder("windows-1252");
            const decodedText = decoder.decode(data);
            workbook = XLSX.read(decodedText, { type: "string" });
          } else {
            workbook = XLSX.read(data, { type: "array" });
          }
        } else {
          workbook = XLSX.read(data, { type: "array" });
        }

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

        if (rawData.length === 0) {
          throw new Error("El archivo de Excel está vacío y no contiene ningún dato.");
        } else if (rawData.length === 1) {
          throw new Error("El archivo de Excel solo contiene la fila de encabezados. Por favor, agrega al menos una fila con los datos de tus productos antes de subirlo.");
        }

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

        // Heurística inteligente de detección de columnas
        // Fallback = plantilla oficial: CODIGO | PRODUCTO | PROVEEDOR | STOCK | COSTO | PRECIO | BODEGA
        let finalCodeIdx = 0;
        let finalNameIdx = 1;
        let finalSupplierIdx = 2;
        let finalStockIdx = 3;
        let finalCostIdx = 4;
        let finalPriceIdx = 5;
        let finalLocationIdx = 6;
        
        let detectedCode = false, detectedName = false, detectedStock = false, detectedCost = false, detectedPrice = false, detectedSupplier = false;

        // Intentar detectar por cabeceras en la primera fila
        if (rawData.length > 0) {
          const firstRow = rawData[0].map((h: any) => String(h).toLowerCase().trim());
          firstRow.forEach((val, idx) => {
            if (val.includes("prove") || val.includes("brand") || val.includes("proveedor") || val.includes("supplier")) {
              finalSupplierIdx = idx;
              detectedSupplier = true;
            } else if (val.includes("cod") || val.includes("sku") || val.includes("barr") || val === "código") {
              finalCodeIdx = idx;
              detectedCode = true;
            } else if (val.includes("nom") || val.includes("prod") || val.includes("desc") || val.includes("art")) {
              finalNameIdx = idx;
              detectedName = true;
            } else if (val.includes("cant") || val.includes("stock") || val.includes("exis") || val.includes("cantidad")) {
              finalStockIdx = idx;
              detectedStock = true;
            } else if (val.includes("cost") || val.includes("comp") || val.includes("costo")) {
              finalCostIdx = idx;
              detectedCost = true;
            } else if (val.includes("prec") || val.includes("vent") || val.includes("precio")) {
              finalPriceIdx = idx;
              detectedPrice = true;
            } else if (val.includes("ubica") || val.includes("pasi") || val.includes("loc") || val.includes("bod") || val.includes("bodega")) {
              finalLocationIdx = idx;
            }
          });
        }
        
        const source = {
          supplier: detectedSupplier ? "🤖 Auto-detectado" : "📋 Plantilla Oficial",
          code: detectedCode ? "🤖 Auto-detectado" : "📋 Plantilla Oficial",
          name: detectedName ? "🤖 Auto-detectado" : "📋 Plantilla Oficial",
          stock: detectedStock ? "🤖 Auto-detectado" : "📋 Plantilla Oficial",
          cost: detectedCost ? "🤖 Auto-detectado" : "📋 Plantilla Oficial",
          price: detectedPrice ? "🤖 Auto-detectado" : "📋 Plantilla Oficial",
          location: "📋 Plantilla Oficial",
        };

        let mapping = { code: finalCodeIdx, name: finalNameIdx, supplier: finalSupplierIdx, stock: finalStockIdx, cost: finalCostIdx, price: finalPriceIdx, location: finalLocationIdx };
        let finalSource = source;

        // 🧠 Cargar plantilla de mapeo guardada si es compatible con el archivo actual
        // Pero NO sobreescribir si ya detectamos cabeceras explícitas de alta confianza en el archivo
        const hasHighConfidenceDetection = detectedName && (detectedCost || detectedPrice || detectedStock);
        try {
          const savedMappingStr = localStorage.getItem("erika_excel_mapping");
          const savedSourceStr = localStorage.getItem("erika_excel_detection");
          if (savedMappingStr && !hasHighConfidenceDetection) {
            const savedMapping = JSON.parse(savedMappingStr);
            const isValid = Object.values(savedMapping).every(idx => typeof idx === "number" && idx < maxCols);
            if (isValid) {
              mapping = { ...mapping, ...savedMapping };
              // Si el archivo contiene una columna de precio detectada, ignorar el "-1" o undefined guardado y usar la detectada
              if (detectedPrice && (savedMapping.price === undefined || savedMapping.price === -1)) {
                mapping.price = finalPriceIdx;
                finalSource.price = "🤖 Auto-detectado";
              }
              if (savedSourceStr) {
                finalSource = { ...finalSource, ...JSON.parse(savedSourceStr) };
                if (detectedPrice && (savedMapping.price === undefined || savedMapping.price === -1)) {
                  finalSource.price = "🤖 Auto-detectado";
                }
              } else {
                finalSource = {
                  code: "👤 Manual (Guardado)",
                  name: "👤 Manual (Guardado)",
                  stock: "👤 Manual (Guardado)",
                  cost: "👤 Manual (Guardado)",
                  price: detectedPrice && (savedMapping.price === undefined || savedMapping.price === -1) ? "🤖 Auto-detectado" : "👤 Manual (Guardado)",
                  supplier: "👤 Manual (Guardado)",
                  location: "👤 Manual (Guardado)",
                };
              }
            }
          }
        } catch (err) {
          console.error("Error al cargar plantilla de mapeo guardada:", err);
        }

        setColumnMapping(mapping);
        setDetectionSource(finalSource);
        setRawHeaders(headersForSelect);
        setProcessedRawData(rawData);

        setTimeout(() => {
          const preview = generatePreviewAndReturnWarnings(mapping, rawData);
          setIsProcessing(false);
        }, 800);
      } catch (err: any) {
        console.error("Error procesando Excel:", err);
        const errMsg = err?.message || "Error al leer el Excel. Asegúrate de que no esté dañado o encriptado y revisa las columnas.";
        alert(errMsg.includes("encabezado") || errMsg.includes("vacío") ? `⚠️ ${errMsg}` : errMsg);
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
      "🤖 Erika AI Vision OCR — leyendo documento real...",
      "⚡ Detectando productos, códigos y precios...",
      "📊 Calculando márgenes y precios sugeridos..."
    ];

    for (let i = 0; i < steps.length; i++) {
      setProgress(steps[i]);
      await new Promise(resolve => setTimeout(resolve, 700));
    }

    const now = Date.now();
    let rawProducts: any[] = [];

    try {
      // 🤖 Llamada real a Gemini Vision via API route del servidor
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/smart-import", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        rawProducts = result.products || [];
      } else {
        const errData = await response.json().catch(() => ({}));
        // Si Gemini no está configurado, mostrar mensaje claro
        if (errData.error === "GEMINI_API_KEY not configured") {
          alert("⚠️ Para usar OCR con imágenes/PDF necesitas configurar GEMINI_API_KEY en .env.local\n\nAgrega: GEMINI_API_KEY=tu_clave_aqui");
        } else {
          alert(`❌ Error OCR: ${errData.error || "Error desconocido"}\n\nVerifica la imagen y vuelve a intentarlo.`);
        }
        setIsProcessing(false);
        return;
      }
    } catch (fetchErr: any) {
      console.error("Error llamando API smart-import:", fetchErr);
      alert("❌ Error de conexión con el motor OCR. Verifica tu conexión e intenta de nuevo.");
      setIsProcessing(false);
      return;
    }

    if (rawProducts.length === 0) {
      alert("⚠️ No se detectaron productos en el archivo.\nAsegúrate de que la imagen sea clara y contenga una lista de productos con precios.");
      setIsProcessing(false);
      return;
    }

    setProgress(`✅ ${rawProducts.length} productos detectados por IA. Calculando precios...`);
    await new Promise(resolve => setTimeout(resolve, 400));

    const processed = rawProducts.map((p: any, i: number) => {
      let code = p.code ? String(p.code).trim() : `FER-AI-${now}-${i}`;
      let name = p.name ? String(p.name).trim() : "Producto sin nombre";
      const cost = parseFloat(String(p.cost).replace(/[^0-9.-]+/g, "")) || 0;
      const stockVal = parseInt(String(p.stock)) || 1;
      const costIsEmpty = p.cost === undefined || p.cost === null || String(p.cost).trim() === "";
      const stockIsEmpty = p.stock === undefined || p.stock === null || String(p.stock).trim() === "";

      // Detectar si ya existe en inventario (con coincidencia difusa)
      let { item: existing, isFuzzy } = findExistingItem(code, name);
      // ⚠️ SEGURIDAD: Solo usar código/nombre del inventario cuando la coincidencia es EXACTA.
      // Fuzzy match solo se usa para advertencia visual y precio sugerido.
      const importedCode = code; // original del archivo
      const importedName = name; // original del archivo
      if (existing && !isFuzzy) {
        if (existing.code) code = existing.code;
        if (existing.name) name = existing.name;
      }

      const smart = getSmartPriceSuggestion(name, cost, code, minBatchMargin);

      // Si la IA detectó un precio de venta explícito, usarlo en lugar del calculado
      let finalPrice = smart.price;
      let autoPriced = true;
      if (p.price && parseFloat(String(p.price).replace(/[^0-9.-]+/g, "")) > 0) {
        finalPrice = parseFloat(String(p.price).replace(/[^0-9.-]+/g, ""));
        autoPriced = false;
      }

      const isIllegible = !p.name || String(p.name).trim() === "" || String(p.name).trim().toLowerCase() === "producto sin nombre";
      const hasLoss = cost > 0 && finalPrice <= cost;

      const allKnownLocations = Array.from(new Set(existingItems.map(i => i.location).filter(l => l && l !== "Pendiente" && l !== ""))).map(l => String(l).trim().toLowerCase());

      return {
        id: `ai-${now}-${i}`,
        code: code,
        name: cleanAndCapitalize(name),
        cost: cost,
        price: finalPrice,
        stock: stockVal,
        supplier: "Pendiente",
        location: "",
        minStock: 5,
        salesIndex: 50,
        autoPriced: autoPriced,
        alertText: smart.alertText,
        isInflation: smart.isInflation,
        isNew: smart.isNew,
        prevPrice: smart.prevPrice,
        prevCost: smart.prevCost,
        isFuzzy: smart.isFuzzy || isFuzzy,
        originalExistingName: smart.originalExistingName || (existing ? existing.name : undefined),
        importedCode,    // Código original del archivo — usar para el import real
        importedName,    // Nombre original del archivo — usar para el import real
        costHasError: cost === 0,
        stockHasError: false,
        costIsEmpty,
        stockIsEmpty,
        isDuplicateInFile: false,
        isUnknownLocation: false,
        isIllegible,
        hasLoss
      };
    });

    setPreviewData(processed);
    setIsProcessing(false);
  };

  const handleFileSelection = (file: File) => {
    // 🔄 Siempre reiniciar el método de importación al cargar un nuevo archivo
    setImportOption("");
    setPreviewData(null);
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
      const hasIllegible = previewData.some(p => p.isIllegible);
      if (hasIllegible) {
        alert("⚠️ Hay productos con nombres vacíos o no legibles. Edítalos en la tabla antes de continuar.");
        return;
      }

      // SUGERENCIA 1: Validación semántica de valores no numéricos o negativos en la carga
      const invalidRows = previewData.filter(p => 
        p.costHasError || p.stockHasError || p.priceHasError || 
        p.cost < 0 || p.price < 0 || p.stock < 0
      );
      if (invalidRows.length > 0) {
        const rowDetails = invalidRows.slice(0, 5).map(p => {
          const reasons = [];
          if (p.costHasError) reasons.push("Costo no numérico");
          else if (p.cost < 0) reasons.push("Costo negativo");
          if (p.stockHasError) reasons.push("Stock no numérico");
          else if (p.stock < 0) reasons.push("Stock negativo");
          if (p.priceHasError) reasons.push("Precio no numérico");
          else if (p.price < 0) reasons.push("Precio negativo");
          return `- "${p.name}": ${reasons.join(", ")}`;
        }).join("\n");
        alert(`⚠️ Hay ${invalidRows.length} producto(s) con valores no numéricos o negativos en Costo, Stock o Precio. Corrígelos en la tabla antes de importar.\n\nEjemplos:\n${rowDetails}`);
        return;
      }

      // 🔴 Validación preventiva de Margen Negativo (Venta a Pérdida)
      const lossItems = previewData.filter(p => p.hasLoss);
      if (lossItems.length > 0) {
        const proceed = window.confirm(
          `🔴 ALERTA DE VENTA A PÉRDIDA:\n\nSe detectaron ${lossItems.length} producto(s) cuyo precio de venta es menor o igual al costo (se venderían sin margen o a pérdida):\n\n` +
          `${lossItems.slice(0, 8).map(p => `- "${p.name}": Costo $${p.cost.toFixed(2)} | Precio $${p.price.toFixed(2)}`).join("\n")}` +
          `${lossItems.length > 8 ? `\n... y ${lossItems.length - 8} más.` : ""}\n\n` +
          `¿Estás seguro de que deseas importar estos artículos con estos precios a pérdida?`
        );
        if (!proceed) return;
      }

      // Advertir si hay artículos sin proveedor
      const emptySup = previewData.filter(p => !p.supplier || p.supplier === "Pendiente" || p.supplier.trim() === "");
      if (emptySup.length > 0) {
        const proceed = window.confirm(
          `⚠️ ERIKA IA - AVISO DE PROVEEDOR:\n\n${emptySup.length} artículo(s) no tienen proveedor asignado en la columna PROVEEDOR del archivo.\n\nEjemplos:\n${emptySup.slice(0, 5).map(p => `- "${p.name}"`).join('\n')}\n\n¿Deseas continuar de todas formas? (se registrarán como "Pendiente")`
        );
        if (!proceed) return;
      }

      // Alerta de duplicidad en base a Levenshtein si se importa como nuevo
      if (importOption === "nuevo") {
        const fuzzyMatches: string[] = [];
        previewData.forEach(p => {
          const { item: match } = findExistingItem(p.code, p.name);
          if (match) {
            fuzzyMatches.push(`- "${p.name}" es muy similar a "${match.name}" (código: ${match.code || 'Pendiente'})`);
          }
        });

        if (fuzzyMatches.length > 0) {
          const proceed = window.confirm(
            `⚠️ ALERTA DE DUPLICADOS EN DETECTADOS:\n\nSe encontraron productos en tu archivo con nombres muy similares a los ya existentes en inventario:\n\n${fuzzyMatches.slice(0, 8).join("\n")}${fuzzyMatches.length > 8 ? `\n... y ${fuzzyMatches.length - 8} más.` : ""}\n\n¿Estás seguro de que deseas agregarlos como productos nuevos independientes (pudiendo crear duplicados visuales)?`
          );
          if (!proceed) return;
        }
      }

      // SUGERENCIA 2: Resumen Analítico de Importación
      const total = previewData.length;
      const nuevos = previewData.filter(p => p.isNew).length;
      const existentes = previewData.filter(p => !p.isNew).length;
      const sinProveedor = previewData.filter(p => !p.supplier || p.supplier === "Pendiente" || p.supplier.trim() === "").length;
      const conInflacion = previewData.filter(p => p.isInflation).length;

      const confirmMessage = `📦 YoY IA ERIKA — RESUMEN ANALÍTICO DE IMPORTACIÓN\n\n` +
        `Estás a punto de procesar los siguientes cambios en tu catálogo:\n` +
        `• Total de artículos a procesar: ${total}\n` +
        `• 🆕 Artículos nuevos que se crearán: ${nuevos}\n` +
        `• 🔄 Artículos existentes que se actualizarán: ${existentes}\n` +
        `• ⏳ Artículos que quedarán sin proveedor: ${sinProveedor}\n` +
        `• ⚠️ Artículos detectados con incremento (Inflación): ${conInflacion}\n\n` +
        `¿Confirmas que deseas aplicar estos cambios en tu base de datos?`;

      if (!window.confirm(confirmMessage)) return;

      // Ya no se pregunta por proveedor global — viene del Excel por fila
      executeImport();
    }
  };

  const executeImport = async () => {
    if (!previewData) return;

    // Auto-registrar proveedores nuevos encontrados en el archivo
    const uniqueFileSuppliers = Array.from(new Set(
      previewData
        .map(p => p.supplier)
        .filter((s: string) => s && s !== "Pendiente" && s.trim() !== "")
        .map((s: string) => cleanAndCapitalize(s))
    ));
    for (const sup of uniqueFileSuppliers) {
      const exists = dbSuppliers.some(s => s.toLowerCase() === sup.toLowerCase());
      if (!exists) {
        try {
          await supabase.from("suppliers").insert({ name: sup });
          setDbSuppliers(prev => [...prev, sup]);
        } catch (err) {
          console.error("Error al registrar proveedor automático:", err);
        }
      }
    }

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
      const finalSupplier = (p.supplier && p.supplier !== "Pendiente" && p.supplier.trim() !== "") 
        ? cleanAndCapitalize(p.supplier) 
        : "Pendiente";
      return { ...p, supplier: finalSupplier, location: assignedLocation };
    });

    onImport(finalProducts, importOption as any, accumulateStock);

    // 📜 SUGERENCIA 1: Registrar historial de importación en Supabase
    try {
      const supplierBreakdown: Record<string, number> = {};
      finalProducts.forEach(p => {
        const sup = p.supplier || 'Pendiente';
        supplierBreakdown[sup] = (supplierBreakdown[sup] || 0) + 1;
      });
      await supabase.from('import_logs').insert({
        imported_at: new Date().toISOString(),
        filename: uploadedFile ? uploadedFile.name : 'Pegado desde portapapeles',
        total_articles: finalProducts.length,
        import_option: importOption,
        suppliers_breakdown: JSON.stringify(supplierBreakdown),
        new_count: finalProducts.filter(p => p.isNew).length,
        update_count: finalProducts.filter(p => !p.isNew).length,
      });
    } catch (err) {
      // El historial es no-bloqueante; si falla la tabla no existe aún, no interrumpir
      console.warn('Historial de importación no guardado (tabla import_logs no disponible):', err);
    }

    onClose();
  };

  // getLevenshteinDistance y findExistingItem se movieron al inicio del componente para poder ser usados en cascada.

  const handleLocationFix = (oldLocation: string) => {
    const knownLocations = Array.from(new Set(existingItems.map(i => i.location).filter(l => l && l !== "Pendiente" && l !== ""))).map(l => String(l));
    let suggestion = "";
    let minDistance = Infinity;
    
    knownLocations.forEach(loc => {
      const dist = getLevenshteinDistance(oldLocation.toLowerCase(), loc.toLowerCase());
      if (dist < minDistance && dist <= 3) {
        minDistance = dist;
        suggestion = loc;
      }
    });

    const promptText = suggestion 
      ? `Corrección de Bodega en Vivo:\n\nDetectamos "${oldLocation}".\n💡 ¿Acaso quisiste decir "${suggestion}"?\n\nEscribe el nombre correcto para reemplazarla:` 
      : `Corrección de Bodega en Vivo:\n\nSe detectó la bodega desconocida "${oldLocation}".\nEscribe el nombre correcto para reemplazarla:`;

    const newLocation = prompt(promptText, suggestion || oldLocation);
    if (!newLocation || newLocation.trim() === "" || newLocation === oldLocation) return;
    
    const allKnownLower = knownLocations.map(l => l.toLowerCase());
    const isUnknownLocation = !allKnownLower.includes(newLocation.toLowerCase());
    
    setPreviewData(prev => prev ? prev.map(p => p.location === oldLocation ? { ...p, location: newLocation, isUnknownLocation } : p) : null);
    alert(`✅ Bodega actualizada a "${newLocation}" en todos los productos afectados.`);
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
                      <th style={{ padding: "8px", width: "28px", color: "rgba(255,255,255,0.3)", textAlign: "center" }} title="Arrastra para reordenar">☰</th>
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
                      <th style={{ padding: "8px", background: "rgba(251,146,60,0.1)", borderLeft: "2px solid rgba(251,146,60,0.4)" }}>
                        <div style={{ fontSize: "0.7rem", marginBottom: "4px", color: "#fb923c" }}>{detectionSource.supplier || "📋 Plantilla Oficial"}</div>
                        <select value={columnMapping.supplier} onChange={(e) => handleMappingChange("supplier", parseInt(e.target.value))} style={{ background: "rgba(0,0,0,0.5)", color: "white", border: "1px solid rgba(251,146,60,0.4)", borderRadius: "4px", padding: "2px", width: "100%", fontSize: "0.8rem" }}>
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
                      <th style={{ padding: "8px", color: "white", background: "rgba(16, 185, 129, 0.2)" }}>
                        <div style={{ fontSize: "0.7rem", marginBottom: "4px" }}>{detectionSource.price || "📋 Auto calcular"}</div>
                        <select value={columnMapping.price} onChange={(e) => handleMappingChange("price", parseInt(e.target.value))} style={{ background: "rgba(0,0,0,0.5)", color: "white", border: "1px solid var(--glass-border)", borderRadius: "4px", padding: "2px", width: "100%", fontSize: "0.8rem" }}>
                          <option value={-1}>-- Auto calcular --</option>
                          {rawHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                        </select>
                      </th>
                      <th style={{ padding: "8px" }}>Bodega</th>
                      <th style={{ padding: "8px" }}>Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.length === 0 ? (
                      <tr>
                        <td colSpan={9} style={{ padding: "40px 20px", textAlign: "center", color: "#f87171" }}>
                          <div style={{ fontSize: "1.1rem", fontWeight: "bold", marginBottom: "8px" }}>
                            ⚠️ No se detectaron productos a importar
                          </div>
                          <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.6)" }}>
                            El archivo no contiene filas válidas o las columnas no están correctamente mapeadas.<br/>
                            Asegúrate de que la columna de <strong>Producto (Nombre)</strong> esté asignada a la columna correcta de tu Excel.
                          </div>
                        </td>
                      </tr>
                    ) : (
                      previewData.map((p, i) => (
                      <tr
                        key={i}
                        draggable
                        onDragStart={(e) => handleDragStart(e, i)}
                        onDragOver={(e) => handleDragOver(e, i)}
                        onDrop={(e) => handleDrop(e, i)}
                        onDragEnd={handleDragEnd}
                        style={{
                          borderBottom: "1px solid rgba(255,255,255,0.05)",
                          background: dragOverIndex === i && dragRowIndex !== i
                            ? "rgba(16,185,129,0.15)"
                            : (p.isInflation ? "rgba(239, 68, 68, 0.08)" : "transparent"),
                          opacity: dragRowIndex === i ? 0.4 : 1,
                          transition: "background 0.15s, opacity 0.15s",
                          cursor: "grab",
                        }}
                      >
                        {/* Handle de drag */}
                        <td
                          style={{ padding: "8px", textAlign: "center", color: "rgba(255,255,255,0.25)", cursor: "grab", userSelect: "none", fontSize: "1rem" }}
                          title="Arrastra para reordenar"
                        >
                          ⋮
                        </td>
                        <td style={{ padding: "8px" }}>
                          <input 
                            id={`input-${i}-code`}
                            type="text" 
                            value={p.code || ""} 
                            onChange={(e) => handleEditRow(i, { code: e.target.value })}
                            onKeyDown={(e) => handleKeyDown(e, i, 'code')}
                            style={{ 
                              width: "100%", 
                              background: p.isDuplicateInFile ? "rgba(234, 179, 8, 0.3)" : (!p.isNew ? "rgba(59,130,246,0.08)" : "transparent"), 
                              border: p.isDuplicateInFile ? "2px solid #eab308" : (!p.isNew ? "1px dashed rgba(59,130,246,0.4)" : "1px dashed var(--glass-border)"), 
                              color: p.isDuplicateInFile ? "#fef08a" : (!p.isNew ? "rgba(147,197,253,0.8)" : "white"), 
                              padding: "2px 4px", 
                              borderRadius: "4px", 
                              fontFamily: "monospace",
                            }}
                            title={p.isDuplicateInFile ? "¡Advertencia! Este código está repetido en el archivo" : (!p.isNew ? "Producto existente — editable (⚠️ cambiar código puede romper la coincidencia)" : "")}
                          />
                        </td>
                        <td style={{ padding: "8px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "5px", position: "relative" }}>
                              <input 
                                id={`input-${i}-name`}
                                type="text" 
                                value={p.name} 
                                onChange={(e) => handleEditRow(i, { name: e.target.value })}
                                onFocus={() => setActiveSuggestRow(i)}
                                onBlur={() => setTimeout(() => setActiveSuggestRow(null), 250)}
                                onKeyDown={(e) => handleKeyDown(e, i, 'name')}
                                style={{ 
                                  width: "100%", 
                                  background: p.isIllegible ? "rgba(239, 68, 68, 0.2)" : (!p.isNew ? "rgba(59,130,246,0.06)" : "transparent"), 
                                  border: p.isIllegible ? "2px solid #ef4444" : (!p.isNew ? "1px dashed rgba(59,130,246,0.35)" : "1px dashed var(--glass-border)"), 
                                  color: p.isIllegible ? "#ef4444" : (!p.isNew ? "rgba(147,197,253,0.9)" : "white"), 
                                  padding: "2px 4px", 
                                  borderRadius: "4px", 
                                  fontWeight: "bold",
                                }}
                                title={p.isIllegible ? "Error: Renglón no legible por la IA o sin nombre. Escribe un nombre válido para corregirlo." : (!p.isNew ? "Producto existente — editable con precaución" : "")}
                              />
                              {p.isIllegible && (
                                <span style={{ fontSize: "0.65rem", background: "rgba(239, 68, 68, 0.2)", color: "#ef4444", border: "1px solid rgba(239, 68, 68, 0.4)", padding: "2px 6px", borderRadius: "4px", whiteSpace: "nowrap" }}>
                                  ⚠️ Fila ilegible por IA
                                </span>
                              )}
                              {activeSuggestRow === i && p.name.length > 1 && existingItems.filter(item => item.name.toLowerCase().includes(p.name.toLowerCase()) && item.name.toLowerCase() !== p.name.toLowerCase()).length > 0 && (
                                <div style={{ position: "absolute", top: "100%", left: 0, minWidth: "200px", background: "#1a1a1a", border: "1px solid var(--color-primary)", borderRadius: "4px", zIndex: 100, maxHeight: "150px", overflowY: "auto", boxShadow: "0 4px 10px rgba(0,0,0,0.5)" }}>
                                  {existingItems.filter(item => item.name.toLowerCase().includes(p.name.toLowerCase()) && item.name.toLowerCase() !== p.name.toLowerCase()).slice(0, 10).map((item, idx) => (
                                    <div 
                                      key={idx} 
                                      onClick={() => {
                                        handleEditRow(i, { name: item.name, code: item.code || p.code, isNew: false, prevCost: item.cost, prevPrice: item.price, autoPriced: false });
                                      }}
                                      style={{ padding: "8px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: "0.75rem", color: "white" }}
                                    >
                                      {highlightMatch(item.name, p.name)} <span style={{ color: "var(--color-secondary)", fontSize: "0.6rem" }}>[{item.code}]</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {!p.isNew && p.isFuzzy && (
                                <span
                                  style={{
                                    fontSize: "0.65rem",
                                    background: "rgba(245, 158, 11, 0.2)",
                                    color: "#f59e0b",
                                    border: "1px solid rgba(245, 158, 11, 0.5)",
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                    whiteSpace: "nowrap",
                                    cursor: "help",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "4px"
                                  }}
                                  title={`⚠️ Coincidencia aproximada (fuzzy) con:\n"${p.originalExistingName}"\n\nEste artículo NO actualizará el producto existente — se importará con su código original.\nSi quieres que actualice el existente, cambia el código manualmente al del inventario.`}
                                >
                                  ⚠️ Parecido a: <em style={{fontStyle:"normal", maxWidth:"120px", overflow:"hidden", textOverflow:"ellipsis", display:"inline-block"}}>{p.originalExistingName || "desconocido"}</em>
                                </span>
                              )}
                              {!p.isNew && !p.isFuzzy && (
                                <span style={{ fontSize: "0.65rem", background: "rgba(59, 130, 246, 0.2)", color: "#3b82f6", padding: "2px 6px", borderRadius: "4px", whiteSpace: "nowrap" }}>
                                  🔄 Match Exacto
                                </span>
                              )}
                              {p.isUnknownLocation && (
                                <span 
                                  onClick={() => handleLocationFix(p.location)}
                                  style={{ cursor: "pointer", fontSize: "0.6rem", background: "rgba(234, 179, 8, 0.2)", color: "#eab308", padding: "2px 4px", borderRadius: "4px", whiteSpace: "nowrap" }} 
                                  title={`Esta bodega ("${p.location}") no existe actualmente. Haz clic para corregirla masivamente.`}
                                >
                                  ⚠️ Bodega Nueva (Clic para corregir)
                                </span>
                              )}
                              {p.isUnknownSupplier && (
                                <span 
                                  style={{ fontSize: "0.6rem", background: "rgba(251, 146, 60, 0.2)", color: "#fb923c", border: "1px solid rgba(251,146,60,0.4)", padding: "2px 6px", borderRadius: "4px", whiteSpace: "nowrap" }} 
                                  title={`El proveedor "${p.supplier}" no está registrado aún. Se creará automáticamente al importar.`}
                                >
                                  🏢 Proveedor Nuevo: {p.supplier}
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
                        {/* Columna PROVEEDOR editable con autocomplete */}
                        <td style={{ padding: "8px", borderLeft: "2px solid rgba(251,146,60,0.3)" }}>
                          <div style={{ position: "relative" }}>
                            <input
                              id={`input-${i}-supplier`}
                              type="text"
                              value={p.supplier === "Pendiente" ? "" : (p.supplier || "")}
                              placeholder="Proveedor..."
                              onChange={(e) => handleEditRow(i, { supplier: e.target.value || "Pendiente" })}
                              onFocus={() => setActiveSuggestRow(i + 10000)}
                              onBlur={() => setTimeout(() => setActiveSuggestRow(null), 250)}
                              onKeyDown={(e) => handleKeyDown(e, i, 'supplier')}
                              style={{
                                width: "100%",
                                minWidth: "90px",
                                background: (!p.supplier || p.supplier === "Pendiente") ? "rgba(239,68,68,0.12)" : (p.isUnknownSupplier ? "rgba(251,146,60,0.15)" : "rgba(16,185,129,0.1)"),
                                border: (!p.supplier || p.supplier === "Pendiente") ? "1px solid rgba(239,68,68,0.4)" : (p.isUnknownSupplier ? "1px solid rgba(251,146,60,0.5)" : "1px solid rgba(16,185,129,0.4)"),
                                color: (!p.supplier || p.supplier === "Pendiente") ? "#f87171" : (p.isUnknownSupplier ? "#fb923c" : "#6ee7b7"),
                                padding: "3px 6px",
                                borderRadius: "6px",
                                fontSize: "0.75rem",
                                fontWeight: "600",
                              }}
                              title={p.isUnknownSupplier ? `"${p.supplier}" es nuevo — se registrará automáticamente` : ""}
                            />
                            {/* Autocomplete dropdown del proveedor */}
                            {activeSuggestRow === i + 10000 && dbSuppliers.filter(s => s.toLowerCase().includes((p.supplier || "").toLowerCase()) && p.supplier !== "Pendiente" && p.supplier !== "").length > 0 && (
                              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#1a1a1a", border: "1px solid #fb923c", borderRadius: "6px", zIndex: 200, maxHeight: "120px", overflowY: "auto", boxShadow: "0 4px 12px rgba(0,0,0,0.6)" }}>
                                {dbSuppliers.filter(s => s.toLowerCase().includes((p.supplier || "").toLowerCase())).slice(0, 8).map((s, si) => (
                                  <div
                                    key={si}
                                    onMouseDown={() => handleEditRow(i, { supplier: s, isUnknownSupplier: false })}
                                    style={{ padding: "6px 8px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: "0.75rem", color: "#6ee7b7" }}
                                  >
                                    🏢 {s}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: "8px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                            <input 
                              id={`input-${i}-stock`}
                              type="number" 
                              value={p.stock} 
                              onChange={(e) => {
                                handleEditRow(i, { stock: Number(e.target.value), stockHasError: false, stockIsEmpty: false });
                              }}
                              onKeyDown={(e) => handleKeyDown(e, i, 'stock')}
                              style={{ 
                                width: "60px", 
                                background: p.stockHasError ? "rgba(239, 68, 68, 0.2)" : (p.stockIsEmpty ? "rgba(234, 179, 8, 0.15)" : "transparent"), 
                                border: p.stockHasError ? "2px solid #ef4444" : (p.stockIsEmpty ? "1px solid #eab308" : "1px dashed var(--glass-border)"), 
                                color: p.stockHasError ? "#ef4444" : (p.stockIsEmpty ? "#facc15" : "white"), 
                                padding: "2px 4px", 
                                borderRadius: "4px" 
                              }}
                              title={p.stockHasError ? "Error: Valor no numérico detectado" : (p.stockIsEmpty ? "Aviso: Celda vacía en el archivo, se registrará como 0" : "")}
                            />
                            {p.stockIsEmpty && (
                              <span style={{ fontSize: "0.55rem", color: "#facc15", fontWeight: "bold" }}>⚠️ Vacío</span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: "8px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                            <div style={{ display: "flex", alignItems: "center" }}>
                              $<input 
                                id={`input-${i}-cost`}
                                type="number" 
                                value={p.cost} 
                                onChange={(e) => {
                                  const newCost = Number(e.target.value);
                                  const smart = getSmartPriceSuggestion(p.name, newCost, p.code, minBatchMargin);
                                  handleEditRow(i, {
                                    cost: newCost,
                                    costHasError: false,
                                    costIsEmpty: false,
                                    price: p.autoPriced ? smart.price : p.price,
                                    alertText: p.autoPriced ? smart.alertText : p.alertText,
                                    isInflation: p.autoPriced ? smart.isInflation : p.isInflation
                                  });
                                }}
                                onKeyDown={(e) => handleKeyDown(e, i, 'cost')}
                                style={{ 
                                  width: "70px", 
                                  background: p.costHasError ? "rgba(239, 68, 68, 0.2)" : (p.costIsEmpty ? "rgba(234, 179, 8, 0.15)" : "transparent"), 
                                  border: p.costHasError ? "2px solid #ef4444" : (p.costIsEmpty ? "1px solid #eab308" : "1px dashed var(--glass-border)"), 
                                  color: p.costHasError ? "#ef4444" : (p.costIsEmpty ? "#facc15" : "white"), 
                                  padding: "2px 4px", 
                                  borderRadius: "4px" 
                                }}
                                title={p.costHasError ? "Error: Valor no numérico detectado" : (p.costIsEmpty ? "Aviso: Celda vacía en el archivo, se registrará como 0" : "")}
                              />
                            </div>
                            {p.costIsEmpty && (
                              <span style={{ fontSize: "0.55rem", color: "#facc15", fontWeight: "bold" }}>⚠️ Vacío</span>
                            )}
                          </div>
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            background: p.hasLoss ? "rgba(239, 68, 68, 0.15)" : "rgba(16, 185, 129, 0.1)",
                            fontWeight: "bold",
                            color: p.hasLoss ? "#ef4444" : "var(--color-secondary)",
                            border: p.hasLoss ? "1px solid #ef4444" : "none"
                          }}
                        >
                          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                            <div style={{ display: "flex", alignItems: "center" }}>
                              $<input 
                                id={`input-${i}-price`}
                                type="number" 
                                value={p.price} 
                                onChange={(e) => {
                                  handleEditRow(i, { price: Number(e.target.value), autoPriced: false, priceHasError: false });
                                }}
                                onKeyDown={(e) => handleKeyDown(e, i, 'price')}
                                style={{ 
                                  width: "70px", 
                                  background: p.priceHasError ? "rgba(239, 68, 68, 0.2)" : "transparent", 
                                  border: p.priceHasError ? "2px solid #ef4444" : (p.hasLoss ? "1px solid #ef4444" : "1px dashed var(--color-primary)"), 
                                  color: p.priceHasError ? "#ef4444" : (p.hasLoss ? "#ef4444" : "var(--color-secondary)"), 
                                  padding: "2px 4px", 
                                  borderRadius: "4px", 
                                  fontWeight: "bold" 
                                }}
                                title={p.priceHasError ? "Error: Valor no numérico detectado" : (p.hasLoss ? "¡Alerta de Pérdida! El precio de venta sugerido es menor o igual al costo." : "")}
                              />
                            </div>
                            {p.hasLoss && (
                              <span style={{ fontSize: "0.55rem", color: "#ef4444", fontWeight: "bold" }}>⚠️ Sin Margen / Pérdida</span>
                            )}
                          </div>
                        </td>
                        {/* Columna BODEGA editable */}
                        <td style={{ padding: "8px" }}>
                          <input
                            id={`input-${i}-location`}
                            type="text"
                            value={p.location || ""}
                            placeholder="Auto..."
                            onChange={(e) => handleEditRow(i, { location: e.target.value })}
                            onKeyDown={(e) => handleKeyDown(e, i, 'location')}
                            style={{
                              width: "100%",
                              minWidth: "55px",
                              background: p.isUnknownLocation ? "rgba(234,179,8,0.15)" : "transparent",
                              border: p.isUnknownLocation ? "1px solid #eab308" : "1px dashed var(--glass-border)",
                              color: p.isUnknownLocation ? "#facc15" : "rgba(255,255,255,0.7)",
                              padding: "3px 5px",
                              borderRadius: "6px",
                              fontSize: "0.75rem",
                            }}
                            title={p.isUnknownLocation ? `Bodega "${p.location}" es nueva` : ""}
                          />
                        </td>
                        <td style={{ padding: "8px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
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
                            {((p.importedCode && p.importedCode !== p.code) || (p.importedName && p.importedName !== p.name)) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUndoLink(i);
                                }}
                                style={{
                                  background: "rgba(239, 68, 68, 0.15)",
                                  border: "1px solid rgba(239, 68, 68, 0.4)",
                                  color: "#ef4444",
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  fontSize: "0.65rem",
                                  cursor: "pointer",
                                  fontWeight: "bold",
                                  whiteSpace: "nowrap"
                                }}
                                title="Deshacer vinculación de este producto y restaurar valores del Excel"
                              >
                                Deshacer
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid var(--glass-border)",
              borderRadius: "12px",
              padding: "20px",
              marginTop: "15px",
              textAlign: "left"
            }}>
              <h4 style={{ color: "var(--color-primary)", margin: "0 0 15px 0", fontSize: "1rem" }}>
                ⚙️ Seleccione el Método de Importación (Obligatorio)
              </h4>
              <div style={{ display: "flex", gap: "15px", flexWrap: "wrap" }}>
                {[
                  {
                    value: "sustituir",
                    title: "Sustituir piezas",
                    desc: "Reemplazar existencias e información de los productos existentes.",
                    icon: "🔄"
                  },
                  {
                    value: "complementar",
                    title: "Complementar inventario",
                    desc: "Solo agregar información de nuevos productos; omitir existentes.",
                    icon: "➕"
                  },
                  {
                    value: "nuevo",
                    title: "Agregar como producto nuevo",
                    desc: "Insertar todo como producto nuevo con su propio stock (evita duplicidad).",
                    icon: "🆕"
                  }
                ].map((opt) => {
                  const isSelected = importOption === opt.value;
                  return (
                    <div
                      key={opt.value}
                      onClick={() => setImportOption(opt.value as any)}
                      onMouseEnter={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.border = "1px solid var(--color-primary)";
                          e.currentTarget.style.background = "rgba(16, 185, 129, 0.05)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.border = "1px solid var(--glass-border)";
                          e.currentTarget.style.background = "rgba(0,0,0,0.3)";
                        }
                      }}
                      style={{
                        flex: 1,
                        minWidth: "220px",
                        padding: "18px 15px",
                        borderRadius: "12px",
                        border: isSelected ? "2px solid var(--color-primary)" : "1px solid var(--glass-border)",
                        background: isSelected ? "rgba(16, 185, 129, 0.18)" : "rgba(0,0,0,0.3)",
                        cursor: "pointer",
                        transition: "all 0.25s ease",
                        boxShadow: isSelected ? "0 0 15px rgba(16, 185, 129, 0.3)" : "none",
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                        position: "relative"
                      }}
                    >
                      {/* Círculo selector visual */}
                      <div style={{
                        position: "absolute",
                        top: "12px",
                        right: "12px",
                        width: "18px",
                        height: "18px",
                        borderRadius: "50%",
                        border: isSelected ? "2px solid var(--color-primary)" : "2px solid rgba(255,255,255,0.3)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.2s ease"
                      }}>
                        {isSelected && (
                          <div style={{
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            background: "var(--color-primary)"
                          }} />
                        )}
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "10px", paddingRight: "20px" }}>
                        <span style={{ fontSize: "1.6rem" }}>{opt.icon}</span>
                        <strong style={{ color: isSelected ? "var(--color-primary)" : "white", fontSize: "1rem" }}>
                          {opt.title}
                        </strong>
                      </div>
                      <p style={{ fontSize: "0.8rem", color: isSelected ? "white" : "rgba(255,255,255,0.6)", margin: 0, lineHeight: 1.35 }}>
                        {opt.desc}
                      </p>
                    </div>
                  );
                })}
              </div>

              {importOption === "sustituir" && (
                <div style={{
                  marginTop: "15px",
                  padding: "12px 18px",
                  borderRadius: "8px",
                  background: "rgba(59, 130, 246, 0.1)",
                  border: "1px solid rgba(59, 130, 246, 0.3)",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px"
                }}>
                  <input
                    type="checkbox"
                    id="accumulate-stock-chk"
                    checked={accumulateStock}
                    onChange={(e) => setAccumulateStock(e.target.checked)}
                    style={{ cursor: "pointer", width: "16px", height: "16px" }}
                  />
                  <label htmlFor="accumulate-stock-chk" style={{ fontSize: "0.85rem", color: "#60a5fa", cursor: "pointer", fontWeight: "500", userSelect: "none" }}>
                    📦 Sumar piezas nuevas a existencias actuales (Recomendado para ferretería)
                  </label>
                </div>
              )}
            </div>

            {importOption === "" && (
              <div style={{
                marginTop: "15px",
                padding: "10px 15px",
                borderRadius: "8px",
                background: "rgba(234, 179, 8, 0.08)",
                border: "1px solid rgba(234, 179, 8, 0.2)",
                textAlign: "center",
                color: "#facc15",
                fontSize: "0.85rem",
                fontWeight: "bold",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px"
              }}>
                <span>💡</span>
                <span>Por favor, haz clic en una de las 3 tarjetas de arriba para elegir el método y poder importar.</span>
              </div>
            )}

            {previewData && previewData.some(p => p.isIllegible) && (
              <div style={{
                marginTop: "15px",
                padding: "10px 15px",
                borderRadius: "8px",
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid #ef4444",
                textAlign: "center",
                color: "#ef4444",
                fontSize: "0.85rem",
                fontWeight: "bold",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px"
              }}>
                <span>⚠️</span>
                <span>Hay productos con nombres vacíos o no legibles. Edítalos en la tabla para poder continuar.</span>
              </div>
            )}

            {/* Panel de advertencias de IA */}
            {aiWarnings.length > 0 && (
              <div style={{
                marginTop: "15px",
                padding: "12px 16px",
                borderRadius: "10px",
                background: "rgba(245, 158, 11, 0.1)",
                border: "1px solid rgba(245, 158, 11, 0.4)",
                display: "flex",
                flexDirection: "column",
                gap: "6px"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <span style={{ fontSize: "1.1rem" }}>🤖</span>
                  <strong style={{ color: "#f59e0b", fontSize: "0.9rem" }}>ERIKA IA — Avisos de Revisión</strong>
                </div>
                {aiWarnings.map((w, idx) => (
                  <div key={idx} style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.85)", paddingLeft: "8px", borderLeft: "2px solid #f59e0b" }}>
                    {w}
                  </div>
                ))}
              </div>
            )}

            {/* SUGERENCIA 3: Resumen por proveedor antes de confirmar */}
            {previewData && importOption !== "" && (() => {
              const supplierMap: Record<string, number> = {};
              previewData.forEach(p => {
                const sup = (p.supplier && p.supplier !== "Pendiente" && p.supplier.trim() !== "") ? p.supplier : "⚠️ Sin Proveedor";
                supplierMap[sup] = (supplierMap[sup] || 0) + 1;
              });
              const entries = Object.entries(supplierMap).sort((a, b) => b[1] - a[1]);
              return entries.length > 0 ? (
                <div style={{
                  marginTop: "15px",
                  padding: "12px 16px",
                  borderRadius: "10px",
                  background: "rgba(16, 185, 129, 0.08)",
                  border: "1px solid rgba(16, 185, 129, 0.3)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "1rem" }}>📊</span>
                    <strong style={{ color: "var(--color-primary)", fontSize: "0.9rem" }}>Resumen por Proveedor</strong>
                    <span style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.5)", marginLeft: "auto" }}>{previewData.length} artículos totales</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {entries.map(([sup, count], idx) => (
                      <div
                        key={idx}
                        onClick={() => {
                          // SUGERENCIA 2: Reemplazo masivo — clic en chip abre prompt
                          const newSup = window.prompt(
                            `🔁 Reemplazo masivo de proveedor\n\nActualmente: "${sup}" (${count} artículos)\n\nEscribe el nuevo proveedor para estos ${count} artículos:`,
                            sup.startsWith("⚠️") ? "" : sup
                          );
                          if (newSup !== null && newSup.trim() !== "") {
                            const oldSup = sup.startsWith("⚠️") ? "" : sup;
                            setPreviewData(prev => prev ? prev.map(p => {
                              const pSup = (p.supplier && p.supplier !== "Pendiente" && p.supplier.trim() !== "") ? p.supplier : "";
                              if (pSup === oldSup) {
                                const isUnknownSupplier = !dbSuppliers.some((s: string) => s.toLowerCase() === newSup.trim().toLowerCase());
                                return { ...p, supplier: newSup.trim(), isUnknownSupplier };
                              }
                              return p;
                            }) : null);
                          }
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "4px 10px",
                          borderRadius: "20px",
                          background: sup.startsWith("⚠️") ? "rgba(239,68,68,0.15)" : "rgba(16,185,129,0.15)",
                          border: `1px solid ${sup.startsWith("⚠️") ? "rgba(239,68,68,0.4)" : "rgba(16,185,129,0.3)"}`,
                          fontSize: "0.8rem",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                        title={`Clic para reasignar los ${count} artículos de "${sup}" a otro proveedor`}
                        onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "none"; }}
                      >
                        <span style={{ fontWeight: "bold", color: sup.startsWith("⚠️") ? "#ef4444" : "var(--color-primary)" }}>{sup}</span>
                        <span style={{
                          background: sup.startsWith("⚠️") ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.3)",
                          borderRadius: "10px",
                          padding: "1px 7px",
                          fontSize: "0.75rem",
                          fontWeight: "bold",
                          color: "white"
                        }}>{count}</span>
                        <span style={{ fontSize: "0.6rem", opacity: 0.6 }}>✏️</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null;
            })()}
            {/* ─── SUGERENCIA 2: Slider de umbral de similitud ─── */}
            <div style={{
              marginTop: "15px",
              padding: "12px 18px",
              borderRadius: "10px",
              background: "rgba(139, 92, 246, 0.08)",
              border: "1px solid rgba(139, 92, 246, 0.3)",
              display: "flex",
              alignItems: "center",
              gap: "14px",
              flexWrap: "wrap"
            }}>
              <span style={{ fontSize: "1rem" }}>🎚️</span>
              <div style={{ flex: 1, minWidth: "220px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <strong style={{ color: "#a78bfa", fontSize: "0.85rem" }}>Sensibilidad de detección de similitud</strong>
                  <span style={{
                    background: "rgba(139,92,246,0.25)",
                    color: "#c4b5fd",
                    padding: "2px 8px",
                    borderRadius: "10px",
                    fontSize: "0.75rem",
                    fontWeight: "bold"
                  }}>
                    {fuzzyThreshold <= 0.07 ? "🔒 Muy Estricto" : fuzzyThreshold <= 0.12 ? "🟡 Estricto" : fuzzyThreshold <= 0.18 ? "🟢 Normal" : fuzzyThreshold <= 0.24 ? "🟠 Permisivo" : "🔴 Muy Permisivo"}
                    {" — "}{Math.round(fuzzyThreshold * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.03"
                  max="0.30"
                  step="0.01"
                  value={fuzzyThreshold}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setFuzzyThreshold(val);
                    localStorage.setItem("erika_fuzzy_threshold", String(val));
                    // Re-generar preview con nuevo umbral
                    if (processedRawData.length > 0) {
                      generatePreviewAndReturnWarnings(columnMapping, processedRawData);
                    }
                  }}
                  style={{ width: "100%", accentColor: "#a78bfa", cursor: "pointer" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.65rem", color: "rgba(255,255,255,0.4)", marginTop: "2px" }}>
                  <span>Proveedores distintos</span>
                  <span>Mismo proveedor</span>
                </div>
              </div>
            </div>

            {/* ─── SUGERENCIA 3: Panel de colisiones colapsable ─── */}
            {(() => {
              const fuzzyItems = previewData
                ? previewData
                    .map((p, idx) => ({ ...p, originalIndex: idx }))
                    .filter(p => p.isFuzzy && p.originalExistingName)
                : [];
              if (fuzzyItems.length === 0) return null;
              return (
                <div style={{
                  marginTop: "15px",
                  borderRadius: "10px",
                  border: "1px solid rgba(245, 158, 11, 0.4)",
                  overflow: "hidden"
                }}>
                  <button
                    onClick={() => setShowCollisionsPanel(p => !p)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 16px",
                      background: "rgba(245, 158, 11, 0.12)",
                      border: "none",
                      cursor: "pointer",
                      color: "#f59e0b",
                      fontWeight: "bold",
                      fontSize: "0.85rem",
                      textAlign: "left"
                    }}
                  >
                    <span style={{ fontSize: "1rem" }}>⚠️</span>
                    <span style={{ flex: 1 }}>
                      {fuzzyItems.length} artículo(s) con nombre similar a productos existentes
                      <span style={{ fontWeight: "normal", fontSize: "0.75rem", marginLeft: "8px", opacity: 0.7 }}>
                        (se importarán como NUEVOS — no actualizarán los existentes)
                      </span>
                    </span>
                    <span style={{ fontSize: "0.8rem", opacity: 0.7 }}>{showCollisionsPanel ? "▲ Ocultar" : "▼ Ver lista"}</span>
                  </button>
                  {showCollisionsPanel && (
                    <div style={{
                      background: "rgba(0,0,0,0.3)",
                      padding: "12px 16px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      maxHeight: "250px",
                      overflowY: "auto",
                      pointerEvents: isGeneratingCsv ? "none" : "auto",
                      opacity: isGeneratingCsv ? 0.6 : 1,
                      transition: "opacity 0.2s ease"
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "10px" }}>
                        <span style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.5)" }}>
                          Revisa si alguno de estos artículos debería actualizar al existente.
                        </span>
                        <button
                          onClick={() => downloadCollisionReport(fuzzyItems)}
                          disabled={isGeneratingCsv}
                          style={{
                            background: csvDownloadSuccess ? "rgba(16, 185, 129, 0.2)" : "rgba(245, 158, 11, 0.2)",
                            border: csvDownloadSuccess ? "1px solid rgba(16, 185, 129, 0.5)" : "1px solid rgba(245, 158, 11, 0.5)",
                            color: csvDownloadSuccess ? "#10b981" : "#f59e0b",
                            padding: "4px 10px",
                            borderRadius: "6px",
                            fontSize: "0.75rem",
                            cursor: isGeneratingCsv ? "not-allowed" : "pointer",
                            fontWeight: "bold",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                            opacity: isGeneratingCsv ? 0.6 : 1,
                            transition: "all 0.3s ease"
                          }}
                          title="Descargar todos los conflictos en formato CSV"
                        >
                          {isGeneratingCsv ? "⏳ Generando CSV..." : csvDownloadSuccess ? "✓ Descargado" : "Descargar CSV"}
                        </button>
                      </div>
                      {fuzzyItems.map((p, idx) => (
                        <div key={idx} style={{
                          display: "grid",
                          gridTemplateColumns: "1fr auto 1fr auto",
                          alignItems: "center",
                          gap: "12px",
                          padding: "8px 12px",
                          background: "rgba(245,158,11,0.06)",
                          borderRadius: "6px",
                          border: "1px solid rgba(245,158,11,0.15)",
                          fontSize: "0.78rem"
                        }}>
                          <div>
                            <div style={{ color: "#fcd34d", fontWeight: "bold" }}>📄 {p.importedName || p.name}</div>
                            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.7rem" }}>Código Excel: {p.importedCode || p.code}</div>
                          </div>
                          <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "1.2rem", textAlign: "center" }}>↔️</div>
                          <div>
                            <div style={{ color: "#6ee7b7", fontWeight: "bold" }}>📦 {p.originalExistingName}</div>
                            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.7rem" }}>En inventario actual (Cód: {p.originalExistingCode})</div>
                          </div>
                          <div>
                            <button
                              onClick={() => handleLinkFuzzyProduct(p.originalIndex, p.originalExistingCode!, p.originalExistingName!)}
                              style={{
                                background: "rgba(110, 231, 183, 0.15)",
                                border: "1px solid rgba(110, 231, 183, 0.4)",
                                color: "#6ee7b7",
                                padding: "4px 8px",
                                borderRadius: "4px",
                                fontSize: "0.72rem",
                                cursor: "pointer",
                                fontWeight: "bold",
                                whiteSpace: "nowrap"
                              }}
                              title="Vincular este producto al existente usando su código"
                            >
                              Vincular
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            <div style={{ display: "flex", gap: "15px", justifyContent: "center", marginTop: "20px" }}>
              <button
                className="btn-primary"
                onClick={() => { setPreviewData(null); setUploadedFile(null); setFilePreviewUrl(null); setImportOption(""); }}
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-primary)",
                }}
              >
                Cancelar
              </button>
              <button
                className="btn-primary"
                onClick={confirmImport}
                disabled={importOption === "" || !previewData || previewData.length === 0 || previewData.some(p => p.isIllegible)}
                style={{
                  background: "var(--color-primary)",
                  opacity: (importOption === "" || !previewData || previewData.length === 0 || previewData.some(p => p.isIllegible)) ? 0.5 : 1,
                  cursor: (importOption === "" || !previewData || previewData.length === 0 || previewData.some(p => p.isIllegible)) ? "not-allowed" : "pointer"
                }}
              >
                {!previewData || previewData.length === 0
                  ? "⚠️ No hay productos que importar"
                  : (previewData.some(p => p.isIllegible)
                    ? "⚠️ Corrija nombres ilegibles"
                    : (importOption === "" ? "⏳ Elija un método" : "✅ Confirmar e Importar"))
                }
              </button>
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
              <p style={{ marginBottom: "10px" }}>La plantilla coincide exactamente con la tabla del inventario. Cada columna corresponde con lo que ves en pantalla, facilitando la detección de errores:</p>
              <ol style={{ marginLeft: "20px", marginBottom: "15px", opacity: 0.9, display: "flex", flexDirection: "column", gap: "5px" }}>
                <li><strong>Columna A (1):</strong> Código de Barras / SKU</li>
                <li><strong>Columna B (2):</strong> Nombre del Producto</li>
                <li style={{ color: "var(--color-primary)", fontWeight: "bold" }}><strong>Columna C (3):</strong> 🏢 Proveedor <em style={{ color: "rgba(255,255,255,0.6)", fontWeight: "normal" }}>(Se asigna automático por artículo)</em></li>
                <li><strong>Columna D (4):</strong> Stock (Cantidad)</li>
                <li><strong>Columna E (5):</strong> Costo Proveedor</li>
                <li><strong>Columna F (6):</strong> Precio Venta <em>(Opcional, ERIKA lo calcula si está vacío)</em></li>
                <li><strong>Columna G (7):</strong> Bodega/Ubicación <em>(Opcional, ERIKA asume la ubicación si está vacía)</em></li>
              </ol>
              <button 
                onClick={() => {
                  // PLANTILLA: coincide con el orden de la tabla del inventario
                  // CODIGO | PRODUCTO | PROVEEDOR | STOCK | COSTO | PRECIO | BODEGA
                  const wsData: any[][] = [
                    ["CODIGO", "PRODUCTO", "PROVEEDOR", "STOCK", "COSTO", "PRECIO", "BODEGA"],
                    ["", "", "", "", "", "", ""]
                  ];
                  const ws = XLSX.utils.aoa_to_sheet(wsData);
                  ws["!cols"] = [{wch: 15}, {wch: 30}, {wch: 20}, {wch: 10}, {wch: 12}, {wch: 12}, {wch: 15}];

                  // Lista directa de proveedores (evita referencias entre hojas que causan error de lectura)
                  const validSuppliers = dbSuppliers.length > 0
                    ? dbSuppliers.slice(0, 20).join(",")  // Máx 20 proveedores en la lista
                    : "Pendiente";
                  // Solo agregar dataValidation si la lista cabe en 255 chars
                  if (validSuppliers.length <= 255) {
                    ws["!dataValidation"] = [{
                      sqref: "C2:C5000",
                      type: "list",
                      allowBlank: true,
                      showDropDown: false,
                      showErrorMessage: false,
                      formula1: `"${validSuppliers}"`
                    }];
                  }

                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, "Inventario");

                  const today = new Date();
                  const dateStr = `${today.getDate()}-${today.toLocaleString('es-ES', { month: 'short' })}-${today.getFullYear()}`;
                  XLSX.writeFile(wb, `ERIKA_Plantilla_Blanco_${dateStr}.xlsx`);
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
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleFileSelection(e.target.files[0]);
                    }
                    e.target.value = ""; // Restablecer input para permitir volver a cargar el mismo archivo
                  }}
                />
                
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.style.background = "rgba(16, 185, 129, 0.1)";
                    e.currentTarget.style.border = "2px dashed #10b981";
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.currentTarget.style.background = "rgba(0,0,0,0.2)";
                    e.currentTarget.style.border = "2px dashed var(--color-primary)";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.style.background = "rgba(0,0,0,0.2)";
                    e.currentTarget.style.border = "2px dashed var(--color-primary)";
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      handleFileSelection(e.dataTransfer.files[0]);
                    }
                  }}
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
                  <strong style={{ color: "var(--color-primary)" }}>Seleccionar o arrastrar archivo aquí</strong>
                  <span style={{ fontSize: "0.8rem", opacity: 0.6 }}>Formatos: Excel, CSV, PDF o Imágenes (JPG, PNG)</span>
                </div>

                {/* Banner de Pegar desde Portapapeles */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "14px 18px",
                    borderRadius: "10px",
                    background: "rgba(99, 102, 241, 0.1)",
                    border: "1px dashed rgba(99, 102, 241, 0.5)",
                    cursor: "default",
                  }}
                >
                  <span style={{ fontSize: "1.6rem" }}>📋</span>
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontWeight: "bold", color: "#a5b4fc", fontSize: "0.9rem" }}>
                      ¿Tienes los datos en Excel? ¡Pégalos directo aquí!
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.5)", marginTop: "2px" }}>
                      Copia las celdas en Excel → haz clic fuera de cualquier campo → presiona{" "}
                      <kbd style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "4px", padding: "1px 6px", fontSize: "0.75rem", fontFamily: "monospace" }}>Ctrl+V</kbd>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Modal de proveedor global eliminado — proveedor viene por fila desde el Excel */}

        {showNewSupplierModal && (
          <div style={{ zIndex: 1300, position: "relative" }}>
            <SuppliersManagerModal onClose={() => { setShowNewSupplierModal(false); fetchSuppliers(); }} />
          </div>
        )}

        {/* 🔔 Toast Notification Stack */}
        <div style={{
          position: "fixed",
          bottom: "20px",
          right: "20px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          zIndex: 9999,
          pointerEvents: "none"
        }}>
          <style dangerouslySetInnerHTML={{ __html: `
            @keyframes erikaSlideIn {
              from {
                transform: translateX(120%);
                opacity: 0;
              }
              to {
                transform: translateX(0);
                opacity: 1;
              }
            }
          ` }} />
          {toasts.map((t) => (
            <div
              key={t.id}
              style={{
                background: "#10b981",
                color: "white",
                padding: "12px 20px",
                borderRadius: "8px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                fontWeight: "bold",
                fontSize: "0.9rem",
                animation: "erikaSlideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards",
                pointerEvents: "auto"
              }}
            >
              <span>✅</span>
              <span style={{ flex: 1 }}>{t.message}</span>
              <span
                onClick={() => setToasts(prev => prev.filter(item => item.id !== t.id))}
                style={{
                  cursor: "pointer",
                  marginLeft: "10px",
                  opacity: 0.7,
                  fontSize: "0.8rem",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  background: "rgba(255,255,255,0.18)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "opacity 0.15s, background 0.15s"
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = "1";
                  e.currentTarget.style.background = "rgba(255,255,255,0.3)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = "0.7";
                  e.currentTarget.style.background = "rgba(255,255,255,0.18)";
                }}
                title="Cerrar notificación"
              >
                ✕
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
