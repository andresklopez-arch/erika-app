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

  // Función para procesar y limpiar el texto pegado
  const parsePastedText = (text: string) => {
    if (!text) return [];
    // Dividir por saltos de línea
    const lines = text.split(/\r?\n/);
    // Eliminar última línea si está vacía (común en Excel al copiar rangos)
    if (lines.length > 0 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }
    return lines.map((line) => {
      // Si el usuario copió accidentalmente más columnas, tomar sólo la primera (separador tabulador)
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
      // Validar cantidad de filas estricta en base al Paso 1
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
            // Capitalizar nombre de proveedor de forma limpia
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

      // 3. Ejecutar la importación (acumulando existencias y actualizando precios de los existentes)
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
                Verifica que todos los datos estén alineados correctamente antes de guardar.
              </p>
            </div>

            {/* Contenedor de la Tabla */}
            <div
              style={{
                overflowX: "auto",
                maxHeight: "300px",
                border: "1px solid var(--glass-border)",
                borderRadius: "10px",
                backgroundColor: "rgba(0,0,0,0.15)",
              }}
            >
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
                  {codes.map((code, idx) => (
                    <tr
                      key={idx}
                      style={{
                        borderBottom: "1px solid rgba(255, 255, 255, 0.03)",
                        transition: "background 0.2s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.02)")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <td style={{ padding: "8px 15px", color: "rgba(255,255,255,0.4)" }}>
                        {idx + 1}
                      </td>
                      <td style={{ padding: "8px 15px", fontWeight: "bold", color: "#fca5a5" }}>
                        {code}
                      </td>
                      <td style={{ padding: "8px 15px", color: "white" }}>{names[idx]}</td>
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
                          {suppliers[idx] || "Pendiente"}
                        </span>
                      </td>
                      <td style={{ padding: "8px 15px", color: "#fb923c" }}>
                        {autoLocations[idx]}
                      </td>
                      <td style={{ padding: "8px 15px", fontWeight: 600, color: "white" }}>
                        {stocks[idx]}
                      </td>
                      <td style={{ padding: "8px 15px", color: "rgba(255,255,255,0.8)" }}>
                        ${(costs[idx] || 0).toFixed(2)}
                      </td>
                      <td style={{ padding: "8px 15px", fontWeight: 600, color: "#34d399" }}>
                        ${(prices[idx] || 0).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

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
          <div>
            {step > 1 && (
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
            )}
          </div>

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
