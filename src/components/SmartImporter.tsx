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
  const [columnMapping, setColumnMapping] = useState({ name: -1, cost: -1, stock: -1, code: -1, price: -1 });
  const [detectionSource, setDetectionSource] = useState({ name: "", cost: "", stock: "", code: "", price: "" });
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
          const threshold = Math.max(3, Math.floor(cleanName.length * 0.15));
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

    return { price, alertText, isInflation, isNew, prevPrice, prevCost, isFuzzy, originalExistingName: existing ? existing.name : undefined };
  };

  const generatePreview = (mapping: { name: number, cost: number, stock: number, code: number, price: number, supplier?: number, location?: number }, data: any[][]) => {
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
        rawCost = Number(String(rawCostVal).replace(/[^0-9.-]+/g, ""));
      }
      if (isNaN(rawCost)) {
        rawCost = 0;
        costHasError = true;
      }

      let rawCode = row[mapping.code] ? String(row[mapping.code]).trim() : `SKU-${Date.now()}-${i}`;
      let cleanName = cleanAndCapitalize(String(row[mapping.name]));

      // 🔍 Detección Anti-Duplicados usando findExistingItem (difusa)
      let { item: existing, isFuzzy } = findExistingItem(rawCode, cleanName);

      if (existing) {
        if (existing.code) rawCode = existing.code;
        if (existing.name) cleanName = existing.name;
      }

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
      
      // Obtener el precio de la columna mapeada si está definida, de lo contrario auto-calcular
      let finalPrice = (mapping.price !== undefined && mapping.price !== -1 && row[mapping.price] !== undefined) ? row[mapping.price] : undefined;
      let autoPriced = true;
      if (finalPrice === undefined || finalPrice === null || String(finalPrice).trim() === "") {
        finalPrice = smartPrices.price;
        autoPriced = true;
      } else {
        finalPrice = Number(String(finalPrice).replace(/[^0-9.-]+/g, ""));
        if (isNaN(finalPrice)) {
          finalPrice = smartPrices.price;
          autoPriced = true;
        } else {
          autoPriced = false;
        }
      }

      const isDuplicateInFile = importedProducts.some(p => p.code && p.code.trim().toUpperCase() === rawCode.trim().toUpperCase());
      const rawSupplier = (mapping.supplier !== undefined && row[mapping.supplier]) ? String(row[mapping.supplier]).trim() : "Pendiente";
      const rawLocation = (mapping.location !== undefined && row[mapping.location]) ? String(row[mapping.location]).trim() : "";
      
      const allKnownLocations = Array.from(new Set(existingItems.map(i => i.location).filter(l => l && l !== "Pendiente" && l !== ""))).map(l => String(l).trim().toLowerCase());
      const isUnknownLocation = rawLocation !== "" && !allKnownLocations.includes(rawLocation.toLowerCase());

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
        costHasError,
        stockHasError,
        costIsEmpty,
        stockIsEmpty,
        isDuplicateInFile,
        isUnknownLocation,
        isIllegible,
        hasLoss
      });
    }
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

    generatePreview(newMapping, processedRawData);
  };

  const handleEditRow = (index: number, updates: Partial<any>) => {
    if (!previewData) return;
    const newData = [...previewData];
    
    if (updates.name !== undefined) {
      const nameVal = updates.name || "";
      updates.isIllegible = !nameVal || nameVal.trim() === "" || nameVal.trim().toLowerCase() === "producto sin nombre";
    }

    const costVal = updates.cost !== undefined ? updates.cost : newData[index].cost;
    const priceVal = updates.price !== undefined ? updates.price : newData[index].price;
    updates.hasLoss = costVal > 0 && priceVal <= costVal;

    newData[index] = { ...newData[index], ...updates };
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

        // Heurística inteligente de detección de columnas (con fallback a plantilla estricta)
        let finalCodeIdx = 0;
        let finalNameIdx = 1;
        let finalStockIdx = 2;
        let finalCostIdx = 3;
        let finalPriceIdx = 4;
        let finalSupplierIdx = 5;
        let finalLocationIdx = 6;
        
        let detectedCode = false, detectedName = false, detectedStock = false, detectedCost = false, detectedPrice = false;

        // Intentar detectar por cabeceras en la primera fila
        if (rawData.length > 0) {
          const firstRow = rawData[0].map((h: any) => String(h).toLowerCase().trim());
          firstRow.forEach((val, idx) => {
            if (val.includes("cod") || val.includes("sku") || val.includes("barr") || val === "código") {
              finalCodeIdx = idx;
              detectedCode = true;
            } else if (val.includes("nom") || val.includes("prod") || val.includes("desc") || val.includes("art")) {
              finalNameIdx = idx;
              detectedName = true;
            } else if (val.includes("cant") || val.includes("stock") || val.includes("exis") || val.includes("cantidad")) {
              finalStockIdx = idx;
              detectedStock = true;
            } else if (val.includes("cost") || val.includes("comp") || val.includes("prov") || val.includes("costo")) {
              finalCostIdx = idx;
              detectedCost = true;
            } else if (val.includes("prec") || val.includes("vent") || val.includes("precio")) {
              finalPriceIdx = idx;
              detectedPrice = true;
            } else if (val.includes("prove") || val.includes("brand") || val.includes("proveedor")) {
              finalSupplierIdx = idx;
            } else if (val.includes("ubica") || val.includes("pasi") || val.includes("loc") || val.includes("bod") || val.includes("bodega")) {
              finalLocationIdx = idx;
            }
          });
        }
        
        const source = {
          code: detectedCode ? "🤖 Auto-detectado" : "📋 Plantilla Oficial",
          name: detectedName ? "🤖 Auto-detectado" : "📋 Plantilla Oficial",
          stock: detectedStock ? "🤖 Auto-detectado" : "📋 Plantilla Oficial",
          cost: detectedCost ? "🤖 Auto-detectado" : "📋 Plantilla Oficial",
          price: detectedPrice ? "🤖 Auto-detectado" : "📋 Plantilla Oficial",
          supplier: "📋 Plantilla Oficial",
          location: "📋 Plantilla Oficial",
        };

        let mapping = { name: finalNameIdx, cost: finalCostIdx, stock: finalStockIdx, code: finalCodeIdx, price: finalPriceIdx, supplier: finalSupplierIdx, location: finalLocationIdx };
        let finalSource = source;

        // 🧠 Cargar plantilla de mapeo guardada si es compatible con el archivo actual
        try {
          const savedMappingStr = localStorage.getItem("erika_excel_mapping");
          const savedSourceStr = localStorage.getItem("erika_excel_detection");
          if (savedMappingStr) {
            const savedMapping = JSON.parse(savedMappingStr);
            const isValid = Object.values(savedMapping).every(idx => typeof idx === "number" && idx < maxCols);
            if (isValid) {
              mapping = savedMapping;
              if (savedSourceStr) {
                finalSource = JSON.parse(savedSourceStr);
              } else {
                finalSource = {
                  code: "👤 Manual (Guardado)",
                  name: "👤 Manual (Guardado)",
                  stock: "👤 Manual (Guardado)",
                  cost: "👤 Manual (Guardado)",
                  price: "👤 Manual (Guardado)",
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
      if (existing) {
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
      setShowSupplierModal(true);
    }
  };

  const executeImport = async (globalSupplier: string) => {
    if (!previewData || !globalSupplier) return;

    const cleanSupplier = cleanAndCapitalize(globalSupplier);
    const exists = dbSuppliers.some(s => s.toLowerCase() === cleanSupplier.toLowerCase());
    if (!exists && cleanSupplier !== "") {
      try {
        await supabase.from("suppliers").insert({ name: cleanSupplier });
        setDbSuppliers(prev => [...prev, cleanSupplier]);
      } catch (err) {
        console.error("Error al registrar proveedor automático:", err);
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
      const finalSupplier = (p.supplier && p.supplier !== "Pendiente" && p.supplier !== "") 
        ? cleanAndCapitalize(p.supplier) 
        : cleanSupplier;
      return { ...p, supplier: finalSupplier, location: assignedLocation };
    });

    onImport(finalProducts, importOption as any, accumulateStock);
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
                      <th style={{ padding: "8px", color: "white", background: "rgba(16, 185, 129, 0.2)" }}>
                        <div style={{ fontSize: "0.7rem", marginBottom: "4px" }}>{detectionSource.price || "📋 Auto calcular"}</div>
                        <select value={columnMapping.price} onChange={(e) => handleMappingChange("price", parseInt(e.target.value))} style={{ background: "rgba(0,0,0,0.5)", color: "white", border: "1px solid var(--glass-border)", borderRadius: "4px", padding: "2px", width: "100%", fontSize: "0.8rem" }}>
                          <option value={-1}>-- Auto calcular --</option>
                          {rawHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                        </select>
                      </th>
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
                            onChange={(e) => handleEditRow(i, { code: e.target.value })}
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
                                onChange={(e) => handleEditRow(i, { name: e.target.value })}
                                onFocus={() => setActiveSuggestRow(i)}
                                onBlur={() => setTimeout(() => setActiveSuggestRow(null), 250)}
                                onKeyDown={(e) => handleKeyDown(e, i, 'name')}
                                disabled={!p.isNew}
                                style={{ 
                                  width: "100%", 
                                  background: p.isIllegible ? "rgba(239, 68, 68, 0.2)" : (!p.isNew ? "rgba(255,255,255,0.05)" : "transparent"), 
                                  border: p.isIllegible ? "2px solid #ef4444" : (!p.isNew ? "1px dashed rgba(255,255,255,0.2)" : "1px dashed var(--glass-border)"), 
                                  color: p.isIllegible ? "#ef4444" : (!p.isNew ? "rgba(255,255,255,0.5)" : "white"), 
                                  padding: "2px 4px", 
                                  borderRadius: "4px", 
                                  fontWeight: "bold",
                                  cursor: !p.isNew ? "not-allowed" : "text"
                                }}
                                title={p.isIllegible ? "Error: Renglón no legible por la IA o sin nombre. Escribe un nombre válido para corregirlo." : (!p.isNew ? "Bloqueado para proteger identidad del producto" : "")}
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
                                <span style={{ fontSize: "0.65rem", background: "rgba(245, 158, 11, 0.2)", color: "#f59e0b", border: "1px solid rgba(245, 158, 11, 0.4)", padding: "2px 6px", borderRadius: "4px", whiteSpace: "nowrap" }} title={`Coincidencia difusa con "${p.originalExistingName}" en base de datos.`}>
                                  ⚠️ Coincidencia Difusa
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
                            </div>
                            {!p.isNew && (
                              <div style={{ fontSize: "0.7rem", color: "var(--color-secondary)" }}>
                                Anterior: Costo: ${p.prevCost.toFixed(2)} | Precio: ${p.prevPrice.toFixed(2)}
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
                                  handleEditRow(i, { price: Number(e.target.value), autoPriced: false });
                                }}
                                onKeyDown={(e) => handleKeyDown(e, i, 'price')}
                                style={{ 
                                  width: "70px", 
                                  background: "transparent", 
                                  border: p.hasLoss ? "1px solid #ef4444" : "1px dashed var(--color-primary)", 
                                  color: p.hasLoss ? "#ef4444" : "var(--color-secondary)", 
                                  padding: "2px 4px", 
                                  borderRadius: "4px", 
                                  fontWeight: "bold" 
                                }}
                                title={p.hasLoss ? "¡Alerta de Pérdida! El precio de venta sugerido es menor o igual al costo." : ""}
                              />
                            </div>
                            {p.hasLoss && (
                              <span style={{ fontSize: "0.55rem", color: "#ef4444", fontWeight: "bold" }}>⚠️ Sin Margen / Pérdida</span>
                            )}
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

            <div
              style={{ display: "flex", gap: "15px", justifyContent: "center", marginTop: "20px" }}
            >
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
                disabled={importOption === "" || (previewData ? previewData.some(p => p.isIllegible) : false)}
                style={{
                  background: "var(--color-primary)",
                  opacity: (importOption === "" || (previewData ? previewData.some(p => p.isIllegible) : false)) ? 0.5 : 1,
                  cursor: (importOption === "" || (previewData ? previewData.some(p => p.isIllegible) : false)) ? "not-allowed" : "pointer"
                }}
              >
                {previewData && previewData.some(p => p.isIllegible)
                  ? "⚠️ Corrija nombres ilegibles"
                  : (importOption === "" ? "⏳ Elija un método" : "✅ Confirmar e Importar")
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
                    ["CODIGO", "PRODUCTO", "STOCK", "COSTO", "PRECIO", "PROVEEDOR", "BODEGA"],
                    ["", "", "", "", "", "", ""]
                  ];
                  const ws = XLSX.utils.aoa_to_sheet(wsData);
                  ws["!cols"] = [{wch: 15}, {wch: 30}, {wch: 10}, {wch: 12}, {wch: 12}, {wch: 20}, {wch: 15}];
                  
                  // Agregamos Validación de Datos (Lista Desplegable) para Proveedores
                  const validSuppliers = uniqueSuppliers.length > 0 ? uniqueSuppliers.slice(0, 15).join(",") : "Pendiente";
                  ws["!dataValidation"] = [
                    {
                      sqref: "F2:F1000",
                      type: "list",
                      allowBlank: true,
                      showErrorMessage: true,
                      errorTitle: "Proveedor Inválido",
                      error: "Debes elegir un proveedor de la lista, o dejarlo en blanco.",
                      formula1: `"${validSuppliers.substring(0, 255)}"`
                    }
                  ];

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
                
                {/* Zona de Arrastre visualmente premium */}
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
                    disabled={supplierSearch.trim() === ""} 
                    style={{ background: "var(--color-primary)", opacity: supplierSearch.trim() !== "" ? 1 : 0.5 }}
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
