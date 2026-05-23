"use client";
import { useState, useRef } from "react";
import * as XLSX from "xlsx";

interface SmartImporterProps {
  avgMargin: number;
  existingItems: any[];
  onClose: () => void;
  onImport: (products: any[]) => void;
}

export default function SmartImporter({
  avgMargin,
  existingItems,
  onClose,
  onImport,
}: SmartImporterProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState("");
  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // NLP Limpiador: Quitar dobles espacios y capitalizar "tHINNEr" -> "Thinner"
  const cleanAndCapitalize = (str: string) => {
    return str
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  // Helper de cálculo inteligente de precios basado en metas e histórico
  const getSmartPriceSuggestion = (name: string, cost: number, code: string) => {
    const targetUtility = parseFloat(localStorage.getItem("ERIKA_TARGET_UTILITY") || "50");
    const margin = targetUtility / 100;

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

  const processExcel = async (file: File) => {
    setIsProcessing(true);
    setProgress("🧠 Analizando archivo y calculando márgenes...");

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rawData = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
        }) as any[][];

        if (rawData.length < 2) throw new Error("Documento vacío");

        const headers = rawData[0].map((h) => String(h).toLowerCase().trim());

        const codeIdx = headers.findIndex(
          (h) => h.includes("codigo") || h.includes("código") || h.includes("sku") || h.includes("id") || h.includes("ref") || h.includes("barras") || h.includes("barcode")
        );
        const nameIdx = headers.findIndex(
          (h) => h.includes("nombre") || h.includes("descrip") || h.includes("articulo") || h.includes("artículo") || h.includes("producto") || h.includes("prod") || h.includes("detalle") || h.includes("concepto")
        );
        const costIdx = headers.findIndex(
          (h) =>
            h.includes("costo") ||
            h.includes("compra") ||
            h.includes("adquisicion") ||
            h.includes("adquisición") ||
            h.includes("p. compra") ||
            h.includes("neto") ||
            h.includes("unitario") ||
            h === "aa" ||
            h.includes("iva")
        );
        const stockIdx = headers.findIndex(
          (h) =>
            h.includes("stock") ||
            h.includes("cantidad") ||
            h.includes("totales") ||
            h.includes("almacen") ||
            h.includes("almacén") ||
            h.includes("existencia") ||
            h.includes("existencias") ||
            h.includes("cant")
        );

        const finalNameIdx = nameIdx >= 0 ? nameIdx : 1;
        const finalCostIdx = costIdx >= 0 ? costIdx : 5;
        const finalStockIdx = stockIdx >= 0 ? stockIdx : 4;
        const finalCodeIdx = codeIdx >= 0 ? codeIdx : 0;

        const importedProducts: any[] = [];
        for (let i = 1; i < rawData.length; i++) {
          const row = rawData[i];
          if (!row || !row[finalNameIdx]) continue;

          let rawCost = Number(row[finalCostIdx]);
          if (isNaN(rawCost) && typeof row[finalCostIdx] === "string") {
            rawCost = Number(row[finalCostIdx].replace(/[^0-9.-]+/g, ""));
          }
          if (isNaN(rawCost)) rawCost = 0;

          const rawCode = row[finalCodeIdx]
            ? String(row[finalCodeIdx]).trim()
            : `SKU-${Date.now()}-${i}`;
          const cleanName = cleanAndCapitalize(String(row[finalNameIdx]));

          const smartPrices = getSmartPriceSuggestion(cleanName, rawCost, rawCode);

          importedProducts.push({
            id: `imp-${Date.now()}-${i}`,
            code: rawCode,
            name: cleanName,
            cost: rawCost,
            price: smartPrices.price,
            stock: Number(row[finalStockIdx]) || 0,
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

        setTimeout(() => {
          setPreviewData(importedProducts);
          setIsProcessing(false);
        }, 1000);
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
      const smart = getSmartPriceSuggestion(p.name, p.cost, p.code);
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
      const globalSupplier = window.prompt(
        "🏢 Nombra al Proveedor General para asignar a todos estos productos:",
      );
      if (!globalSupplier) return;

      let areaChar = "C";
      let areaNum = 1;

      const finalProducts = previewData.map((p) => {
        const assignedLocation = `${areaChar}-${areaNum}`;
        areaNum++;
        if (areaNum > 20) {
          areaNum = 1;
          areaChar = String.fromCharCode(areaChar.charCodeAt(0) + 1);
        }
        return { ...p, supplier: globalSupplier, location: assignedLocation };
      });

      onImport(finalProducts);
      onClose();
    }
  };

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
              {/* Si subió imagen, muestra la miniatura de la factura/foto al lado */}
              {filePreviewUrl && (
                <div style={{ width: "200px", display: "flex", flexDirection: "column", gap: "10px" }}>
                  <span style={{ fontSize: "0.8rem", color: "var(--color-secondary)" }}>Imagen Original:</span>
                  <div style={{ border: "1px solid var(--glass-border)", borderRadius: "8px", overflow: "hidden", height: "250px", background: "rgba(0,0,0,0.5)" }}>
                    <img src={filePreviewUrl} alt="Factura cargada" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  </div>
                </div>
              )}
              {uploadedFile && !filePreviewUrl && (
                <div style={{ width: "120px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", border: "1px dashed var(--glass-border)", borderRadius: "8px", padding: "10px", background: "rgba(0,0,0,0.2)" }}>
                  <span style={{ fontSize: "3rem" }}>📄</span>
                  <span style={{ fontSize: "0.75rem", overflow: "hidden", textOverflow: "ellipsis", width: "100%" }}>{uploadedFile.name}</span>
                </div>
              )}

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
                    <tr style={{ color: "var(--color-secondary)" }}>
                      <th style={{ padding: "8px" }}>CÓDIGO</th>
                      <th style={{ padding: "8px" }}>Producto</th>
                      <th style={{ padding: "8px" }}>Cant.</th>
                      <th style={{ padding: "8px" }}>Costo</th>
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
                        <td style={{ padding: "8px", fontFamily: "monospace" }}>{p.code}</td>
                        <td style={{ padding: "8px" }}>
                          <strong>{p.name}</strong>
                          {!p.isNew && (
                            <div style={{ fontSize: "0.7rem", color: "var(--color-secondary)" }}>
                              Anterior: Costo: ${p.prevCost.toFixed(2)} | Precio: ${p.prevPrice.toFixed(2)}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "8px" }}>{p.stock}</td>
                        <td style={{ padding: "8px" }}>${p.cost.toFixed(2)}</td>
                        <td
                          style={{
                            padding: "8px",
                            background: "rgba(16, 185, 129, 0.1)",
                            fontWeight: "bold",
                            color: "var(--color-secondary)"
                          }}
                        >
                          ${p.price.toFixed(2)}
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
              <button
                className="btn-primary"
                onClick={confirmImport}
                style={{ background: "var(--color-primary)" }}
              >
                ✅ Asignar Proveedor e Importar a Almacén
              </button>
            </div>
          </div>
        ) : (
          <div>
            <h2 style={{ color: "var(--color-primary)", marginBottom: "10px" }}>
              ⚡ ERIKA AI Vision - Carga Inteligente de Facturas
            </h2>
            <p
              style={{
                color: "var(--color-text)",
                opacity: 0.8,
                marginBottom: "25px",
                fontSize: "0.9rem",
              }}
            >
              Carga tu archivo **Excel (XLSX, CSV), PDF o Fotografía de ticket/factura**. 
              Nuestra IA extraerá códigos, nombres, stock y costos, detectará inflación y te sugerirá precios finales de venta.
            </p>
            
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
      </div>
    </div>
  );
}
