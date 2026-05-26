const fs = require('fs');
const file = 'src/components/SmartImporter.tsx';
let code = fs.readFileSync(file, 'utf8');

const processExcelStart = code.indexOf('  const processExcel = async (file: File) => {');
const processAIFileStart = code.indexOf('  const processAIFile = async (file: File) => {');

const newCodeBlock = \  const generatePreview = (mapping: any, data: any[][]) => {
    const importedProducts: any[] = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (!row || !row[mapping.name]) continue;
      
      if (i === 0) {
        const potentialCost = String(row[mapping.cost]).replace(/[^0-9.-]+/g, "");
        if (isNaN(Number(potentialCost)) || potentialCost === "") {
           continue; // Header row
        }
      }

      let rawCost = Number(row[mapping.cost]);
      if (isNaN(rawCost) && typeof row[mapping.cost] === "string") {
        rawCost = Number(String(row[mapping.cost]).replace(/[^0-9.-]+/g, ""));
      }
      if (isNaN(rawCost)) rawCost = 0;

      const rawCode = row[mapping.code] ? String(row[mapping.code]).trim() : \\\SKU-\\\-\\\\\\;
      const cleanName = cleanAndCapitalize(String(row[mapping.name]));
      const smartPrices = getSmartPriceSuggestion(cleanName, rawCost, rawCode);

      importedProducts.push({
        id: \\\imp-\\\-\\\\\\,
        code: rawCode,
        name: cleanName,
        cost: rawCost,
        price: smartPrices.price,
        stock: Number(row[mapping.stock]) || 0,
        supplier: "Pendiente",
        minStock: 5,
        salesIndex: 50,
        autoPriced: true,
        alertText: smartPrices.alertText,
        isInflation: smartPrices.isInflation,
        isNew: smartPrices.isNew,
        prevPrice: smartPrices.prevPrice,
        prevCost: smartPrices.prevCost
      });
    }
    setPreviewData(importedProducts);
  };

  const processExcel = async (file: File) => {
    setIsProcessing(true);
    setProgress("🧠 Analizando archivo híbrido (Encabezados + Heurística)...");

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rawDataRaw = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        const rawData = rawDataRaw.filter(row => {
          if (!row || !Array.isArray(row)) return false;
          const filledCells = row.filter(cell => cell !== null && cell !== undefined && cell !== "").length;
          return filledCells >= 2;
        });

        if (rawData.length < 2) throw new Error("Documento vacío o sin suficientes datos");

        let maxCols = 0;
        for (let i = 0; i < Math.min(20, rawData.length); i++) {
           if (rawData[i].length > maxCols) maxCols = rawData[i].length;
        }
        
        const firstRow = rawData[0].map(h => String(h).toLowerCase().trim());
        const headersForSelect = [];
        for (let c = 0; c < maxCols; c++) {
           headersForSelect.push(rawData[0][c] ? String(rawData[0][c]) : \\\Columna \\\\\\);
        }

        let finalNameIdx = firstRow.findIndex(h => h.includes("nombre") || h.includes("descrip") || h.includes("articulo") || h.includes("artículo") || h.includes("producto") || h.includes("concepto"));
        let finalCostIdx = firstRow.findIndex(h => h.includes("costo") || h.includes("compra") || h.includes("adquisicion") || h.includes("unitario") || h.includes("neto") || h.includes("precio"));
        let finalStockIdx = firstRow.findIndex(h => h.includes("stock") || h.includes("cantidad") || h.includes("existencia") || h.includes("cant"));
        let finalCodeIdx = firstRow.findIndex(h => h.includes("codigo") || h.includes("código") || h.includes("sku") || h.includes("barras") || h.includes("id"));

        const source = {
          name: finalNameIdx >= 0 ? "🏷️ Título" : "",
          cost: finalCostIdx >= 0 ? "🏷️ Título" : "",
          stock: finalStockIdx >= 0 ? "🏷️ Título" : "",
          code: finalCodeIdx >= 0 ? "🏷️ Título" : "",
        };

        const sampleSize = Math.min(20, rawData.length);
        const columnStats: any = {};
        for (let c = 0; c < maxCols; c++) columnStats[c] = { textLength: 0, numCount: 0, floatCount: 0, strCount: 0, total: 0 };

        for (let i = 1; i < sampleSize; i++) {
           const row = rawData[i];
           for (let c = 0; c < maxCols; c++) {
              const cell = row[c];
              if (cell === null || cell === undefined || cell === "") continue;
              columnStats[c].total++;
              const strVal = String(cell).trim();
              let numVal = Number(cell);
              if (isNaN(numVal) && typeof cell === "string") numVal = Number(cell.replace(/[^0-9.-]+/g, ""));
              const hasLetters = /[a-zA-Z]/.test(strVal);
              if (!isNaN(numVal) && strVal !== "" && !hasLetters) {
                 columnStats[c].numCount++;
                 if (strVal.includes(".") || numVal % 1 !== 0) columnStats[c].floatCount++;
              } else {
                 columnStats[c].strCount++;
                 columnStats[c].textLength += strVal.length;
              }
           }
        }

        if (finalNameIdx === -1) {
           let maxTextAvg = -1;
           for (let c = 0; c < maxCols; c++) {
              if (c === finalCostIdx || c === finalStockIdx || c === finalCodeIdx) continue;
              const stat = columnStats[c];
              if (stat.total === 0) continue;
              const textAvg = stat.textLength / (stat.strCount || 1);
              if (stat.strCount >= stat.numCount && textAvg > maxTextAvg) { maxTextAvg = textAvg; finalNameIdx = c; }
           }
           if (finalNameIdx !== -1) source.name = "🧠 IA (Text)";
        }

        if (finalCostIdx === -1) {
           let maxFloats = -1;
           let maxNums = -1;
           for (let c = 0; c < maxCols; c++) {
              if (c === finalNameIdx || c === finalStockIdx || c === finalCodeIdx) continue;
              const stat = columnStats[c];
              if (stat.total === 0) continue;
              if (stat.floatCount > maxFloats) { maxFloats = stat.floatCount; finalCostIdx = c; }
              else if (stat.floatCount === maxFloats && stat.numCount > maxNums) { maxNums = stat.numCount; finalCostIdx = c; }
           }
           if (finalCostIdx !== -1) source.cost = "🧠 IA (Num)";
        }

        if (finalStockIdx === -1) {
           let maxInts = -1;
           for (let c = 0; c < maxCols; c++) {
              if (c === finalNameIdx || c === finalCostIdx || c === finalCodeIdx) continue;
              const stat = columnStats[c];
              if (stat.total === 0) continue;
              const ints = stat.numCount - stat.floatCount;
              if (ints > maxInts) { maxInts = ints; finalStockIdx = c; }
           }
           if (finalStockIdx !== -1) source.stock = "🧠 IA (Int)";
        }

        if (finalCodeIdx === -1) {
           for (let c = 0; c < maxCols; c++) {
              if (c === finalNameIdx || c === finalCostIdx || c === finalStockIdx) continue;
              const stat = columnStats[c];
              if (stat.total > 0 && finalCodeIdx === -1) { finalCodeIdx = c; }
           }
           if (finalCodeIdx !== -1) source.code = "🧠 IA (Id)";
        }

        if (finalNameIdx === -1) { finalNameIdx = 1; source.name = "⚠️ Defecto"; }
        if (finalCostIdx === -1) { finalCostIdx = 5; source.cost = "⚠️ Defecto"; }
        if (finalStockIdx === -1) { finalStockIdx = 4; source.stock = "⚠️ Defecto"; }
        if (finalCodeIdx === -1) { finalCodeIdx = 0; source.code = "⚠️ Defecto"; }

        const mapping = { name: finalNameIdx, cost: finalCostIdx, stock: finalStockIdx, code: finalCodeIdx };
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
        alert("Error al leer el Excel.");
        setIsProcessing(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleMappingChange = (field: string, newIdx: number) => {
    const newMapping = { ...columnMapping, [field]: newIdx };
    setColumnMapping(newMapping);
    setDetectionSource({ ...detectionSource, [field]: "👤 Manual" });
    generatePreview(newMapping, processedRawData);
  };

\;

code = code.substring(0, processExcelStart) + newCodeBlock + code.substring(processAIFileStart);

fs.writeFileSync(file, code);
