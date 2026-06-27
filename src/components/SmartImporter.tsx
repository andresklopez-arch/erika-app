"use client";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

interface SmartImporterProps {
  avgMargin: number;
  existingItems: any[];
  onClose: () => void;
  onImport: (
    products: any[],
    importOption: "sustituir" | "complementar" | "nuevo",
    accumulateStock?: boolean
  ) => void;
}

// Normalizador de cadenas para comparación de nombres
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

export default function SmartImporter({
  avgMargin,
  existingItems,
  onClose,
  onImport,
}: SmartImporterProps) {
  const [step, setStep] = useState(1);
  const [inputText, setInputText] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // Almacén de datos pegados paso a paso
  const [codes, setCodes] = useState<string[]>([]);
  const [names, setNames] = useState<string[]>([]);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [stocks, setStocks] = useState<number[]>([]);
  const [costs, setCosts] = useState<number[]>([]);
  const [prices, setPrices] = useState<number[]>([]);

  // Paginación de la previsualización final
  const [currentPage, setCurrentPage] = useState(1);

  // Historial de Bitácoras
  const [viewingHistory, setViewingHistory] = useState(false);
  const [historyLogs, setHistoryLogs] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Proveedores registrados en base de datos para validar y crear nuevos
  const [dbSuppliers, setDbSuppliers] = useState<string[]>([]);

  useEffect(() => {
    const fetchSuppliers = async () => {
      try {
        const { data } = await supabase.from("suppliers").select("name").order("name");
        if (data) {
          setDbSuppliers(data.map((s: any) => s.name.trim()));
        }
      } catch (err) {
        console.error("Error al cargar proveedores:", err);
      }
    };
    fetchSuppliers();
  }, []);

  // Cargar registros de bitácora
  const loadHistoryLogs = async () => {
    setIsLoadingHistory(true);
    try {
      const { data, error } = await supabase
        .from("import_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      if (data) setHistoryLogs(data);
    } catch (err) {
      console.error("Error al cargar bitácoras de importación:", err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Función para procesar y limpiar el texto pegado
  const parsePastedText = (text: string) => {
    if (!text) return [];
    const lines = text.split(/\r?\n/);
    // Remover todas las líneas vacías consecutivas al final
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }
    return lines.map((line) => {
      const firstColumn = line.split("\t")[0];
      return firstColumn ? firstColumn.trim() : "";
    });
  };

  // Título e instrucción dinámica del paso actual
  const getStepConfig = () => {
    switch (step) {
      case 1:
        return {
          title: "1. Copiar Códigos de Barras / Artículos",
          instruction: "Copia de tu Excel la columna con los CÓDIGOS de los artículos (sólo los datos, sin el título) y pégala abajo.",
          placeholder: "Ejemplo:\n7501055300012\n7501055300029\n7501055300036",
        };
      case 2:
        return {
          title: "2. Copiar Nombres de los Productos",
          instruction: `Copia la columna con los NOMBRES o DESCRIPCIONES de los artículos. Deben ser exactamente las mismas ${codes.length} filas.`,
          placeholder: "Ejemplo:\nMartillo de Uña 16oz Truper\nCinta Aislante 18m Negro\nPinza de Chofer 8 pulgadas",
        };
      case 3:
        return {
          title: "3. Copiar Proveedores de los Artículos",
          instruction: `Copia la columna con el nombre del PROVEEDOR de cada artículo. Deben ser exactamente las mismas ${codes.length} filas.`,
          placeholder: "Ejemplo:\nTruper\nUrrea\nSayer",
        };
      case 4:
        return {
          title: "4. Copiar Existencias / Stock de los Artículos",
          instruction: `Copia la columna con las EXISTENCIAS actuales (Stock) en números. Deben ser exactamente las mismas ${codes.length} filas.`,
          placeholder: "Ejemplo:\n15\n30\n8",
        };
      case 5:
        return {
          title: "5. Copiar Costos Proveedor",
          instruction: `Copia la columna con los COSTOS de compra (Precio compra neto) en números. Deben ser exactamente las mismas ${codes.length} filas.`,
          placeholder: "Ejemplo:\n85.50\n12.30\n125.00",
        };
      case 6:
        return {
          title: "6. Copiar Precios de Venta",
          instruction: `Copia la columna con los PRECIOS DE VENTA al público en números. Deben ser exactamente las mismas ${codes.length} filas.`,
          placeholder: "Ejemplo:\n120.00\n18.50\n180.00",
        };
      default:
        return { title: "", instruction: "", placeholder: "" };
    }
  };

  // Manejador del botón Aceptar en cada paso
  const handleNextStep = () => {
    setErrorMsg("");
    const parsed = parsePastedText(inputText);

    if (parsed.length === 0) {
      setErrorMsg("⚠️ Por favor pega datos válidos en el campo de texto.");
      return;
    }

    if (step === 1) {
      setCodes(parsed);
      setInputText("");
      setStep(2);
    } else {
      if (parsed.length !== codes.length) {
        setErrorMsg(
          `⚠️ La cantidad de filas copiadas (${parsed.length}) no coincide con la cantidad de Códigos ingresados originalmente (${codes.length}). Por favor, vuelve a seleccionar y copiar los datos correctos en tu Excel.`
        );
        return;
      }

      if (step === 2) {
        setNames(parsed);
        setInputText("");
        setStep(3);
      } else if (step === 3) {
        setSuppliers(parsed);
        setInputText("");
        setStep(4);
      } else if (step === 4) {
        const parsedNums = parsed.map((v) => {
          const num = Number(v.replace(/[^0-9.-]/g, ""));
          return isNaN(num) ? 0 : num;
        });
        setStocks(parsedNums);
        setInputText("");
        setStep(5);
      } else if (step === 5) {
        const parsedNums = parsed.map((v) => {
          const num = Number(v.replace(/[^0-9.-]/g, ""));
          return isNaN(num) ? 0 : num;
        });
        setCosts(parsedNums);
        setInputText("");
        setStep(6);
      } else if (step === 6) {
        const parsedNums = parsed.map((v) => {
          const num = Number(v.replace(/[^0-9.-]/g, ""));
          return isNaN(num) ? 0 : num;
        });
        setPrices(parsedNums);
        setInputText("");
        setCurrentPage(1); // Reiniciar paginación al entrar a la vista previa
        setStep(7);
      }
    }
  };

  // Manejador de regreso
  const handlePrevStep = () => {
    setErrorMsg("");
    setInputText("");
    if (step === 2) {
      setInputText(codes.join("\n"));
      setStep(1);
    } else if (step === 3) {
      setInputText(names.join("\n"));
      setStep(2);
    } else if (step === 4) {
      setInputText(suppliers.join("\n"));
      setStep(3);
    } else if (step === 5) {
      setInputText(stocks.join("\n"));
      setStep(4);
    } else if (step === 6) {
      setInputText(costs.join("\n"));
      setStep(5);
    } else if (step === 7) {
      setInputText(prices.join("\n"));
      setStep(6);
    }
  };

  // Reiniciar el asistente por completo
  const handleReset = () => {
    if (
      window.confirm(
        "¿Estás seguro de que deseas reiniciar el asistente? Se borrarán todos los datos pegados hasta el momento."
      )
    ) {
      setCodes([]);
      setNames([]);
      setSuppliers([]);
      setStocks([]);
      setCosts([]);
      setPrices([]);
      setInputText("");
      setErrorMsg("");
      setCurrentPage(1);
      setStep(1);
    }
  };

  // Asignar ubicación automática (por cuadrantes secuenciales: C-1 a C-20, luego D-1, etc.)
  const autoLocations: string[] = [];
  if (codes.length > 0) {
    let areaChar = "C";
    let areaNum = 1;
    for (let i = 0; i < codes.length; i++) {
      autoLocations.push(`${areaChar}-${areaNum}`);
      areaNum++;
      if (areaNum > 20) {
        areaNum = 1;
        areaChar = String.fromCharCode(areaChar.charCodeAt(0) + 1);
      }
    }
  }

  // Lógica de cálculo de advertencias y alertas del lote
  const warningsList: string[] = [];
  let lossCount = 0;
  let zeroOrNegativeMoneyCount = 0;
  let negativeStockCount = 0;
  let emptyNameOrCodeCount = 0;

  if (step === 7) {
    codes.forEach((code, idx) => {
      const name = names[idx] || "";
      const stock = stocks[idx] || 0;
      const cost = costs[idx] || 0;
      const price = prices[idx] || 0;

      if (!code || !name) {
        emptyNameOrCodeCount++;
      }
      if (stock < 0) {
        negativeStockCount++;
      }
      if (cost <= 0 || price <= 0) {
        zeroOrNegativeMoneyCount++;
      }
      if (cost >= price && cost > 0 && price > 0) {
        lossCount++;
      }
    });

    if (lossCount > 0) {
      warningsList.push(
        `⚠️ Margen de Ganancia: Hay ${lossCount} producto(s) donde el costo es mayor o igual al precio de venta.`
      );
    }
    if (zeroOrNegativeMoneyCount > 0) {
      warningsList.push(
        `⚠️ Precios Sospechosos: Hay ${zeroOrNegativeMoneyCount} producto(s) con costo o precio de venta en $0 o negativo.`
      );
    }
    if (negativeStockCount > 0) {
      warningsList.push(
        `⚠️ Existencias: Hay ${negativeStockCount} producto(s) con stock negativo.`
      );
    }
    if (emptyNameOrCodeCount > 0) {
      warningsList.push(
        `⚠️ Datos Faltantes: Hay ${emptyNameOrCodeCount} producto(s) sin código o sin nombre.`
      );
    }
  }

  // Auto-cálculo y aplicación del precio de venta sugerido por el margen de utilidad
  const applySuggestedPrices = () => {
    const updatedPrices = prices.map((price, idx) => {
      const cost = costs[idx] || 0;
      // Aplicar si no tiene precio o si se vende con pérdidas
      if (price <= cost || price === 0) {
        const marginFactor = 1 - avgMargin / 100;
        if (marginFactor > 0) {
          const suggested = cost / marginFactor;
          return Math.round(suggested * 100) / 100;
        }
        return Math.round(cost * (1 + avgMargin / 100) * 100) / 100;
      }
      return price;
    });
    setPrices(updatedPrices);
  };

  // Generar y descargar el reporte de advertencias en archivo de texto (.txt)
  const downloadWarningReport = () => {
    let reportText = "=== REPORTE DE ADVERTENCIAS - CARGA INTELIGENTE ===\n";
    reportText += `Fecha: ${new Date().toLocaleString()}\n`;
    reportText += `Artículos totales en el lote: ${codes.length}\n\n`;

    let itemWarningCount = 0;

    codes.forEach((code, idx) => {
      const name = names[idx] || "Producto sin nombre";
      const stock = stocks[idx] || 0;
      const cost = costs[idx] || 0;
      const price = prices[idx] || 0;
      const supplier = suppliers[idx] || "Pendiente";

      const warnings = [];
      if (!code) warnings.push("Código vacío");
      if (!names[idx]) warnings.push("Nombre vacío");
      if (stock < 0) warnings.push(`Stock negativo (${stock})`);
      if (cost <= 0) warnings.push(`Costo menor o igual a cero ($${cost})`);
      if (price <= 0) warnings.push(`Precio menor o igual a cero ($${price})`);
      if (cost >= price && cost > 0 && price > 0) {
        warnings.push(`Sin margen de ganancia (Costo: $${cost} >= Precio: $${price})`);
      }

      if (warnings.length > 0) {
        itemWarningCount++;
        reportText += `Fila ${idx + 1}:\n`;
        reportText += `  - Código: ${code || "S/C"}\n`;
        reportText += `  - Producto: ${name}\n`;
        reportText += `  - Proveedor: ${supplier}\n`;
        reportText += `  - Alertas:\n`;
        warnings.forEach((w) => {
          reportText += `    * ${w}\n`;
        });
        reportText += "\n";
      }
    });

    if (itemWarningCount === 0) {
      reportText += "No se encontraron advertencias en el lote.\n";
    }

    const blob = new Blob([reportText], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `reporte_advertencias_carga_${Date.now()}.txt`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Guardado final e inserción de datos
  const handleImport = async () => {
    setIsProcessing(true);
    try {
      // 1. Identificar proveedores únicos ingresados que no están en la base de datos
      const uniqueSuppliers = Array.from(
        new Set(
          suppliers
            .map((s) => s.trim())
            .filter((s) => s !== "" && s.toLowerCase() !== "pendiente")
        )
      );

      const dbSuppliersLower = dbSuppliers.map((s) => s.toLowerCase());

      for (const sup of uniqueSuppliers) {
        if (!dbSuppliersLower.includes(sup.toLowerCase())) {
          try {
            const cleanSup = sup
              .toLowerCase()
              .replace(/\b\w/g, (c) => c.toUpperCase());
            await supabase.from("suppliers").insert({ name: cleanSup });
          } catch (supErr) {
            console.error("Error al registrar proveedor:", sup, supErr);
          }
        }
      }

      // 2. Construir lista de productos finales alineados
      const finalProducts = codes.map((code, idx) => {
        const rawSupplier = suppliers[idx] ? suppliers[idx].trim() : "";
        const cleanSupplier =
          rawSupplier && rawSupplier.toLowerCase() !== "pendiente"
            ? rawSupplier.replace(/\b\w/g, (c) => c.toUpperCase())
            : "Pendiente";

        return {
          code: code,
          name: names[idx] || "Producto sin nombre",
          supplier: cleanSupplier,
          location: autoLocations[idx] || "C-1",
          stock: stocks[idx] || 0,
          cost: costs[idx] || 0,
          price: prices[idx] || 0,
          importedCode: code,
          importedName: names[idx] || "Producto sin nombre",
        };
      });

      // 3. Bitácora de importación (logs) en la base de datos Supabase
      try {
        const supplierBreakdown: Record<string, number> = {};
        finalProducts.forEach((p) => {
          const sup = p.supplier || "Pendiente";
          supplierBreakdown[sup] = (supplierBreakdown[sup] || 0) + 1;
        });

        let newCount = 0;
        let updateCount = 0;

        finalProducts.forEach((p) => {
          const exists = existingItems.some(
            (i) =>
              (i.code && p.code && i.code.trim().toUpperCase() === p.code.trim().toUpperCase()) ||
              normalizeString(i.name) === normalizeString(p.name)
          );
          if (exists) {
            updateCount++;
          } else {
            newCount++;
          }
        });

        await supabase.from("import_logs").insert({
          suppliers_breakdown: JSON.stringify(supplierBreakdown),
          new_count: newCount,
          update_count: updateCount,
          total_count: finalProducts.length,
          created_at: new Date().toISOString(),
        });
      } catch (logErr) {
        console.error("Error al registrar bitácora de importación (import_logs):", logErr);
      }

      // 4. Ejecutar la importación (acumulando existencias y actualizando precios de los existentes)
      await onImport(finalProducts, "sustituir", true);
      onClose();
    } catch (err) {
      console.error("Error general en importación:", err);
      setErrorMsg("⚠️ Ocurrió un error inesperado al procesar la carga en la base de datos.");
    } finally {
      setIsProcessing(false);
    }
  };

  const stepsList = [
    { num: 1, label: "Códigos" },
    { num: 2, label: "Nombres" },
    { num: 3, label: "Proveedores" },
    { num: 4, label: "Stock" },
    { num: 5, label: "Costos" },
    { num: 6, label: "Precios" },
    { num: 7, label: "Confirmar" },
  ];

  const config = getStepConfig();

  // Paginación en tabla (Paso 7)
  const ITEMS_PER_PAGE = 10;
  const totalPages = Math.ceil(codes.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedCodes = codes.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  // Renderizar la vista de historial de logs
  if (viewingHistory) {
    return (
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(10, 10, 15, 0.85)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
          padding: "20px",
          fontFamily: "var(--font-main)",
        }}
      >
        <div
          className="glass-panel"
          style={{
            width: "100%",
            maxWidth: "650px",
            maxHeight: "90vh",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            padding: "30px",
            boxShadow: "0 20px 40px rgba(0,0,0,0.5), var(--shadow-glow)",
            background: "rgba(22, 22, 34, 0.95)",
            border: "1px solid var(--glass-border)",
            borderRadius: "16px",
            overflowY: "auto",
          }}
        >
          {/* Cabecera */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h2 style={{ fontSize: "1.6rem", color: "var(--color-primary)", fontWeight: 600 }}>
                📋 Historial de Cargas Masivas
              </h2>
              <p style={{ color: "rgba(255, 255, 255, 0.6)", fontSize: "0.9rem", marginTop: "4px" }}>
                Bitácora de las últimas 10 importaciones desde Supabase.
              </p>
            </div>
            <button
              onClick={() => setViewingHistory(false)}
              style={{
                background: "transparent",
                border: "none",
                color: "rgba(255, 255, 255, 0.5)",
                fontSize: "1.5rem",
                cursor: "pointer",
              }}
            >
              &times;
            </button>
          </div>

          {/* Listado de Logs */}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", overflowY: "auto", maxHeight: "450px" }}>
            {isLoadingHistory ? (
              <div style={{ textAlign: "center", color: "rgba(255,255,255,0.5)", padding: "20px" }}>
                Cargando historial de base de datos...
              </div>
            ) : historyLogs.length === 0 ? (
              <div style={{ textAlign: "center", color: "rgba(255,255,255,0.5)", padding: "20px" }}>
                No hay registros de importación en el historial.
              </div>
            ) : (
              historyLogs.map((log) => {
                let suppliersObj: Record<string, number> = {};
                try {
                  suppliersObj = typeof log.suppliers_breakdown === "string"
                    ? JSON.parse(log.suppliers_breakdown)
                    : log.suppliers_breakdown || {};
                } catch {
                  suppliersObj = {};
                }
                const sups = Object.keys(suppliersObj);

                return (
                  <div
                    key={log.id}
                    style={{
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid var(--glass-border)",
                      borderRadius: "10px",
                      padding: "15px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "0.9rem", color: "white", fontWeight: 600 }}>
                        📅 {new Date(log.created_at).toLocaleString()}
                      </span>
                      <span style={{ fontSize: "0.85rem", color: "#34d399", fontWeight: "bold" }}>
                        {log.total_count} artículos
                      </span>
                    </div>
                    <div style={{ fontSize: "0.82rem", color: "rgba(255,255,255,0.7)" }}>
                      Nuevos agregados: <strong style={{ color: "white" }}>{log.new_count}</strong> | Actualizados: <strong style={{ color: "white" }}>{log.update_count}</strong>
                    </div>
                    {sups.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                        <span style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.4)" }}>Proveedores:</span>
                        {sups.slice(0, 5).map((s) => (
                          <span
                            key={s}
                            style={{
                              background: "rgba(139, 92, 246, 0.15)",
                              color: "#c084fc",
                              padding: "2px 6px",
                              borderRadius: "10px",
                              fontSize: "0.72rem",
                            }}
                          >
                            {s} ({suppliersObj[s]})
                          </span>
                        ))}
                        {sups.length > 5 && (
                          <span style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.5)" }}>
                            +{sups.length - 5} más
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer del Historial */}
          <div style={{ borderTop: "1px solid var(--glass-border)", paddingTop: "15px", textAlign: "right" }}>
            <button
              onClick={() => setViewingHistory(false)}
              style={{
                background: "linear-gradient(135deg, var(--color-primary), var(--color-accent))",
                border: "none",
                color: "white",
                padding: "8px 20px",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "0.9rem",
              }}
            >
              Regresar al Asistente
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(10, 10, 15, 0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "20px",
        fontFamily: "var(--font-main)",
      }}
    >
      <div
        className="glass-panel"
        style={{
          width: "100%",
          maxWidth: step === 7 ? "950px" : "650px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          padding: "30px",
          boxShadow: "0 20px 40px rgba(0,0,0,0.5), var(--shadow-glow)",
          background: "rgba(22, 22, 34, 0.95)",
          border: "1px solid var(--glass-border)",
          borderRadius: "16px",
          overflowY: "auto",
        }}
      >
        {/* Cabecera */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2
              style={{
                fontSize: "1.6rem",
                color: "var(--color-primary)",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "10px",
              }}
            >
              ⚡ Carga Inteligente de Inventario
            </h2>
            <p style={{ color: "rgba(255, 255, 255, 0.6)", fontSize: "0.9rem", marginTop: "4px" }}>
              Asistente de carga masiva de datos directos desde Excel.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
            {step < 7 && !isProcessing && (
              <button
                onClick={() => {
                  loadHistoryLogs();
                  setViewingHistory(true);
                }}
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid var(--glass-border)",
                  color: "rgba(255,255,255,0.85)",
                  padding: "6px 12px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  transition: "background 0.2s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)")}
              >
                📋 Ver Historial
              </button>
            )}
            <button
              onClick={onClose}
              disabled={isProcessing}
              style={{
                background: "transparent",
                border: "none",
                color: "rgba(255, 255, 255, 0.5)",
                fontSize: "1.5rem",
                cursor: "pointer",
                transition: "color 0.2s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-primary)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255, 255, 255, 0.5)")}
              title="Cerrar modal"
            >
              &times;
            </button>
          </div>
        </div>

        {/* Indicador de pasos visuales */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "rgba(255, 255, 255, 0.03)",
            padding: "10px 15px",
            borderRadius: "10px",
            border: "1px solid rgba(255, 255, 255, 0.05)",
            gap: "5px",
            overflowX: "auto",
          }}
        >
          {stepsList.map((s, idx) => {
            const isCompleted = step > s.num;
            const isActive = step === s.num;
            return (
              <div
                key={s.num}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  opacity: isActive || isCompleted ? 1 : 0.4,
                  whiteSpace: "nowrap",
                }}
              >
                <span
                  style={{
                    width: "24px",
                    height: "24px",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.8rem",
                    fontWeight: "bold",
                    background: isActive
                      ? "var(--color-primary)"
                      : isCompleted
                      ? "var(--color-secondary)"
                      : "rgba(255,255,255,0.1)",
                    color: "white",
                    boxShadow: isActive ? "0 0 10px rgba(244, 63, 94, 0.4)" : "none",
                    transition: "all 0.3s ease",
                  }}
                >
                  {s.num}
                </span>
                <span
                  style={{
                    fontSize: "0.85rem",
                    fontWeight: isActive ? 600 : 400,
                    color: isActive
                      ? "var(--color-primary)"
                      : isCompleted
                      ? "var(--color-secondary)"
                      : "var(--color-text)",
                  }}
                >
                  {s.label}
                </span>
                {idx < stepsList.length - 1 && (
                  <span style={{ color: "rgba(255,255,255,0.15)", margin: "0 4px" }}>➔</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Sección de errores */}
        {errorMsg && (
          <div
            style={{
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid #ef4444",
              borderRadius: "8px",
              padding: "12px 16px",
              color: "#fca5a5",
              fontSize: "0.9rem",
              lineHeight: "1.5",
              animation: "fadeIn 0.3s",
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* Cuerpo principal del paso actual */}
        {step < 7 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
              <h3 style={{ fontSize: "1.15rem", color: "white", fontWeight: 600 }}>
                {config.title}
              </h3>
              <p style={{ color: "rgba(255, 255, 255, 0.7)", fontSize: "0.95rem" }}>
                {config.instruction}
              </p>
            </div>

            <textarea
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                setErrorMsg("");
              }}
              placeholder={config.placeholder}
              style={{
                width: "100%",
                height: "220px",
                backgroundColor: "rgba(0, 0, 0, 0.2)",
                border: "1px solid var(--glass-border)",
                borderRadius: "8px",
                padding: "15px",
                color: "white",
                fontFamily: "monospace",
                fontSize: "0.9rem",
                lineHeight: "1.5",
                resize: "none",
                outline: "none",
                transition: "border-color 0.2s",
              }}
              onFocus={(e) => (e.target.style.borderColor = "var(--color-primary)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--glass-border)")}
            />

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: "0.85rem",
                color: "rgba(255,255,255,0.5)",
              }}
            >
              <span>
                Filas detectadas en el texto actual:{" "}
                <strong style={{ color: "white" }}>{parsePastedText(inputText).length}</strong>
              </span>
              {step > 1 && (
                <span>
                  Esperadas: <strong style={{ color: "white" }}>{codes.length}</strong>
                </span>
              )}
            </div>
          </div>
        ) : (
          /* Paso 7: Vista Previa y Confirmación */
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
              <h3 style={{ fontSize: "1.2rem", color: "white", fontWeight: 600 }}>
                📋 Resumen y Alineación de Datos
              </h3>
              <p style={{ color: "rgba(255, 255, 255, 0.7)", fontSize: "0.95rem" }}>
                Verifica que todos los datos estén alineados correctamente. Celdas con posibles errores se resaltarán en rojo.
              </p>
            </div>

            {/* Contenedor de la Tabla */}
            <div
              style={{
                border: "1px solid var(--glass-border)",
                borderRadius: "10px",
                backgroundColor: "rgba(0,0,0,0.15)",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div style={{ overflowX: "auto", maxHeight: "250px" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "0.85rem",
                    textAlign: "left",
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        borderBottom: "2px solid var(--glass-border)",
                        backgroundColor: "rgba(255, 255, 255, 0.02)",
                      }}
                    >
                      <th style={{ padding: "10px 15px", color: "rgba(255,255,255,0.5)" }}>#</th>
                      <th style={{ padding: "10px 15px", color: "white" }}>Código</th>
                      <th style={{ padding: "10px 15px", color: "white" }}>Producto</th>
                      <th style={{ padding: "10px 15px", color: "white" }}>Proveedor</th>
                      <th style={{ padding: "10px 15px", color: "white" }}>Ubicación</th>
                      <th style={{ padding: "10px 15px", color: "white" }}>Stock</th>
                      <th style={{ padding: "10px 15px", color: "white" }}>Costo</th>
                      <th style={{ padding: "10px 15px", color: "white" }}>Precio Venta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedCodes.map((code, idx) => {
                      const absoluteIdx = startIndex + idx;
                      const name = names[absoluteIdx] || "";
                      const stock = stocks[absoluteIdx] || 0;
                      const cost = costs[absoluteIdx] || 0;
                      const price = prices[absoluteIdx] || 0;

                      // Lógica de alerta por celda
                      const isCodeErr = !code;
                      const isNameErr = !name;
                      const isStockErr = stock < 0;
                      const isCostErr = cost <= 0 || (cost >= price && cost > 0 && price > 0);
                      const isPriceErr = price <= 0 || (cost >= price && cost > 0 && price > 0);

                      // Alertas de duplicados
                      const nameLower = name.trim().toLowerCase();
                      const isDuplicateInBatch =
                        nameLower !== "" &&
                        names.filter((n) => n.trim().toLowerCase() === nameLower).length > 1;

                      const dbMatch = existingItems.find(
                        (i) =>
                          normalizeString(i.name) === normalizeString(name) &&
                          i.code &&
                          code &&
                          i.code.trim().toUpperCase() !== code.trim().toUpperCase()
                      );

                      return (
                        <tr
                          key={absoluteIdx}
                          style={{
                            borderBottom: "1px solid rgba(255, 255, 255, 0.03)",
                            transition: "background 0.2s",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.02)")}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                        >
                          <td style={{ padding: "8px 15px", color: "rgba(255,255,255,0.4)" }}>
                            {absoluteIdx + 1}
                          </td>
                          <td
                            style={{
                              padding: "8px 15px",
                              fontWeight: "bold",
                              color: "#fca5a5",
                              backgroundColor: isCodeErr ? "rgba(239, 68, 68, 0.15)" : "transparent",
                            }}
                            title={isCodeErr ? "Código vacío o inválido" : ""}
                          >
                            {code || "---"}
                          </td>
                          <td
                            style={{
                              padding: "8px 15px",
                              color: "white",
                              backgroundColor: isNameErr ? "rgba(239, 68, 68, 0.15)" : "transparent",
                            }}
                            title={isNameErr ? "Nombre vacío" : ""}
                          >
                            {name || "Producto sin nombre"}
                            {isDuplicateInBatch && (
                              <span style={{ display: "block", fontSize: "0.72rem", color: "#fb923c", marginTop: "2px" }}>
                                ⚠️ Duplicado en el lote
                              </span>
                            )}
                            {dbMatch && (
                              <span
                                style={{ display: "block", fontSize: "0.72rem", color: "#fbbf24", marginTop: "2px" }}
                                title={`Este producto ya existe con el código "${dbMatch.code}". Si continúas, se actualizará su código en la BD por "${code}".`}
                              >
                                ⚠️ Existe en BD con código: {dbMatch.code}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "8px 15px" }}>
                            <span
                              style={{
                                background: "rgba(16, 185, 129, 0.15)",
                                color: "#34d399",
                                padding: "3px 8px",
                                borderRadius: "12px",
                                fontSize: "0.75rem",
                              }}
                            >
                              {suppliers[absoluteIdx] || "Pendiente"}
                            </span>
                          </td>
                          <td style={{ padding: "8px 15px", color: "#fb923c" }}>
                            {autoLocations[absoluteIdx]}
                          </td>
                          <td
                            style={{
                              padding: "8px 15px",
                              fontWeight: 600,
                              color: isStockErr ? "#ef4444" : "white",
                              backgroundColor: isStockErr ? "rgba(239, 68, 68, 0.15)" : "transparent",
                            }}
                            title={isStockErr ? "Stock negativo" : ""}
                          >
                            {stock}
                          </td>
                          <td
                            style={{
                              padding: "8px 15px",
                              color: isCostErr ? "#ef4444" : "rgba(255,255,255,0.8)",
                              backgroundColor: isCostErr ? "rgba(239, 68, 68, 0.15)" : "transparent",
                            }}
                            title={cost >= price ? "Costo es mayor o igual al precio de venta" : cost <= 0 ? "Costo es $0 o negativo" : ""}
                          >
                            ${cost.toFixed(2)}
                          </td>
                          <td
                            style={{
                              padding: "8px 15px",
                              fontWeight: 600,
                              color: isPriceErr ? "#ef4444" : "#34d399",
                              backgroundColor: isPriceErr ? "rgba(239, 68, 68, 0.15)" : "transparent",
                            }}
                            title={cost >= price ? "Precio de venta es menor o igual al costo" : price <= 0 ? "Precio es $0 o negativo" : ""}
                          >
                            ${price.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Controles de Paginación */}
              {totalPages > 1 && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 15px",
                    background: "rgba(255, 255, 255, 0.02)",
                    borderTop: "1px solid var(--glass-border)",
                    fontSize: "0.85rem",
                  }}
                >
                  <span style={{ color: "rgba(255,255,255,0.5)" }}>
                    Mostrando del {startIndex + 1} al {Math.min(startIndex + ITEMS_PER_PAGE, codes.length)} de {codes.length} artículos
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <button
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                      style={{
                        background: currentPage === 1 ? "rgba(255,255,255,0.02)" : "rgba(255, 255, 255, 0.05)",
                        border: "1px solid var(--glass-border)",
                        color: currentPage === 1 ? "rgba(255,255,255,0.2)" : "white",
                        padding: "5px 12px",
                        borderRadius: "6px",
                        cursor: currentPage === 1 ? "not-allowed" : "pointer",
                        fontWeight: 600,
                      }}
                    >
                      Anterior
                    </button>
                    <span style={{ color: "white" }}>
                      Página {currentPage} de {totalPages}
                    </span>
                    <button
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                      style={{
                        background: currentPage === totalPages ? "rgba(255,255,255,0.02)" : "rgba(255, 255, 255, 0.05)",
                        border: "1px solid var(--glass-border)",
                        color: currentPage === totalPages ? "rgba(255,255,255,0.2)" : "white",
                        padding: "5px 12px",
                        borderRadius: "6px",
                        cursor: currentPage === totalPages ? "not-allowed" : "pointer",
                        fontWeight: 600,
                      }}
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Alertas de Validación / Advertencias */}
            {warningsList.length > 0 && (
              <div
                style={{
                  background: "rgba(245, 158, 11, 0.08)",
                  border: "1px solid rgba(245, 158, 11, 0.4)",
                  borderRadius: "8px",
                  padding: "16px 20px",
                  color: "#fde047",
                  fontSize: "0.85rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "15px",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <strong style={{ color: "#fbbf24", fontSize: "0.9rem" }}>
                    ⚠️ Advertencias de calidad detectadas:
                  </strong>
                  {warningsList.map((warn, wIdx) => (
                    <div key={wIdx}>{warn}</div>
                  ))}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {(lossCount > 0 || zeroOrNegativeMoneyCount > 0) && (
                    <button
                      onClick={applySuggestedPrices}
                      style={{
                        background: "rgba(52, 211, 153, 0.15)",
                        border: "1px solid #34d399",
                        color: "#34d399",
                        padding: "6px 12px",
                        borderRadius: "6px",
                        cursor: "pointer",
                        fontSize: "0.78rem",
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        transition: "background 0.2s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(52, 211, 153, 0.25)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(52, 211, 153, 0.15)")}
                    >
                      ⚡ Aplicar Margen Sugerido ({avgMargin.toFixed(1)}%)
                    </button>
                  )}
                  <button
                    onClick={downloadWarningReport}
                    style={{
                      background: "rgba(245, 158, 11, 0.15)",
                      border: "1px solid #fbbf24",
                      color: "#fde047",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontSize: "0.78rem",
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      transition: "background 0.2s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(245, 158, 11, 0.25)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(245, 158, 11, 0.15)")}
                  >
                    📥 Descargar Reporte
                  </button>
                </div>
              </div>
            )}

            {/* Tarjeta de Advertencia / Leyenda Informativa */}
            <div
              style={{
                background: "rgba(59, 130, 246, 0.06)",
                border: "1px solid rgba(59, 130, 246, 0.3)",
                borderRadius: "10px",
                padding: "16px 20px",
                color: "rgba(255,255,255,0.85)",
                fontSize: "0.88rem",
                lineHeight: "1.6",
              }}
            >
              <h4 style={{ color: "#93c5fd", fontWeight: 600, marginBottom: "6px" }}>
                ⚠️ Información de Importación Masiva
              </h4>
              <ul style={{ paddingLeft: "20px", margin: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
                <li>
                  Los productos nuevos detectados por el sistema <strong>se agregarán</strong> automáticamente.
                </li>
                <li>
                  Los productos existentes <strong>sólo sumarán las nuevas existencias</strong> y se actualizarán a los nuevos precios y costos.
                </li>
                <li>
                  Si la base de datos no tiene registrado algún proveedor o código, <strong>el sistema los creará</strong> de forma limpia y automática.
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* Botones de Navegación del Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "10px",
            borderTop: "1px solid var(--glass-border)",
            paddingTop: "20px",
          }}
        >
          {/* Lado izquierdo */}
          <div style={{ display: "flex", gap: "10px" }}>
            {step > 1 && (
              <>
                <button
                  onClick={handlePrevStep}
                  disabled={isProcessing}
                  style={{
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid var(--glass-border)",
                    color: "white",
                    padding: "10px 20px",
                    borderRadius: "8px",
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: "0.9rem",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.1)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)")}
                >
                  Volver
                </button>
                <button
                  onClick={handleReset}
                  disabled={isProcessing}
                  style={{
                    background: "rgba(239, 68, 68, 0.1)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    color: "#fca5a5",
                    padding: "10px 20px",
                    borderRadius: "8px",
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: "0.9rem",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.2)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.1)")}
                >
                  Reiniciar Asistente
                </button>
              </>
            )}
          </div>

          {/* Lado derecho */}
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={onClose}
              disabled={isProcessing}
              style={{
                background: "transparent",
                border: "none",
                color: "rgba(255,255,255,0.6)",
                padding: "10px 20px",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "0.9rem",
                transition: "color 0.2s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "white")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255, 255, 255, 0.6)")}
            >
              Cancelar
            </button>

            {step < 7 ? (
              <button
                onClick={handleNextStep}
                style={{
                  background: "linear-gradient(135deg, var(--color-primary), var(--color-accent))",
                  border: "none",
                  color: "white",
                  padding: "10px 24px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "0.9rem",
                  boxShadow: "0 4px 15px rgba(244, 63, 94, 0.2)",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow = "0 6px 20px rgba(244, 63, 94, 0.35)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 4px 15px rgba(244, 63, 94, 0.2)";
                }}
              >
                Aceptar y Continuar
              </button>
            ) : (
              <button
                onClick={handleImport}
                disabled={isProcessing}
                style={{
                  background: isProcessing
                    ? "rgba(16, 185, 129, 0.5)"
                    : "linear-gradient(135deg, var(--color-secondary), #059669)",
                  border: "none",
                  color: "white",
                  padding: "10px 26px",
                  borderRadius: "8px",
                  cursor: isProcessing ? "not-allowed" : "pointer",
                  fontWeight: 600,
                  fontSize: "0.9rem",
                  boxShadow: "0 4px 15px rgba(16, 185, 129, 0.2)",
                  transition: "all 0.2s",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => {
                  if (!isProcessing) {
                    e.currentTarget.style.transform = "translateY(-1px)";
                    e.currentTarget.style.boxShadow = "0 6px 20px rgba(16, 185, 129, 0.35)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isProcessing) {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "0 4px 15px rgba(16, 185, 129, 0.2)";
                  }
                }}
              >
                {isProcessing ? "Procesando carga..." : "Procesar Importación"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
