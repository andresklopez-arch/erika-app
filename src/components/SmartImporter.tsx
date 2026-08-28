"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabaseClient";
import { saveSupplier } from "../lib/suppliersClient";
import { normalizeText } from "../utils/levenshtein";

// Un solo lugar para este número -- antes el .limit() de la consulta y el
// texto "últimas N importaciones" de la interfaz se podían desincronizar
// (pasó justo hoy al subir el límite de 10 a 30 sin actualizar el texto).
const IMPORT_HISTORY_LIMIT = 30;

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
  return normalizeText(str)
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

// Detector inteligente de unidad por nombre/descripción del artículo
export const detectUnitFromName = (name: string): "pieza" | "kg" | "g" | "m" | "l" => {
  if (!name) return "pieza";
  const lower = name.toLowerCase();
  
  // Metros
  if (/\b(metro|metros|mts|mt)\b/i.test(lower) || 
      /(cable|manguera|perfil|tubo|cadena|soga|alambre|cuerda|lona por metro|malla por metro|guia por metro|cinta por metro)/i.test(lower)) {
    return "m";
  }
  // Litros
  if (/\b(litro|litros|lt|lts)\b/i.test(lower) || 
      /(thinner|solvente|aceite|pintura|impermeabilizante|resina|acido|anticongelante|barniz|sellador|pegamento liquido|aguarras|gasolina|alcohol)/i.test(lower)) {
    return "l";
  }
  // Kilogramos
  if (/\b(kilo|kilos|kg|kgs)\b/i.test(lower) || 
      /(a granel|por kilo|clavos por kilo|alambre por kilo|estopa por kilo|yeso por kilo|cemento por kilo)/i.test(lower)) {
    return "kg";
  }
  // Gramos
  if (/\b(gramo|gramos|gr|grs)\b/i.test(lower)) {
    return "g";
  }
  return "pieza";
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
  const [units, setUnits] = useState<("pieza" | "kg" | "g" | "m" | "l")[]>([]);

  // Paginación de la previsualización final
  const [currentPage, setCurrentPage] = useState(1);

  // Carga directa de archivo Excel/CSV (alternativa a copiar/pegar columna
  // por columna en los pasos 1-6). Reduce el riesgo de seleccionar la
  // columna equivocada al copiar en Excel -- exactamente lo que causó el
  // incidente de VEKER (2026-08-27): al copiar "código" se incluyó sin
  // querer la columna de marca, y todo el lote terminó con el mismo valor.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isParsingFile, setIsParsingFile] = useState(false);

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
        .limit(IMPORT_HISTORY_LIMIT);
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

  // Detecta las 2 señales de "esto no es un código único por producto"
  // (mismo código repetido en el lote, o códigos sin ningún dígito) y
  // pregunta antes de continuar. Compartido por el pegado manual (paso 1) y
  // la carga directa de Excel -- ambos caminos terminan alimentando el mismo
  // `codes[]`, así que ambos corren el mismo riesgo que causó el incidente
  // de VEKER (2026-08-27): 8 medidas de tornillos con el mismo código
  // colapsaron en un solo producto porque el importador fusiona por código.
  // Devuelve true si se debe continuar.
  const confirmCodeQuality = (parsed: string[]): boolean => {
    const codeCounts = new Map<string, number>();
    parsed.forEach((c) => {
      const key = c.trim().toUpperCase();
      if (key) codeCounts.set(key, (codeCounts.get(key) || 0) + 1);
    });
    const repeated = Array.from(codeCounts.entries()).filter(([, count]) => count > 1);
    if (repeated.length > 0) {
      const totalRepeatedRows = repeated.reduce((sum, [, count]) => sum + count, 0);
      const sample = repeated.slice(0, 5).map(([code, count]) => `"${code}" (${count} veces)`).join(", ");
      const proceed = window.confirm(
        `⚠️ ${totalRepeatedRows} fila(s) de este lote comparten el mismo código: ${sample}${repeated.length > 5 ? "..." : ""}.\n\n` +
        `Si esto NO es un código de barras único por producto (por ejemplo, pegaste la marca o el proveedor por error), estas filas se van a FUSIONAR entre sí como si fueran el mismo producto — solo la última medida/variante sobrevivirá.\n\n` +
        `¿Estás seguro de que quieres continuar con estos códigos repetidos?`
      );
      if (!proceed) return false;
    }

    // Segunda señal, independiente de la anterior: un código de
    // barras/SKU real casi siempre trae dígitos (EAN-13, UPC, folios
    // internos numerados). Si la MAYORÍA de los códigos de este lote no
    // traen ningún dígito, es probable que se haya pegado texto que no es
    // un código único (marca, categoría, proveedor) aunque cada fila
    // tenga un valor DISTINTO dentro de este lote mismo -- el riesgo de
    // fusión aparece en la SIGUIENTE importación que vuelva a pegar un
    // texto parecido. Mismo heurístico que scripts/audit-suspicious-inventory-codes.js.
    const nonEmptyCodes = parsed.map((c) => c.trim()).filter(Boolean);
    const codesWithoutDigits = nonEmptyCodes.filter((c) => !/[0-9]/.test(c));
    if (repeated.length === 0 && nonEmptyCodes.length > 0 && codesWithoutDigits.length / nonEmptyCodes.length >= 0.5) {
      const proceed = window.confirm(
        `⚠️ ${codesWithoutDigits.length} de ${nonEmptyCodes.length} códigos de este lote no tienen ningún número (ej. "${codesWithoutDigits[0]}") -- no parecen códigos de barras/SKU reales.\n\n` +
        `Si en realidad pegaste la marca, proveedor o categoría (no un código único por producto), una importación futura que use un texto parecido podría fusionarse por error con estos productos.\n\n` +
        `¿Continuar de todos modos?`
      );
      if (!proceed) return false;
    }

    return true;
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
      if (!confirmCodeQuality(parsed)) return;
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
        setStocks(parsed.map(parseNumericCell));
        setInputText("");
        setStep(5);
      } else if (step === 5) {
        setCosts(parsed.map(parseNumericCell));
        setInputText("");
        setStep(6);
      } else if (step === 6) {
        setPrices(parsed.map(parseNumericCell));
        // Inicializar unidades con auto-detección inteligente basada en el nombre
        const detectedUnits = names.map((name) => detectUnitFromName(name));
        setUnits(detectedUnits);
        setInputText("");
        setCurrentPage(1); // Reiniciar paginación al entrar a la vista previa
        setStep(7);
      }
    }
  };

  // Palabras clave para detectar automáticamente qué columna del Excel
  // corresponde a cada dato -- por nombre de encabezado, sin importar el
  // orden de las columnas ni cómo se llame exactamente cada una.
  // cost/price van primero por la frase compuesta ("Precio de Compra" /
  // "Precio de Venta") -- antes ambos hints coincidían con cualquier header
  // que dijera "precio", así que "Precio de Compra" y "Precio de Venta" se
  // resolvían a LA MISMA columna (la que apareciera primero en el archivo)
  // y una de las dos columnas reales nunca se leía. code ya no exige que el
  // header sea EXACTAMENTE una de estas palabras (antes ^...$) -- así
  // headers reales como "Código de Barras" o "Clave del Producto" sí se
  // detectan, igual que el resto de los hints (todos por substring).
  const COLUMN_HEADER_HINTS: Record<"code" | "name" | "supplier" | "stock" | "cost" | "price", RegExp> = {
    code: /(codigo|código|sku|clave|barcode)/i,
    name: /(nombre|descripcion|descripción|producto|articulo|artículo)/i,
    supplier: /(proveedor|marca|supplier)/i,
    stock: /(stock|existencia|cantidad)/i,
    cost: /(costo|precio\s*de?\s*compra|compra)/i,
    price: /(^precio$|precio\s*de?\s*venta|venta|pvp)/i,
  };

  const parseNumericCell = (v: unknown): number => {
    const num = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
    return isNaN(num) ? 0 : num;
  };

  // Carga directa del archivo Excel/CSV: lee la primera hoja, detecta las
  // columnas por su encabezado y llena directamente codes/names/suppliers/
  // stocks/costs/prices -- salta por completo los pasos 1-6 (copiar/pegar
  // columna por columna), que es donde ocurrió el incidente de VEKER: al
  // copiar en Excel se incluyó sin querer una columna distinta a la
  // pretendida. Leer las columnas por SU NOMBRE, no por selección manual,
  // elimina esa clase de error.
  const handleFileUpload = async (file: File) => {
    setErrorMsg("");
    setIsParsingFile(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        setErrorMsg("⚠️ El archivo no tiene ninguna hoja con datos.");
        return;
      }
      const sheet = workbook.Sheets[firstSheetName];
      const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      if (rows.length < 2) {
        setErrorMsg("⚠️ El archivo no tiene filas de datos (solo encabezados, o está vacío).");
        return;
      }

      const headerRow = rows[0].map((h) => String(h || "").trim());
      const findColumn = (hint: RegExp) => headerRow.findIndex((h) => hint.test(h));

      const colIdx = {
        code: findColumn(COLUMN_HEADER_HINTS.code),
        name: findColumn(COLUMN_HEADER_HINTS.name),
        supplier: findColumn(COLUMN_HEADER_HINTS.supplier),
        stock: findColumn(COLUMN_HEADER_HINTS.stock),
        cost: findColumn(COLUMN_HEADER_HINTS.cost),
        price: findColumn(COLUMN_HEADER_HINTS.price),
      };

      // Un header ambiguo puede coincidir con dos hints a la vez (ej. "Clave
      // del Producto" trae tanto "clave" -> code como "producto" -> name).
      // NOMBRE es el único campo obligatorio, así que gana la columna en
      // cualquier empate -- el campo perdedor se trata como "no encontrado"
      // (mismo criterio que código vacío: mejor un valor en blanco/auto que
      // adivinar una columna que en realidad es otra cosa).
      (["code", "supplier", "stock", "cost", "price"] as const).forEach((field) => {
        if (colIdx[field] !== -1 && colIdx[field] === colIdx.name) {
          colIdx[field] = -1;
        }
      });

      if (colIdx.name === -1) {
        setErrorMsg(
          "⚠️ No se encontró una columna de NOMBRE/DESCRIPCIÓN en el archivo (se buscó un encabezado como \"Nombre\", \"Descripción\" o \"Producto\"). Revisa que la primera fila tenga los títulos de cada columna."
        );
        return;
      }

      const dataRows = rows.slice(1).filter((r) => r.some((cell) => String(cell ?? "").trim() !== ""));
      const parsedNames = dataRows.map((r) => String(r[colIdx.name] ?? "").trim());
      // Sin columna de código real (muy común en este negocio: no todos los
      // productos traen barcode), se deja vacío a propósito -- el
      // importador ya genera un SKU único automático por fila cuando el
      // código viene vacío. Eso es MÁS seguro que adivinar una columna
      // equivocada, que es justo lo que causó el incidente de VEKER.
      const parsedCodes = colIdx.code !== -1
        ? dataRows.map((r) => String(r[colIdx.code] ?? "").trim())
        : dataRows.map(() => "");
      const parsedSuppliers = colIdx.supplier !== -1 ? dataRows.map((r) => String(r[colIdx.supplier] ?? "").trim()) : dataRows.map(() => "");
      const parsedStocks = colIdx.stock !== -1 ? dataRows.map((r) => parseNumericCell(r[colIdx.stock])) : dataRows.map(() => 0);
      const parsedCosts = colIdx.cost !== -1 ? dataRows.map((r) => parseNumericCell(r[colIdx.cost])) : dataRows.map(() => 0);
      const parsedPrices = colIdx.price !== -1 ? dataRows.map((r) => parseNumericCell(r[colIdx.price])) : dataRows.map(() => 0);

      const missingCols: string[] = [];
      if (colIdx.code === -1) missingCols.push("Código");
      if (colIdx.supplier === -1) missingCols.push("Proveedor");
      if (colIdx.stock === -1) missingCols.push("Existencias");
      if (colIdx.cost === -1) missingCols.push("Costo");
      if (colIdx.price === -1) missingCols.push("Precio");

      if (parsedCodes.some((c) => c) && !confirmCodeQuality(parsedCodes)) {
        return;
      }

      if (missingCols.length > 0) {
        const defaultsUsed = [
          ...(missingCols.includes("Código") ? ["código vacío (se genera automático)"] : []),
          ...missingCols.filter((c) => c !== "Código").map((c) => `${c.toLowerCase()} en 0`),
        ];
        const proceed = window.confirm(
          `No se encontraron estas columnas por su encabezado: ${missingCols.join(", ")}.\n\n` +
          `Se va a continuar con ${defaultsUsed.join(", ")} para esas columnas.\n\n` +
          `¿Continuar de todos modos?`
        );
        if (!proceed) return;
      }

      setCodes(parsedCodes);
      setNames(parsedNames);
      setSuppliers(parsedSuppliers);
      setStocks(parsedStocks);
      setCosts(parsedCosts);
      setPrices(parsedPrices);
      setUnits(parsedNames.map((name) => detectUnitFromName(name)));
      setCurrentPage(1);
      setStep(7);
    } catch (err) {
      console.error("Error al leer el archivo:", err);
      const message = err instanceof Error ? err.message : String(err);
      setErrorMsg(`⚠️ No se pudo leer el archivo: ${message}. Verifica que sea un .xlsx, .xls o .csv válido.`);
    } finally {
      setIsParsingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
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
      setUnits([]);
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

  // Índice código -> producto existente, construido UNA sola vez por cambio
  // de existingItems (no en cada render mientras se revisa el lote). Antes
  // el chequeo de colisiones hacía existingItems.some(...) DENTRO de un
  // forEach sobre codes, dando O(filas × productos existentes) en el cuerpo
  // del componente -- con un lote de 5000 filas contra un catálogo de unos
  // miles de productos, eso son millones de comparaciones en CADA render
  // mientras el cajero solo está revisando la tabla (cualquier tecla,
  // cambio de página o de unidad). Con este mapa, cada fila del lote es una
  // búsqueda O(1).
  const existingByCode = useMemo(() => {
    const map = new Map<string, (typeof existingItems)[number]>();
    for (const item of existingItems) {
      if (item.code) map.set(item.code.trim().toUpperCase(), item);
    }
    return map;
  }, [existingItems]);

  // Lógica de cálculo de advertencias y alertas del lote
  const warningsList: string[] = [];
  let lossCount = 0;
  let zeroOrNegativeMoneyCount = 0;
  let negativeStockCount = 0;
  let emptyNameOrCodeCount = 0;
  let codeCollisionCount = 0;

  if (step === 7) {
    codes.forEach((code, idx) => {
      const name = names[idx] || "";
      const stock = stocks[idx] || 0;
      const cost = costs[idx] || 0;
      const price = prices[idx] || 0;

      // Código vacío NO es un error bloqueante: el importador genera un SKU
      // único automático cuando falta (ver inserts.push en el import real,
      // más abajo) -- de hecho es el comportamiento esperado cuando se sube
      // un archivo sin columna de código (ver handleFileUpload). Nombre
      // vacío sí bloquea: no hay un valor de respaldo razonable para eso.
      if (!name) {
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
      // Mismo chequeo que el aviso por fila más abajo: código ya usado por
      // un producto con OTRO nombre en la BD -- la señal directa del
      // incidente de VEKER (2026-08-27). Se cuenta aparte para que también
      // aparezca en el diálogo de confirmación, no solo en la tabla (fácil
      // de pasar por alto en lotes grandes).
      const trimmedCode = code.trim();
      if (trimmedCode) {
        const existingMatch = existingByCode.get(trimmedCode.toUpperCase());
        if (existingMatch && normalizeString(existingMatch.name) !== normalizeString(name)) {
          codeCollisionCount++;
        }
      }
    });

    if (codeCollisionCount > 0) {
      warningsList.push(
        `🚨 Códigos en Conflicto: Hay ${codeCollisionCount} producto(s) cuyo código ya pertenece a OTRO producto distinto en tu inventario -- van a SOBRESCRIBIRLO (nombre, precio y costo cambiarán). Revísalos en la tabla de abajo antes de continuar.`
      );
    }
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
        `⚠️ Datos Faltantes: Hay ${emptyNameOrCodeCount} producto(s) sin nombre.`
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
    // Antes las advertencias se calculaban y mostraban en rojo, pero el botón
    // no las revisaba: se podía importar de todos modos con filas sin código
    // ni nombre. Los datos faltantes se bloquean (fila inválida); el resto de
    // advertencias (precio en $0, margen negativo, stock negativo) se confirman
    // porque pueden ser decisiones de negocio legítimas.
    if (emptyNameOrCodeCount > 0) {
      alert(
        `❌ No se puede importar: ${emptyNameOrCodeCount} producto(s) no tienen nombre. Corrige esas filas antes de continuar.`
      );
      return;
    }
    // /api/inventory/bulk-import rechaza lotes de más de 5000 filas (límite
    // de seguridad contra un payload manipulado) — se avisa aquí antes,
    // para no hacer esperar al usuario solo para que falle en el servidor.
    if (codes.length > 5000) {
      alert(
        `❌ Este lote tiene ${codes.length} productos. El máximo por carga es 5,000. Divide el archivo en partes más pequeñas e impórtalas por separado.`
      );
      return;
    }
    if (warningsList.length > 0) {
      const proceed = window.confirm(
        `Se encontraron advertencias antes de importar:\n\n${warningsList.join("\n")}\n\n¿Deseas continuar con la importación de todos modos?`
      );
      if (!proceed) return;
    }

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

      const failedSuppliers: string[] = [];
      for (const sup of uniqueSuppliers) {
        if (!dbSuppliersLower.includes(sup.toLowerCase())) {
          // Supabase-js resuelve la promesa (no la rechaza) aunque venga
          // error poblado — un try/catch alrededor nunca lo detectaba.
          const cleanSup = sup
            .toLowerCase()
            .replace(/\b\w/g, (c) => c.toUpperCase());
          const { error: supErr } = await saveSupplier({ fields: { name: cleanSup } });
          if (supErr) {
            console.error("Error al registrar proveedor:", sup, supErr);
            failedSuppliers.push(cleanSup);
          }
        }
      }
      if (failedSuppliers.length > 0) {
        alert(
          `⚠️ No se pudieron crear estos proveedores nuevos: ${failedSuppliers.join(", ")}. Los productos importados igual quedarán etiquetados con ese nombre, pero no aparecerán en el listado de Proveedores hasta que los crees manualmente.`,
        );
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
          sale_unit: units[idx] || "pieza",
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
                Bitácora de las últimas {IMPORT_HISTORY_LIMIT} importaciones desde Supabase.
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

            {step === 1 && (
              <div
                style={{
                  border: "1px dashed var(--glass-border)",
                  borderRadius: "8px",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "8px",
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)", textAlign: "center", margin: 0 }}>
                  📂 O sube el Excel/CSV completo directo (recomendado) — detecta las columnas por su encabezado, sin tener que copiar/pegar una por una.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                  }}
                />
                <button
                  type="button"
                  className="btn-primary"
                  disabled={isParsingFile}
                  onClick={() => fileInputRef.current?.click()}
                  style={{ padding: "8px 20px", fontSize: "0.9rem" }}
                >
                  {isParsingFile ? "⏳ Leyendo archivo..." : "📤 Subir archivo Excel/CSV"}
                </button>
                <p style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.4)", textAlign: "center", margin: 0 }}>
                  La primera fila debe traer los títulos de columna (ej. &quot;Nombre&quot;, &quot;Proveedor&quot;, &quot;Existencias&quot;, &quot;Costo&quot;, &quot;Precio&quot;).
                </p>
              </div>
            )}

            {step === 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>
                <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.1)" }} />
                <span>o pega columna por columna</span>
                <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.1)" }} />
              </div>
            )}

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

            {/* Barra de Asignación Rápida de Unidades */}
            <div
              style={{
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid var(--glass-border)",
                borderRadius: "10px",
                padding: "12px 16px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                <span style={{ fontSize: "0.88rem", color: "white", fontWeight: "bold", display: "flex", alignItems: "center", gap: "6px" }}>
                  ⚖️ Asignación Rápida de Unidades de Venta (Pieza / Metro / Litro / Kg):
                </span>
                <button
                  type="button"
                  onClick={() => setUnits(names.map((name) => detectUnitFromName(name)))}
                  style={{
                    padding: "5px 12px",
                    fontSize: "0.78rem",
                    background: "linear-gradient(135deg, var(--color-primary), var(--color-accent))",
                    color: "white",
                    border: "none",
                    borderRadius: "6px",
                    fontWeight: "bold",
                    cursor: "pointer",
                    boxShadow: "0 2px 8px rgba(244, 63, 94, 0.3)",
                  }}
                  title="Analiza automáticamente cada nombre de producto para clasificarlo inteligentemente"
                >
                  🧠 Re-analizar y Auto-Detectar según Nombres
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.6)" }}>Cambiar todas a:</span>
                <button
                  type="button"
                  onClick={() => setUnits(new Array(codes.length).fill("pieza"))}
                  style={{
                    padding: "4px 10px",
                    fontSize: "0.75rem",
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid var(--glass-border)",
                    color: "white",
                    borderRadius: "6px",
                    cursor: "pointer",
                  }}
                >
                  📦 Todas a Pieza (pz)
                </button>
                <button
                  type="button"
                  onClick={() => setUnits(new Array(codes.length).fill("m"))}
                  style={{
                    padding: "4px 10px",
                    fontSize: "0.75rem",
                    background: "rgba(59, 130, 246, 0.15)",
                    border: "1px solid #3b82f6",
                    color: "#60a5fa",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontWeight: "bold",
                  }}
                >
                  📏 Todas a Metro (m)
                </button>
                <button
                  type="button"
                  onClick={() => setUnits(new Array(codes.length).fill("l"))}
                  style={{
                    padding: "4px 10px",
                    fontSize: "0.75rem",
                    background: "rgba(16, 185, 129, 0.15)",
                    border: "1px solid #10b981",
                    color: "#34d399",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontWeight: "bold",
                  }}
                >
                  🧴 Todas a Litro (L)
                </button>
                <button
                  type="button"
                  onClick={() => setUnits(new Array(codes.length).fill("kg"))}
                  style={{
                    padding: "4px 10px",
                    fontSize: "0.75rem",
                    background: "rgba(245, 158, 11, 0.15)",
                    border: "1px solid #f59e0b",
                    color: "#fbbf24",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontWeight: "bold",
                  }}
                >
                  ⚖️ Todas a Kilo (kg)
                </button>
              </div>
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
              <div style={{ overflowX: "auto", maxHeight: "280px" }}>
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
                      <th style={{ padding: "10px 15px", color: "#60a5fa", fontWeight: "bold" }}>Unidad de Venta</th>
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
                      const currentUnit = units[absoluteIdx] || "pieza";

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

                      // El caso que de verdad causó el incidente de VEKER: el
                      // CÓDIGO coincide con un producto YA EXISTENTE, pero el
                      // NOMBRE es distinto. Sin este aviso, esa fila
                      // reemplaza en silencio los datos de ese otro producto
                      // (fusión "sustituir") sin que el cajero se entere hasta
                      // después de confirmar toda la importación.
                      const codeMatchCandidate = code ? existingByCode.get(code.trim().toUpperCase()) : undefined;
                      const codeMatch =
                        codeMatchCandidate && normalizeString(codeMatchCandidate.name) !== normalizeString(name)
                          ? codeMatchCandidate
                          : undefined;
                      const resultingStock = codeMatch ? (Number(codeMatch.stock) || 0) + stock : null;

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
                              color: isCodeErr ? "rgba(255,255,255,0.4)" : "#fca5a5",
                              backgroundColor: "transparent",
                            }}
                            title={isCodeErr ? "Código vacío: se genera un SKU único automático al importar." : ""}
                          >
                            {code || "(auto)"}
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
                            {codeMatch && (
                              <span
                                style={{ display: "block", fontSize: "0.72rem", color: "#ef4444", fontWeight: "bold", marginTop: "2px" }}
                                title={`El código "${code}" ya pertenece a "${codeMatch.name}" (stock actual: ${codeMatch.stock}). Si continúas, esta fila SOBRESCRIBE ese producto: nombre/precio/costo cambiarán a los de esta fila y el stock quedará en ${resultingStock} (${codeMatch.stock} + ${stock}).`}
                              >
                                🚨 Código ya usado por: {codeMatch.name} (stock {codeMatch.stock} → {resultingStock})
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "8px 15px" }}>
                            <select
                              value={currentUnit}
                              onChange={(e) => {
                                const updated = [...units];
                                updated[absoluteIdx] = e.target.value as any;
                                setUnits(updated);
                              }}
                              style={{
                                background: "rgba(0,0,0,0.5)",
                                border: currentUnit === "m" ? "1px solid #3b82f6" : currentUnit === "l" ? "1px solid #10b981" : currentUnit === "kg" ? "1px solid #f59e0b" : "1px solid var(--glass-border)",
                                color: currentUnit === "m" ? "#60a5fa" : currentUnit === "l" ? "#34d399" : currentUnit === "kg" ? "#fbbf24" : "white",
                                borderRadius: "6px",
                                padding: "4px 8px",
                                fontSize: "0.82rem",
                                fontWeight: "bold",
                                outline: "none",
                                cursor: "pointer",
                              }}
                              title="Selecciona la unidad de venta para este producto"
                            >
                              <option value="pieza" style={{ background: "#18181b", color: "white" }}>📦 Pieza (pz)</option>
                              <option value="m" style={{ background: "#18181b", color: "#60a5fa" }}>📏 Metro (m)</option>
                              <option value="l" style={{ background: "#18181b", color: "#34d399" }}>🧴 Litro (L)</option>
                              <option value="kg" style={{ background: "#18181b", color: "#fbbf24" }}>⚖️ Kilo (kg)</option>
                              <option value="g" style={{ background: "#18181b", color: "#a78bfa" }}>🧂 Gramo (g)</option>
                            </select>
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
                            {stock} {currentUnit !== "pieza" ? `(${currentUnit})` : ''}
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
