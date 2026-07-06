"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useSearchParams, useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import SmartImporter from "./SmartImporter";
import { supabase, clearMissingColumnsCache } from "../lib/supabaseClient";
import ClientCaptureModal from "./ClientCaptureModal";
import SuppliersManagerModal from "./SuppliersManagerModal";
import AccountsPayableModal from "./AccountsPayableModal";
import LossesManagerModal from "./LossesManagerModal";
import LayawayModal from "./LayawayModal";
import InboundModal from "./InboundModal";
import AuditModule from "./AuditModule";
import { useAuth } from "./AuthProvider";

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

const highlightText = (text: string | undefined, query: string) => {
  if (!text) return "";
  if (!query.trim()) return text;
  
  const tokens = query
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return text;

  const escapedTokens = tokens.map(t => t.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
  const pattern = new RegExp(`(${escapedTokens.join("|")})`, "gi");
  
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, index) => {
        const isMatch = tokens.some(t => {
          const normPart = part.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          const normT = t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          return normPart === normT;
        });
        return isMatch ? (
          <mark 
            key={index} 
            style={{ 
              background: "rgba(244, 63, 94, 0.25)", 
              color: "var(--color-primary)", 
              padding: "2px 4px", 
              borderRadius: "4px", 
              fontWeight: "bold" 
            }}
          >
            {part}
          </mark>
        ) : (
          part
        );
      })}
    </>
  );
};


export interface InventoryItem {
  id: string;
  code?: string;
  name: string;
  price: number;
  stock: number;
  minStock: number;
  cost: number;
  salesIndex: number;
  supplier?: string;
  location?: string;
  autoPriced?: boolean;
  priceChanged?: "up" | "down";
  deleted?: boolean;
  deleted_at?: string | null;
  discount_pct?: number;
}

export default function InventoryModule() {
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = searchParams ? searchParams.get("tab") : null;

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [allItems, setAllItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [visibleDuplicates, setVisibleDuplicates] = useState(15);
  const [showScrollIndicator, setShowScrollIndicator] = useState(false);
  const [mergedItemId, setMergedItemId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [totalCount, setTotalCount] = useState<number | null>(null);

  const [dbSuppliers, setDbSuppliers] = useState<string[]>([]);
  const [selectedSupplierFilter, setSelectedSupplierFilter] = useState<string>("");
  const [showOnlyDiscounts, setShowOnlyDiscounts] = useState<boolean>(false);
  const [sortColumn, setSortColumn] = useState<string>("name");
  const [sortAscending, setSortAscending] = useState<boolean>(true);
  const [editingCell, setEditingCell] = useState<{ itemId: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [hoveredCell, setHoveredCell] = useState<{ itemId: string; field: string } | null>(null);
  const [hoveredHeader, setHoveredHeader] = useState<string | null>(null);
  const [lastManualChange, setLastManualChange] = useState<{
    itemId: string;
    field: string;
    oldValue: any;
    newValue: any;
  } | null>(null);
  const [isReverting, setIsReverting] = useState<boolean>(false);
  const panelRef = useRef<HTMLDivElement>(null);
  
  const [undoStack, setUndoStack] = useState<any[][]>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("erika_undo_stack");
      if (stored) {
        try { return JSON.parse(stored); } catch (e) { return []; }
      }
    }
    return [];
  });

  const handleUndo = async () => {
    if (!undoStack || undoStack.length === 0) return;
    
    let isAdmin = false;
    if (typeof window !== "undefined") {
      const authTime = sessionStorage.getItem("erika_admin_auth");
      if (authTime && Date.now() - Number(authTime) < 15 * 60 * 1000) {
        isAdmin = true;
      }
    }

    if (!isAdmin) {
      const pin = prompt("🔒 ACCESO RESTRINGIDO\nIngresa el PIN de Administrador (4 dígitos) para Deshacer:");
      if (pin !== "1234") {
        alert("❌ PIN Incorrecto. Operación cancelada.");
        return;
      }
      if (typeof window !== "undefined") {
        sessionStorage.setItem("erika_admin_auth", String(Date.now()));
        alert("✅ Sesión Administrativa iniciada por 15 minutos.");
      }
    }

    if (!confirm(`⚠️ ¿Estás seguro de que deseas deshacer la importación? (Quedan ${undoStack.length} reversiones disponibles)`)) return;
    setIsLoading(true);
    const lastUndoLog = undoStack[undoStack.length - 1];
    for (const log of lastUndoLog) {
      if (log.isNew) {
        await supabase.from("inventory").delete().eq("code", log.code);
      } else {
        await supabase.from("inventory").update({
          cost: log.cost,
          price: log.price,
          stock: log.stock,
          supplier: log.supplier,
          location: log.location,
          priceChanged: log.priceChanged,
          deleted: log.deleted,
          deleted_at: log.deleted_at
        }).eq("id", log.id);
      }
    }
    const newStack = undoStack.slice(0, -1);
    setUndoStack(newStack);
    if (typeof window !== "undefined") {
      if (newStack.length > 0) {
        localStorage.setItem("erika_undo_stack", JSON.stringify(newStack));
      } else {
        localStorage.removeItem("erika_undo_stack");
      }
    }
    await fetchInventory(0, debouncedSearchQuery, true, true);
    await loadAllItems();
    setPage(0);
    alert("✅ Importación revertida con éxito.");
  };

  // Derived state from tab search param to prevent state out-of-sync and click-blocking modals
  const showClientModal = tab === "clientes";
  const showInboundModal = tab === "recibir";
  const showSuppliersModal = tab === "proveedores";
  const showAccountsPayableModal = tab === "cuentas";
  const showLossesModal = tab === "gastos";
  const showLayaways = tab === "apartados";
  const showImporter = tab === "carga";
  const showAudit = tab === "arqueo";
  const showCritical = tab === "criticos";
  const showDuplicates = tab === "duplicados";
  const createParam = searchParams ? searchParams.get("create") : null;

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProductName, setNewProductName] = useState("");
  const [newProductCode, setNewProductCode] = useState("");
  const [newProductCost, setNewProductCost] = useState("");
  const [newProductPrice, setNewProductPrice] = useState("");
  const [newProductStock, setNewProductStock] = useState("1");

  useEffect(() => {
    if (createParam) {
      setNewProductName(createParam);
      setShowCreateModal(true);
    }
  }, [createParam]);

  const handleCreateProduct = async () => {
    if (!newProductName) return alert("Nombre es requerido");
    const c = parseFloat(newProductCost) || 0;
    const p = parseFloat(newProductPrice) || 0;
    const s = parseInt(newProductStock) || 0;
    
    await supabase.from("inventory").insert({
      code: newProductCode || `SKU-${Date.now()}`,
      name: newProductName,
      cost: c,
      price: p > 0 ? p : c * 1.5,
      stock: s,
      minStock: 5,
      location: "Pendiente",
      supplier: "Pendiente",
      autoPriced: p > 0 ? false : true
    });
    
    alert("✅ Producto creado con éxito");
    setShowCreateModal(false);
    fetchInventory(0, debouncedSearchQuery, true, true);
    loadAllItems();
    setPage(0);
    router.push("/inventario");
  };

  const clearTabParam = () => {
    window.location.href = "/inventario";
  };

  const loadAllItems = async () => {
    let allData: any[] = [];
    let from = 0;
    const limit = 1000;
    let hasMoreData = true;
    let lastError = null;

    while (hasMoreData) {
      const { data, error } = await supabase
        .from("inventory")
        .select("*")
        .not("deleted", "eq", true)
        .order("name", { ascending: true })
        .range(from, from + limit - 1);

      if (error) {
        lastError = error;
        hasMoreData = false;
      } else if (data && data.length > 0) {
        allData = [...allData, ...data];
        if (data.length < limit) {
          hasMoreData = false;
        } else {
          from += limit;
        }
      } else {
        hasMoreData = false;
      }
    }

    // CORRECCIÓN: siempre actualizar el estado aunque sea array vacío,
    // para reflejar el estado real de la BD en la pantalla.
    setAllItems(allData);
    if (lastError) console.error("Error al cargar catálogo completo:", lastError);
  };

  const fetchInventory = async (pageNum: number, queryStr: string, isReset: boolean, showLoading = false) => {
    if (showLoading) setIsLoading(true);
    else if (!isReset) setIsLoadingMore(true);

    try {
      let dbQuery = supabase
        .from("inventory")
        .select("*", { count: "exact" })
        .not("deleted", "eq", true);

      // Apply supplier filter
      if (selectedSupplierFilter) {
        dbQuery = dbQuery.eq("supplier", selectedSupplierFilter);
      }

      // Apply discount filter
      if (showOnlyDiscounts) {
        dbQuery = dbQuery.gt("discount_pct", 0);
      }

      // Apply search query
      const cleanQuery = queryStr.trim();
      if (cleanQuery) {
        const tokens = normalizeString(cleanQuery).split(/\s+/).filter(Boolean);
        tokens.forEach((token) => {
          dbQuery = dbQuery.or(
            `name.ilike.%${token}%,code.ilike.%${token}%,location.ilike.%${token}%,supplier.ilike.%${token}%`
          );
        });
      }

      // Apply sorting (if not margin)
      if (sortColumn && sortColumn !== "margin") {
        dbQuery = dbQuery.order(sortColumn, { ascending: sortAscending });
      } else {
        // Fallback or sort by name
        dbQuery = dbQuery.order("name", { ascending: true });
      }

      const limit = 50;
      const from = pageNum * limit;
      const to = from + limit - 1;
      dbQuery = dbQuery.range(from, to);

      const { data, count, error } = await dbQuery;

      if (error) {
        console.error("Error fetching inventory:", error);
      } else if (data) {
        let finalData = data;
        // In-memory sorting for Margin calculated column
        if (sortColumn === "margin") {
          finalData = [...data].sort((a, b) => {
            const marginA = a.cost > 0 ? (a.price - a.cost) / a.cost : 0;
            const marginB = b.cost > 0 ? (b.price - b.cost) / b.cost : 0;
            return sortAscending ? marginA - marginB : marginB - marginA;
          });
        }

        if (isReset) {
          setItems(finalData);
        } else {
          setItems((prev) => {
            const combined = [...prev, ...finalData];
            if (sortColumn === "margin") {
              return combined.sort((a, b) => {
                const marginA = a.cost > 0 ? (a.price - a.cost) / a.cost : 0;
                const marginB = b.cost > 0 ? (b.price - b.cost) / b.cost : 0;
                return sortAscending ? marginA - marginB : marginB - marginA;
              });
            }
            return combined;
          });
        }
        setTotalCount(count);
        setHasMore(data.length === limit);
      }
    } catch (err) {
      console.error("Exception in fetchInventory:", err);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  };

  const handleDeleteProduct = async (id: string, name: string) => {
    if (!window.confirm(`⚠️ ¿Seguro que deseas eliminar el producto "${name}"?\nSe enviará a la Papelera.`)) return;

    const { error } = await supabase
      .from("inventory")
      .update({ deleted: true, deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      alert("Error al eliminar producto: " + error.message);
    } else {
      alert("🗑️ Producto enviado a la papelera.");
      fetchInventory(0, debouncedSearchQuery, true, true);
      loadAllItems();
      setPage(0);
    }
  };

  const levenshteinDistance = (s1: string, s2: string): number => {
    const len1 = s1.length;
    const len2 = s2.length;
    const matrix: number[][] = [];
    for (let i = 0; i <= len1; i++) matrix[i] = [i];
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    return matrix[len1][len2];
  };

  const getDuplicateGroups = () => {
    const codeGroups: { [key: string]: InventoryItem[] } = {};
    const nameGroups: { [key: string]: InventoryItem[] } = {};

    allItems.forEach((item) => {
      if (item.code && item.code.trim() !== "") {
        const cleanCode = item.code.trim().toUpperCase();
        if (!codeGroups[cleanCode]) codeGroups[cleanCode] = [];
        codeGroups[cleanCode].push(item);
      }

      const cleanName = normalizeString(item.name);
      if (cleanName !== "") {
        const similarKey = Object.keys(nameGroups).find((key) => {
          if (key === cleanName) return true;
          if (key.length < 6 || cleanName.length < 6) return false;
          return levenshteinDistance(key, cleanName) <= 2;
        });

        const targetKey = similarKey || cleanName;
        if (!nameGroups[targetKey]) nameGroups[targetKey] = [];
        nameGroups[targetKey].push(item);
      }
    });

    const groups: { key: string; type: "Código" | "Nombre"; products: InventoryItem[] }[] = [];

    Object.keys(codeGroups).forEach((code) => {
      if (codeGroups[code].length > 1) {
        groups.push({
          key: code,
          type: "Código",
          products: codeGroups[code],
        });
      }
    });

    Object.keys(nameGroups).forEach((nameKey) => {
      if (nameGroups[nameKey].length > 1) {
        const alreadyGroupedByCode = groups.some((g) =>
          g.type === "Código" &&
          g.products.some((p) => nameGroups[nameKey].some((np) => np.id === p.id))
        );
        if (!alreadyGroupedByCode) {
          const nameLabel = nameGroups[nameKey][0].name;
          groups.push({
            key: nameLabel,
            type: "Nombre",
            products: nameGroups[nameKey],
          });
        }
      }
    });

    return groups;
  };

  const handleMergeDuplicates = async (principalItem: InventoryItem, allGroupItems: InventoryItem[]) => {
    const duplicates = allGroupItems.filter((item) => item.id !== principalItem.id);
    if (duplicates.length === 0) return;

    const totalStockToTransfer = duplicates.reduce((sum, item) => sum + item.stock, 0);
    const newStock = principalItem.stock + totalStockToTransfer;

    const confirmMsg = `¿Deseas combinar los duplicados?\n\n` +
      `Se sumarán ${totalStockToTransfer} unidades al producto principal:\n` +
      `👉 "${principalItem.name}" (Stock final: ${newStock})\n\n` +
      `Se enviarán a la Papelera los siguientes productos duplicados:\n` +
      duplicates.map(d => `- [${d.code || 'Sin código'}] ${d.name} (Stock: ${d.stock})`).join("\n") +
      `\n\n¿Proceder con la combinación?`;

    if (!window.confirm(confirmMsg)) return;

    setIsLoading(true);
    try {
      const undoLog: any[] = [];
      undoLog.push({
        id: principalItem.id,
        cost: principalItem.cost,
        price: principalItem.price,
        stock: principalItem.stock,
        supplier: principalItem.supplier,
        location: principalItem.location,
        priceChanged: principalItem.priceChanged,
        deleted: principalItem.deleted || false,
        deleted_at: principalItem.deleted_at || null
      });

      for (const d of duplicates) {
        undoLog.push({
          id: d.id,
          cost: d.cost,
          price: d.price,
          stock: d.stock,
          supplier: d.supplier,
          location: d.location,
          priceChanged: d.priceChanged,
          deleted: false,
          deleted_at: null
        });
      }

      const { error: updateError } = await supabase
        .from("inventory")
        .update({ stock: newStock })
        .eq("id", principalItem.id);

      if (updateError) throw updateError;

      const nowStr = new Date().toISOString();
      for (const duplicate of duplicates) {
        const { error: deleteError } = await supabase
          .from("inventory")
          .update({ deleted: true, deleted_at: nowStr })
          .eq("id", duplicate.id);
        
        if (deleteError) throw deleteError;
      }

      setUndoStack(prev => {
        const newStack = [...(prev || []), undoLog].slice(-5);
        if (typeof window !== "undefined") {
          localStorage.setItem("erika_undo_stack", JSON.stringify(newStack));
        }
        return newStack;
      });

      setMergedItemId(principalItem.id);

      alert("✅ Productos combinados con éxito.");
      await fetchInventory(0, debouncedSearchQuery, true, true);
      await loadAllItems();
      setPage(0);
    } catch (err: any) {
      console.error("Error al combinar duplicados:", err);
      alert(`❌ Error al combinar productos: ${err.message || err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSuppliers = async () => {
    const { data } = await supabase.from("suppliers").select("name").order("name");
    if (data) setDbSuppliers(data.map((s: any) => s.name));
  };

  const handleUndoLastChange = async () => {
    if (!lastManualChange) return;
    const { itemId, field, oldValue } = lastManualChange;

    setIsReverting(true);
    try {
      const { error } = await supabase
        .from("inventory")
        .update({ [field]: oldValue })
        .eq("id", itemId);

      if (error) {
        alert("❌ Error al deshacer cambio: " + error.message);
      } else {
        setItems((prev) =>
          prev.map((item) => (item.id === itemId ? { ...item, [field]: oldValue } : item))
        );
        setAllItems((prev) =>
          prev.map((item) => (item.id === itemId ? { ...item, [field]: oldValue } : item))
        );
        
        const originalItem = allItems.find((i) => i.id === itemId);
        if (originalItem) {
          await supabase.from("error_logs").insert({
            module: "Inventario_Edicion_Manual",
            error_details: `Deshacer edición inline: [${originalItem.code || "Sin código"}] ${originalItem.name} -> Revirtió "${field}" al valor anterior "${oldValue}"`,
            usuario: currentUser?.name || "Administrador"
          });
        }

        setLastManualChange(null);
        alert("✅ Cambio revertido con éxito.");
      }
    } catch (e: any) {
      console.error(e);
    } finally {
      setIsReverting(false);
    }
  };

  const getSearchPlaceholder = () => {
    if (selectedSupplierFilter) {
      return `Buscar productos, códigos o ubicaciones en ${selectedSupplierFilter}...`;
    }
    return "Buscar por Nombre, Código de Barras, Ubicación o Proveedor (Ej: 'tornillo truper pasillo A')...";
  };

  const handleSort = (colName: string) => {
    if (sortColumn === colName) {
      setSortAscending(!sortAscending);
    } else {
      setSortColumn(colName);
      setSortAscending(true);
    }
  };

  const handleUpdateField = async (itemId: string, field: string, value: any) => {
    let finalValue = value;
    
    // Type casting and validation (SUGERENCIA 1: Validación preventiva de valores negativos)
    if (field === "stock") {
      finalValue = parseInt(value);
      if (isNaN(finalValue)) finalValue = 0;
      if (finalValue < 0) {
        alert("⚠️ El stock no puede ser un número negativo.");
        setEditingCell(null);
        return;
      }
    } else if (field === "cost" || field === "price") {
      finalValue = parseFloat(value);
      if (isNaN(finalValue)) finalValue = 0;
      if (finalValue < 0) {
        alert(`⚠️ El ${field === "cost" ? "costo" : "precio"} no puede ser menor a 0.`);
        setEditingCell(null);
        return;
      }
    } else if (field === "discount_pct") {
      finalValue = parseInt(value);
      if (isNaN(finalValue)) finalValue = 0;
      if (finalValue < 0 || finalValue > 100) {
        alert("⚠️ El descuento debe estar entre 0% y 100%.");
        setEditingCell(null);
        return;
      }
    } else if (field === "name") {
      finalValue = String(value).trim();
      if (!finalValue) {
        alert("⚠️ El nombre del producto no puede estar vacío.");
        setEditingCell(null);
        return;
      }
    } else {
      finalValue = String(value).trim();
    }

    const originalItem = allItems.find((i) => i.id === itemId);
    if (originalItem && originalItem[field as keyof InventoryItem] === finalValue) {
      setEditingCell(null);
      return;
    }

    const updateObj: any = { [field]: finalValue };

    if (field === "cost" && originalItem) {
      updateObj.priceChanged = finalValue > originalItem.cost ? "up" : null;
    }

    if (field === "price") {
      updateObj.autoPriced = false;
    }

    const { error } = await supabase
      .from("inventory")
      .update(updateObj)
      .eq("id", itemId);

    if (error) {
      alert("❌ Error al actualizar producto: " + error.message);
    } else {
      // Guardar cambio para el deshacer
      if (originalItem) {
        setLastManualChange({
          itemId,
          field,
          oldValue: originalItem[field as keyof InventoryItem],
          newValue: finalValue
        });
      }

      // SUGERENCIA 3: Registro automático en el Historial de Auditoría (error_logs)
      const criticalFields = ["cost", "price", "stock", "supplier", "location", "code", "name"];
      if (criticalFields.includes(field) && originalItem) {
        const fieldLabels: Record<string, string> = {
          cost: "Costo",
          price: "Precio",
          stock: "Stock",
          supplier: "Proveedor",
          location: "Ubicación",
          code: "Código de Barras",
          name: "Nombre"
        };
        const label = fieldLabels[field] || field;
        const oldVal = originalItem[field as keyof InventoryItem] === undefined || originalItem[field as keyof InventoryItem] === null ? "N/A" : String(originalItem[field as keyof InventoryItem]);
        const newVal = String(finalValue);

        if (oldVal !== newVal) {
          supabase.from("error_logs").insert({
            module: "Inventario_Edicion_Manual",
            error_details: `Edición inline: [${originalItem.code || "Sin código"}] ${originalItem.name} -> Cambió "${label}" de "${oldVal}" a "${newVal}"`,
            usuario: currentUser?.name || "Administrador"
          }).then((res: any) => {
            if (res.error) console.error("Error al registrar auditoría:", res.error);
          });
        }
      }

      setItems((prev) =>
        prev.map((item) => (item.id === itemId ? { ...item, ...updateObj } : item))
      );
      setAllItems((prev) =>
        prev.map((item) => (item.id === itemId ? { ...item, ...updateObj } : item))
      );
    }
    setEditingCell(null);
  };

  const getFilteredAllItems = () => {
    let result = allItems.filter((i) => !i.deleted);

    if (selectedSupplierFilter) {
      result = result.filter((i) => i.supplier === selectedSupplierFilter);
    }

    const cleanQuery = debouncedSearchQuery.trim();
    if (cleanQuery) {
      const tokens = normalizeString(cleanQuery).split(/\s+/).filter(Boolean);
      result = result.filter((item) =>
        tokens.every((token) => {
          const nameMatch = normalizeString(item.name || "").includes(token);
          const codeMatch = normalizeString(item.code || "").includes(token);
          const locMatch = normalizeString(item.location || "").includes(token);
          const supMatch = normalizeString(item.supplier || "").includes(token);
          return nameMatch || codeMatch || locMatch || supMatch;
        })
      );
    }

    result = [...result].sort((a, b) => {
      let valA: any = a[sortColumn as keyof InventoryItem];
      let valB: any = b[sortColumn as keyof InventoryItem];

      if (sortColumn === "margin") {
        valA = a.cost > 0 ? (a.price - a.cost) / a.cost : 0;
        valB = b.cost > 0 ? (b.price - b.cost) / b.cost : 0;
      }

      if (valA === undefined || valA === null) return sortAscending ? 1 : -1;
      if (valB === undefined || valB === null) return sortAscending ? -1 : 1;

      if (typeof valA === "number" && typeof valB === "number") {
        return sortAscending ? valA - valB : valB - valA;
      }

      const strA = String(valA).toLowerCase();
      const strB = String(valB).toLowerCase();
      return sortAscending ? strA.localeCompare(strB) : strB.localeCompare(strA);
    });

    return result;
  };

  const renderHeader = (label: string, colName: string) => {
    const isSorted = sortColumn === colName;
    return (
      <th
        onClick={() => handleSort(colName)}
        onMouseEnter={() => setHoveredHeader(colName)}
        onMouseLeave={() => setHoveredHeader(null)}
        style={{
          padding: "15px",
          cursor: "pointer",
          userSelect: "none",
          background: isSorted ? "rgba(255,255,255,0.08)" : (hoveredHeader === colName ? "rgba(255,255,255,0.04)" : "transparent"),
          transition: "background 0.2s",
          color: isSorted ? "var(--color-primary)" : "white"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <span>{label}</span>
          <span style={{ fontSize: "0.75rem", opacity: isSorted ? 1 : 0.3 }}>
            {isSorted ? (sortAscending ? "▲" : "▼") : "⇅"}
          </span>
        </div>
      </th>
    );
  };

  const renderEditableCell = (
    item: InventoryItem, 
    field: keyof InventoryItem, 
    type: "text" | "number" = "text", 
    isBold = false,
    colorOverride?: string,
    rowIndex = 0
  ) => {
    const isEditing = editingCell?.itemId === item.id && editingCell?.field === field;
    const isHovered = hoveredCell?.itemId === item.id && hoveredCell?.field === field;
    const value = item[field] === undefined || item[field] === null ? "" : String(item[field]);

    // SUGERENCIA 2: Manejo de navegación por teclado (ArrowUp / ArrowDown)
    const handleNavigationKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, currentVal: string) => {
      if (e.key === "Enter") {
        handleUpdateField(item.id, field, currentVal);
      } else if (e.key === "Escape") {
        setEditingCell(null);
      } else if (e.key === "ArrowDown" && field !== "supplier" && field !== "location") {
        e.preventDefault();
        handleUpdateField(item.id, field, currentVal);
        const nextRowIndex = rowIndex + 1;
        if (nextRowIndex < items.length) {
          const nextItem = items[nextRowIndex];
          setTimeout(() => {
            setEditingCell({ itemId: nextItem.id, field });
            setEditValue(nextItem[field as keyof InventoryItem] === undefined || nextItem[field as keyof InventoryItem] === null ? "" : String(nextItem[field as keyof InventoryItem]));
          }, 100);
        }
      } else if (e.key === "ArrowUp" && field !== "supplier" && field !== "location") {
        e.preventDefault();
        handleUpdateField(item.id, field, currentVal);
        const prevRowIndex = rowIndex - 1;
        if (prevRowIndex >= 0) {
          const prevItem = items[prevRowIndex];
          setTimeout(() => {
            setEditingCell({ itemId: prevItem.id, field });
            setEditValue(prevItem[field as keyof InventoryItem] === undefined || prevItem[field as keyof InventoryItem] === null ? "" : String(prevItem[field as keyof InventoryItem]));
          }, 100);
        }
      }
    };

    if (isEditing) {
      if (field === "supplier") {
        return (
          <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
            <input
              list="suppliers-datalist"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => {
                setTimeout(() => {
                  handleUpdateField(item.id, "supplier", editValue);
                }, 200);
              }}
              onKeyDown={(e) => handleNavigationKeyDown(e, editValue)}
              autoFocus
              style={{
                width: "100%",
                padding: "6px 10px",
                borderRadius: "6px",
                border: "1px solid var(--color-primary)",
                background: "rgba(0, 0, 0, 0.85)",
                color: "white",
                fontSize: "0.85rem",
                outline: "none"
              }}
              placeholder="Proveedor..."
            />
            <datalist id="suppliers-datalist">
              <option value="Pendiente" />
              {dbSuppliers.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
        );
      }

      if (field === "location") {
        const uniqueLocations = Array.from(new Set(allItems.map(i => i.location).filter(Boolean))) as string[];
        return (
          <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
            <input
              list="locations-datalist"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => {
                setTimeout(() => {
                  handleUpdateField(item.id, "location", editValue);
                }, 200);
              }}
              onKeyDown={(e) => handleNavigationKeyDown(e, editValue)}
              autoFocus
              style={{
                width: "100%",
                padding: "6px 10px",
                borderRadius: "6px",
                border: "1px solid var(--color-primary)",
                background: "rgba(0, 0, 0, 0.85)",
                color: "white",
                fontSize: "0.85rem",
                outline: "none"
              }}
              placeholder="Ubicación..."
            />
            <datalist id="locations-datalist">
              <option value="Pendiente" />
              {uniqueLocations.map((loc) => (
                <option key={loc} value={loc} />
              ))}
            </datalist>
          </div>
        );
      }

      return (
        <input
          type={type}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => handleUpdateField(item.id, field, editValue)}
          onKeyDown={(e) => handleNavigationKeyDown(e, editValue)}
          autoFocus
          style={{
            width: type === "number" ? "80px" : "100%",
            padding: "6px 10px",
            borderRadius: "6px",
            border: "1px solid var(--color-primary)",
            background: "rgba(0, 0, 0, 0.85)",
            color: "white",
            fontSize: "0.95rem",
            fontWeight: isBold ? "bold" : "normal",
            outline: "none"
          }}
        />
      );
    }

    const displayColor = colorOverride || (isBold ? "white" : "inherit");

    return (
      <div
        onClick={async () => {
          if (currentUser?.role !== "admin") {
            const pass = window.prompt("🔒 CONTROL DE SEGURIDAD: Ingrese PIN de Administrador para editar:");
            if (!pass) return;
            const { data: admin } = await supabase
              .from("users")
              .select("*")
              .eq("pin", pass)
              .eq("role", "admin")
              .single();
            if (!admin) {
              alert("❌ PIN incorrecto o sin privilegios de administrador.");
              return;
            }
          }
          setEditingCell({ itemId: item.id, field });
          setEditValue(value);
        }}
        onMouseEnter={() => setHoveredCell({ itemId: item.id, field })}
        onMouseLeave={() => setHoveredCell(null)}
        style={{
          cursor: "pointer",
          padding: "4px 8px",
          borderRadius: "6px",
          background: isHovered ? "rgba(255,255,255,0.06)" : "transparent",
          transition: "background 0.15s, border-color 0.15s",
          border: isHovered ? "1px dashed rgba(255,255,255,0.2)" : "1px solid transparent",
          display: "inline-block",
          minWidth: "60px",
          fontWeight: isBold ? "bold" : "normal",
          color: displayColor
        }}
        title="Clic para editar"
      >
        {field === "code" ? (
          item.code ? highlightText(item.code, searchQuery) : <span style={{ opacity: 0.3 }}>-</span>
        ) : field === "name" ? (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span>{highlightText(item.name, searchQuery)}</span>
            {item.priceChanged === "up" && (
              <span style={{ color: "#ef4444", fontSize: "0.75rem", background: "rgba(239, 68, 68, 0.15)", padding: "1px 5px", borderRadius: "4px" }}>
                ⚠️ INFLACIÓN
              </span>
            )}
          </div>
        ) : field === "supplier" ? (
          <span
            onClick={(e) => {
              e.stopPropagation();
              if (item.supplier && item.supplier !== "Pendiente") {
                setSelectedSupplierFilter(item.supplier);
              } else {
                setEditingCell({ itemId: item.id, field });
                setEditValue(value);
              }
            }}
            style={{
              display: "inline-block",
              background: item.supplier && item.supplier !== "Pendiente"
                ? "rgba(16, 185, 129, 0.15)"
                : "rgba(255, 255, 255, 0.05)",
              border: item.supplier && item.supplier !== "Pendiente"
                ? "1px solid rgba(16, 185, 129, 0.4)"
                : "1px solid rgba(255, 255, 255, 0.1)",
              color: item.supplier && item.supplier !== "Pendiente"
                ? "#6ee7b7"
                : "rgba(255, 255, 255, 0.4)",
              padding: "3px 10px",
              borderRadius: "20px",
              fontSize: "0.8rem",
              fontWeight: "600",
              whiteSpace: "nowrap",
              cursor: "pointer"
            }}
            title={item.supplier && item.supplier !== "Pendiente" ? `Clic para filtrar por ${item.supplier}` : "Clic para asignar proveedor"}
          >
            {item.supplier && item.supplier !== "Pendiente"
              ? highlightText(item.supplier, searchQuery)
              : "⏳ Asignar..."}
          </span>
        ) : field === "location" ? (
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }} onClick={(e) => e.stopPropagation()}>
            <span
              onClick={() => {
                setEditingCell({ itemId: item.id, field });
                setEditValue(value);
              }}
              style={{
                background: "rgba(255, 255, 255, 0.1)",
                padding: "3px 8px",
                borderRadius: "4px",
                border: "1px solid var(--color-secondary)",
                fontSize: "0.85rem",
                cursor: "pointer"
              }}
            >
              📍 {item.location ? highlightText(item.location, searchQuery) : "PENDIENTE"}
            </span>
            {item.location && (
              <button
                onClick={() => printDualLabel(item.location!, item.name, item.code || item.id)}
                title="Imprimir Etiqueta Pasillo"
                className="btn-primary"
                style={{ padding: "2px 6px", fontSize: "0.8rem" }}
              >
                🗺️
              </button>
            )}
            <button
              onClick={() => printSingleBarcode(item.name, item.code || item.id)}
              title="Imprimir Código de Barras Individual"
              className="btn-primary"
              style={{ padding: "2px 6px", fontSize: "0.8rem", background: "transparent", border: "1px solid var(--color-secondary)", color: "var(--color-secondary)" }}
            >
              🏷️
            </button>
          </div>
        ) : field === "discount_pct" ? (
          (item.discount_pct || 0) > 0 ? (
            <span style={{ color: "var(--color-primary)", fontWeight: "bold" }}>
              🏷️ {item.discount_pct}%
            </span>
          ) : (
            <span style={{ opacity: 0.3 }}>0%</span>
          )
        ) : field === "cost" ? (
          `$${Number(item.cost).toFixed(2)}`
        ) : field === "price" ? (
          `$${Number(item.price).toFixed(2)}`
        ) : (
          value
        )}
      </div>
    );
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    fetchSuppliers();
    loadAllItems();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        if (editingCell) return;
        e.preventDefault();
        handleUndoLastChange();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lastManualChange, editingCell]);

  useEffect(() => {
    if (lastManualChange) {
      const timer = setTimeout(() => {
        setLastManualChange(null);
      }, 8000); // Ocultar notificación de deshacer tras 8 segundos
      return () => clearTimeout(timer);
    }
  }, [lastManualChange]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (mounted) {
      setPage(0);
      fetchInventory(0, debouncedSearchQuery, true, true);
    }
  }, [mounted, debouncedSearchQuery, selectedSupplierFilter, showOnlyDiscounts, sortColumn, sortAscending]);

  const loadNextPage = () => {
    if (isLoadingMore || !hasMore) return;
    const nextPage = page + 1;
    setPage(nextPage);
    fetchInventory(nextPage, debouncedSearchQuery, false, false);
  };

  useEffect(() => {
    if (showImporter || showDuplicates || showCritical) {
      loadAllItems();
    }
  }, [showImporter, showDuplicates, showCritical]);

  useEffect(() => {
    if (tab && tab !== "criticos") {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [tab]);

  // Cerrar ventanas emergentes al presionar la tecla ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showCreateModal) {
          e.preventDefault();
          setShowCreateModal(false);
          router.push("/inventario");
        } else if (tab) {
          e.preventDefault();
          clearTabParam();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tab, showCreateModal, router]);

  // Reset de scroll y paginación de duplicados al cambiar de tab
  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.scrollTop = 0;
    }
    setVisibleDuplicates(15);
  }, [tab]);

  // Verificación dinámica del indicador de scroll vertical
  useEffect(() => {
    const checkScroll = () => {
      if (panelRef.current) {
        const target = panelRef.current;
        const canScroll = target.scrollHeight > target.clientHeight;
        const isAtBottom = target.scrollTop >= target.scrollHeight - target.clientHeight - 20;
        setShowScrollIndicator(canScroll && !isAtBottom);
      }
    };
    const timer = setTimeout(checkScroll, 500);
    return () => clearTimeout(timer);
  }, [tab, items]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const canScroll = target.scrollHeight > target.clientHeight;
    const isAtBottom = target.scrollTop >= target.scrollHeight - target.clientHeight - 60;
    setShowScrollIndicator(canScroll && !isAtBottom);

    if (isAtBottom && hasMore && !isLoadingMore && !showCritical && !showDuplicates && !showAudit && !showImporter) {
      loadNextPage();
    }
  };

  // Temporizador para quitar el destello verde de producto recién combinado
  useEffect(() => {
    if (mergedItemId) {
      const timer = setTimeout(() => setMergedItemId(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [mergedItemId]);

  // SUGERENCIA 2: Búsqueda combinada inteligente (autocompletado prioritario por proveedor)
  const searchSuggestions = useMemo(() => {
    const query = debouncedSearchQuery.trim();
    if (!query) return [];
    const normQuery = normalizeString(query);
    const matches = allItems.filter(item =>
      normalizeString(item.name).includes(normQuery) ||
      (item.code && normalizeString(item.code).includes(normQuery))
    );
    if (selectedSupplierFilter) {
      matches.sort((a, b) => {
        const aBelongs = a.supplier === selectedSupplierFilter ? 1 : 0;
        const bBelongs = b.supplier === selectedSupplierFilter ? 1 : 0;
        return bBelongs - aBelongs;
      });
    }
    const unique = Array.from(new Set(matches.map(m => m.name)));
    return unique.slice(0, 10);
  }, [debouncedSearchQuery, allItems, selectedSupplierFilter]);

  const avgMargin =
    allItems.length > 0
      ? allItems.reduce((acc, i) => {
          if (!i.cost || i.cost <= 0) return acc;
          return acc + (i.price - i.cost) / i.cost;
        }, 0) / (allItems.filter((i) => i.cost > 0).length || 1)
      : 0.5;
  const criticalItems = allItems.filter((i) => i.stock <= i.minStock);

  const filteredItems = items;

  const exportPurchaseOrders = () => {
    if (criticalItems.length === 0) return alert("No hay productos críticos.");
    const wb = XLSX.utils.book_new();
    const grouped: Record<string, Record<string, string | number | undefined>[]> = {};

    criticalItems.forEach((i) => {
      const sup = i.supplier || "SIN_PROVEEDOR";
      if (!grouped[sup]) grouped[sup] = [];
      grouped[sup].push({
        CÓDIGO: i.code || i.id,
        Producto: i.name,
        "Stock Actual": i.stock,
        "Mínimo Sugerido": i.minStock,
        "Sugerencia de Compra": Math.max(i.minStock * 2 - i.stock, 0),
        "Costo Aprox": i.cost,
      });
    });

    Object.keys(grouped).forEach((supplier) => {
      const ws = XLSX.utils.json_to_sheet(grouped[supplier]);
      // Nombres de hoja tienen límite de 31 caracteres
      const safeSupplierName = supplier
        .substring(0, 31)
        .replace(/[\\\/\?\*\[\]]/g, "_");
      XLSX.utils.book_append_sheet(wb, ws, safeSupplierName);
    });

    XLSX.writeFile(
      wb,
      `Pedidos_Sugeridos_ERIKA_${new Date().toISOString().split("T")[0]}.xlsx`,
    );
  };

  const exportToExcel = () => {
    const filteredAll = getFilteredAllItems();
    const data = filteredAll.map((i) => ({
      CODIGO: i.code || "",
      PRODUCTO: i.name,
      PROVEEDOR: i.supplier || "",
      STOCK: i.stock,
      COSTO: i.cost,
      PRECIO: i.price,
      BODEGA: i.location || "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [{wch: 15}, {wch: 35}, {wch: 20}, {wch: 10}, {wch: 12}, {wch: 12}, {wch: 15}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventario_Filtrado");
    XLSX.writeFile(
      wb,
      `Exportacion_ERIKA_${new Date().toISOString().split("T")[0]}.xlsx`,
    );
  };

  const printMassivePDF = () => {
    const newWindow = window.open("", "_blank");
    if (!newWindow) return;
    let htmlContent = `
      <html>
        <head>
          <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
          <style>
            body { font-family: sans-serif; margin: 0; padding: 20px; }
            h1 { text-align: center; color: #333; margin-bottom: 40px; }
            .grid-container { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
            .label-box { border: 1px dashed #999; padding: 15px; text-align: center; page-break-inside: avoid; }
            .label-name { font-size: 0.9rem; font-weight: bold; margin-bottom: 10px; max-height: 40px; overflow: hidden; }
            .label-loc { font-size: 0.8rem; color: #666; margin-bottom: 10px; }
          </style>
        </head>
        <body>
          <h1>📦 Etiquetas de Almacén Masivas</h1>
          <div class="grid-container">
    `;
    items.forEach((item, index) => {
      if (!item.code) return;
      htmlContent += `
        <div class="label-box">
          <div class="label-name">${item.name}</div>
          <div class="label-loc">Ubicación: ${item.location || "N/A"} | Prov: ${item.supplier || "N/A"}</div>
          <svg id="barcode-${index}"></svg>
        </div>
      `;
    });
    htmlContent += `
          </div>
          <script>
            window.onload = function() {
              ${items
                .map((item, index) => {
                  if (!item.code) return "";
                  return `JsBarcode("#barcode-${index}", "${item.code}", { format: "CODE128", width: 1.5, height: 50, displayValue: true, fontSize: 14 });`;
                })
                .join("\n")}
              setTimeout(() => { window.print(); }, 1500);
            };
          </script>
        </body>
      </html>
    `;
    newWindow.document.write(htmlContent);
    newWindow.document.close();
  };

  const printDualLabel = (
    location: string,
    productName: string,
    productCode: string,
  ) => {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=ERIKA-LOC-${location}`;
    const newWindow = window.open("", "_blank");
    if (newWindow) {
      newWindow.document.write(`
        <html>
          <head>
            <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
          </head>
          <body style="text-align: center; font-family: sans-serif; padding-top: 50px;">
            <h2>Etiqueta Doble de Almacén ERIKA</h2>
            <h1>ÁREA: ${location}</h1>
            <h3 style="color: #666;">SKU/Código: ${productCode}</h3>
            <h3 style="color: #666;">Contiene: ${productName}</h3>
            <div style="display: flex; justify-content: center; align-items: center; gap: 50px; margin-top: 20px;">
              <div style="text-align: center;"><p style="font-weight: bold;">Escanear Ubicación (Bodeguero)</p><img src="${qrUrl}" alt="QR Code" style="border: 2px solid black; padding: 10px; width: 180px;" /></div>
              <div style="text-align: center;"><p style="font-weight: bold;">Escanear Venta (Caja Pistola)</p><svg id="barcode"></svg></div>
            </div>
            <p style="font-size: 1.2rem; margin-top: 50px;">Pegue esta etiqueta en el pasillo correspondiente.</p>
            <script>
              window.onload = function() { JsBarcode("#barcode", "${productCode}", { format: "CODE128", width: 2.5, height: 100, displayValue: true }); setTimeout(() => { window.print(); window.close(); }, 800); };
            </script>
          </body>
        </html>
      `);
      newWindow.document.close();
    }
  };

  const printSingleBarcode = (productName: string, productCode: string) => {
    const newWindow = window.open("", "_blank", "width=400,height=300");
    if (newWindow) {
      newWindow.document.write(`
        <html>
          <head>
            <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
            <style>
              body { margin: 0; padding: 5px; font-family: sans-serif; text-align: center; width: 50mm; }
              .name { font-size: 10px; font-weight: bold; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            </style>
          </head>
          <body>
            <div class="name">${productName}</div>
            <svg id="barcode"></svg>
            <script>
              window.onload = function() { 
                JsBarcode("#barcode", "${productCode}", { format: "CODE128", width: 1.5, height: 40, displayValue: true, fontSize: 12, margin: 0 }); 
                setTimeout(() => { window.print(); window.close(); }, 500); 
              };
            </script>
          </body>
        </html>
      `);
      newWindow.document.close();
    }
  };

  return (
    <div
      className="animate-fade-in"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        height: "100%",
        position: "relative",
      }}
    >
      <div
        className="glass-panel"
        style={{
          padding: "20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "15px",
        }}
      >
        <div>
          <h3 style={{ margin: 0, color: "var(--color-primary)" }}>
            Módulo de Almacén (Supabase Cloud ☁️)
          </h3>
          <p style={{ fontSize: "0.85rem", opacity: 0.7 }}>
            Margen de Utilidad Promedio Actual: {(avgMargin * 100).toFixed(1)}%
          </p>
        </div>
        <div
          style={{
            display: "flex",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          <button
            className="btn-primary"
            onClick={() => router.push(showCritical ? "/inventario" : "/inventario?tab=criticos")}
            style={{
              background: showCritical ? "#ef4444" : "transparent",
              border: "1px solid #ef4444",
              color: showCritical ? "white" : "#ef4444",
            }}
          >
            🚨 {criticalItems.length} Críticos
          </button>
          <button
            className="btn-primary"
            onClick={() => router.push("/inventario?tab=clientes")}
            style={{
              background: "transparent",
              border: "1px solid var(--color-primary)",
              color: "var(--color-primary)",
            }}
          >
            👤 Clientes
          </button>
            <button
              onClick={() => router.push("/inventario?tab=recibir")}
              className="btn-primary"
              style={{
                background: "#10b981",
                padding: "10px 15px",
                borderRadius: "5px",
                cursor: "pointer",
                border: "none",
                color: "white",
              }}
            >
              📦 Recibir Mercancía
            </button>
          <button
            className="btn-primary"
            onClick={() => router.push("/inventario?tab=proveedores")}
            style={{
              background: "transparent",
              border: "1px solid var(--color-accent)",
              color: "var(--color-accent)",
            }}
          >
            🏭 Proveedores
          </button>
          <button
            className="btn-primary"
            onClick={() => router.push("/inventario?tab=cuentas")}
            style={{
              background: "var(--glass-bg)",
              border: "1px solid #f59e0b",
              color: "#f59e0b",
            }}
          >
            💳 Cuentas por Pagar
          </button>
          <button
            className="btn-primary"
            onClick={() => router.push("/inventario?tab=gastos")}
            style={{
              background: "var(--glass-bg)",
              border: "1px solid #ef4444",
              color: "#ef4444",
            }}
          >
            📉 Gastos y Mermas
          </button>
          <button
            className="btn-primary"
            onClick={() => router.push("/inventario?tab=apartados")}
            style={{
              background: "transparent",
              border: "1px solid #3b82f6",
              color: "#3b82f6",
            }}
          >
            📦 Apartados
          </button>
          <button
            className="btn-primary"
            onClick={printMassivePDF}
            style={{
              background: "transparent",
              border: "1px solid var(--color-primary)",
              color: "var(--color-primary)",
            }}
          >
            🖨️ Etiquetas (Masivo)
          </button>
          <button
            className="btn-primary"
            onClick={exportToExcel}
            style={{
              background: "var(--glass-bg)",
              border: "1px solid #10b981",
              color: "#10b981",
            }}
          >
            📥 Exportar
          </button>
          {undoStack && undoStack.length > 0 && (
            <button
              className="btn-primary"
              onClick={handleUndo}
              style={{
                background: "#ef4444",
                border: "none",
                color: "white",
                boxShadow: "0 0 10px rgba(239, 68, 68, 0.5)",
              }}
              title={`Tienes ${undoStack.length} importaciones que puedes deshacer`}
            >
              ↩️ Deshacer Importación ({undoStack.length})
            </button>
          )}
          <button
            className="btn-primary"
            onClick={() => router.push(showDuplicates ? "/inventario" : "/inventario?tab=duplicados")}
            style={{
              background: showDuplicates ? "#eab308" : "transparent",
              border: "1px solid #eab308",
              color: showDuplicates ? "black" : "#eab308",
            }}
          >
            👯 Posibles Duplicados
          </button>
          <button
            className="btn-primary"
            onClick={() => router.push("/inventario?tab=carga")}
            style={{
              background:
                "linear-gradient(135deg, var(--color-secondary), #059669)",
            }}
          >
            ⚡ Carga Inteligente
          </button>
          {isAdmin && (
            <button
              className="btn-primary"
              onClick={() => router.push("/inventario?tab=arqueo")}
              style={{
                background: "linear-gradient(135deg, #a855f7, #f97316)",
                border: "none",
                color: "white",
                boxShadow: "0 0 10px rgba(168, 85, 247, 0.4)",
              }}
            >
              📋 Auditoría y Arqueos
            </button>
          )}
        </div>
      </div>

      {!showCritical && !showDuplicates && !showAudit && !showImporter && (
        <div
          className="glass-panel animate-fade-in"
          style={{
            padding: "12px 20px",
            display: "flex",
            alignItems: "center",
            gap: "15px",
            background: "var(--glass-bg)",
            border: "1px solid var(--glass-border)",
            borderRadius: "16px",
            boxShadow: "var(--shadow-glow)",
          }}
        >
          <div style={{ position: "relative", flex: 1 }}>
            <span
              style={{
                position: "absolute",
                left: "15px",
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: "1.1rem",
                opacity: 0.6,
                pointerEvents: "none",
              }}
            >
              🔍
            </span>
            <input
              type="text"
              placeholder={getSearchPlaceholder()}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              list="search-suggestions-datalist"
              style={{
                width: "100%",
                padding: "12px 20px 12px 45px",
                borderRadius: "10px",
                border: "1px solid var(--glass-border)",
                background: "rgba(0, 0, 0, 0.25)",
                color: "white",
                fontSize: "0.95rem",
                outline: "none",
                transition: "border-color 0.2s, box-shadow 0.2s",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "var(--color-primary)";
                e.currentTarget.style.boxShadow = "0 0 10px rgba(244, 63, 94, 0.15)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "var(--glass-border)";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
            <datalist id="search-suggestions-datalist">
              {searchSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                style={{
                  position: "absolute",
                  right: "15px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "transparent",
                  border: "none",
                  color: "rgba(255, 255, 255, 0.5)",
                  cursor: "pointer",
                  fontSize: "1rem",
                  padding: "5px",
                  transition: "color 0.2s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = "white"}
                onMouseLeave={(e) => e.currentTarget.style.color = "rgba(255, 255, 255, 0.5)"}
              >
                ✖
              </button>
            )}
          </div>

          {/* BOTÓN FILTRO DE DESCUENTOS */}
          <button
            onClick={() => setShowOnlyDiscounts(!showOnlyDiscounts)}
            style={{
              padding: "12px 15px",
              borderRadius: "10px",
              border: showOnlyDiscounts ? "1px solid var(--color-primary)" : "1px solid var(--glass-border)",
              background: showOnlyDiscounts ? "rgba(244, 63, 94, 0.15)" : "rgba(0, 0, 0, 0.3)",
              color: showOnlyDiscounts ? "var(--color-primary)" : "white",
              fontSize: "0.9rem",
              fontWeight: "bold",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              transition: "all 0.2s"
            }}
          >
            🏷️ {showOnlyDiscounts ? "Ver Todos" : "Sólo con Descuento"}
          </button>

          {/* FILTRO DE PROVEEDOR */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <select
              value={selectedSupplierFilter}
              onChange={(e) => setSelectedSupplierFilter(e.target.value)}
              style={{
                padding: "12px 15px",
                borderRadius: "10px",
                border: "1px solid var(--glass-border)",
                background: "rgba(0, 0, 0, 0.3)",
                color: selectedSupplierFilter ? "#6ee7b7" : "white",
                fontSize: "0.9rem",
                outline: "none",
                cursor: "pointer",
                fontWeight: selectedSupplierFilter ? "600" : "normal",
                transition: "border-color 0.2s"
              }}
            >
              <option value="" style={{ background: "#18181b" }}>🏢 Todos los Proveedores</option>
              {dbSuppliers.map((sup) => (
                <option key={sup} value={sup} style={{ background: "#18181b" }}>
                  {sup}
                </option>
              ))}
            </select>
            {selectedSupplierFilter && (
              <button
                onClick={() => setSelectedSupplierFilter("")}
                title="Limpiar filtro de proveedor"
                style={{
                  background: "rgba(239, 68, 68, 0.15)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  color: "#ef4444",
                  padding: "11px 13px",
                  borderRadius: "10px",
                  cursor: "pointer",
                  fontSize: "0.9rem",
                  transition: "background 0.2s"
                }}
              >
                ✖
              </button>
            )}
          </div>
          <div style={{ fontSize: "0.85rem", opacity: 0.8, minWidth: "180px", textAlign: "right" }}>
            {totalCount !== null ? (
              <>Total productos: <strong style={{ color: "var(--color-secondary)" }}>{totalCount}</strong></>
            ) : (
              <>Cargando...</>
            )}
          </div>
        </div>
      )}

      <div
        ref={panelRef}
        onScroll={handleScroll}
        className="glass-panel"
        style={{ flex: 1, overflowY: "auto", overflowX: "auto", padding: "0", maxHeight: "calc(100vh - 240px)" }}
      >
        {isLoading ? (
          <div
            style={{
              padding: "40px",
              textAlign: "center",
              color: "var(--color-secondary)",
            }}
          >
            ☁️ Sincronizando datos con Supabase...
          </div>
        ) : showCritical ? (
          <div style={{ padding: "20px" }}>
            <div className="flex-between" style={{ marginBottom: "20px" }}>
              <h2 style={{ color: "#ef4444" }}>
                Alertas de Reabastecimiento (Stock Crítico)
              </h2>
              <button
                className="btn-primary"
                onClick={exportPurchaseOrders}
                style={{ background: "#10b981" }}
              >
                📥 Descargar Pedidos en Excel
              </button>
            </div>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                textAlign: "left",
              }}
            >
              <thead
                style={{
                  background: "rgba(239, 68, 68, 0.2)",
                  borderBottom: "1px solid #ef4444",
                }}
              >
                <tr>
                  <th style={{ padding: "15px" }}>Producto</th>
                  <th style={{ padding: "15px" }}>Proveedor</th>
                  <th style={{ padding: "15px", color: "#ef4444" }}>
                    Stock Actual
                  </th>
                  <th style={{ padding: "15px" }}>Stock Mínimo</th>
                  <th
                    style={{ padding: "15px", color: "var(--color-secondary)" }}
                  >
                    Comprar Aprox.
                  </th>
                </tr>
              </thead>
              <tbody>
                {criticalItems.map((item) => (
                  <tr
                    key={item.id}
                    style={{ borderBottom: "1px solid var(--glass-border)" }}
                  >
                    <td style={{ padding: "15px", fontWeight: "bold" }}>
                      {item.code ? `[${item.code}] ` : ""}
                      {item.name}
                    </td>
                    <td style={{ padding: "15px" }}>
                      {item.supplier || "N/A"}
                    </td>
                    <td
                      style={{
                        padding: "15px",
                        fontWeight: "bold",
                        color: "#ef4444",
                        fontSize: "1.2rem",
                      }}
                    >
                      {item.stock}
                    </td>
                    <td
                      style={{
                        padding: "15px",
                        color: "rgba(255,255,255,0.7)",
                      }}
                    >
                      {item.minStock}
                    </td>
                    <td
                      style={{
                        padding: "15px",
                        fontWeight: "bold",
                        color: "var(--color-secondary)",
                      }}
                    >
                      {Math.max(item.minStock * 2 - item.stock, 0)}
                    </td>
                  </tr>
                ))}
                {criticalItems.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      style={{
                        padding: "40px",
                        textAlign: "center",
                        color: "var(--color-secondary)",
                      }}
                    >
                      ✅ Todo el inventario está sano. No hay alertas críticas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : showDuplicates ? (
          <div style={{ padding: "20px" }}>
            <h2 style={{ color: "#eab308", marginBottom: "10px" }}>
              👯 Posibles Productos Duplicados
            </h2>
            <p style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.9rem", marginBottom: "25px" }}>
              Aquí se muestran grupos de productos con códigos de barra idénticos o nombres muy similares. 
              Puedes <strong>eliminar</strong> los registros redundantes o <strong>combinar sus inventarios</strong> (sumar existencias en un producto principal y desechar los otros).
            </p>

            {(() => {
              const groups = getDuplicateGroups();
              if (groups.length === 0) {
                return (
                  <div style={{ padding: "40px", textAlign: "center", color: "var(--color-secondary)", background: "rgba(255,255,255,0.02)", borderRadius: "10px", border: "1px dashed var(--glass-border)" }}>
                    🎉 ¡No se detectaron productos duplicados en tu catálogo activo!
                  </div>
                );
              }

              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "25px" }}>
                  {groups.slice(0, visibleDuplicates).map((group, gIdx) => (
                    <div 
                      key={gIdx} 
                      className="glass-panel" 
                      style={{ 
                        border: "1px solid rgba(234, 179, 8, 0.3)", 
                        borderRadius: "10px", 
                        padding: "15px",
                        background: "rgba(0,0,0,0.2)"
                      }}
                    >
                      <div className="flex-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "10px", marginBottom: "15px" }}>
                        <div>
                          <span style={{ fontSize: "0.75rem", background: "rgba(234, 179, 8, 0.2)", color: "#eab308", padding: "3px 8px", borderRadius: "5px", fontWeight: "bold", marginRight: "10px" }}>
                            Duplicado por {group.type}
                          </span>
                          <strong style={{ fontSize: "1.1rem", color: "white" }}>"{group.key}"</strong>
                        </div>
                        <span style={{ color: "var(--color-secondary)", fontSize: "0.85rem" }}>
                          ({group.products.length} coincidencias)
                        </span>
                      </div>

                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                        <thead>
                          <tr style={{ color: "rgba(255,255,255,0.6)", borderBottom: "1px solid rgba(255,255,255,0.1)", textAlign: "left" }}>
                            <th style={{ padding: "8px" }}>Código</th>
                            <th style={{ padding: "8px" }}>Nombre</th>
                            <th style={{ padding: "8px" }}>Bodega / Ubicación</th>
                            <th style={{ padding: "8px" }}>Proveedor</th>
                            <th style={{ padding: "8px", textAlign: "right" }}>Stock</th>
                            <th style={{ padding: "8px", textAlign: "right" }}>Costo</th>
                            <th style={{ padding: "8px", textAlign: "right" }}>Precio</th>
                            <th style={{ padding: "8px", textAlign: "center" }}>Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.products.map((p) => (
                            <tr key={p.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                              <td style={{ padding: "8px", fontFamily: "monospace" }}>{p.code || "N/A"}</td>
                              <td style={{ padding: "8px", fontWeight: "bold" }}>{p.name}</td>
                              <td style={{ padding: "8px" }}>{p.location || "N/A"}</td>
                              <td style={{ padding: "8px" }}>{p.supplier || "N/A"}</td>
                              <td style={{ padding: "8px", textAlign: "right", fontWeight: "bold", color: p.stock <= 0 ? "#ef4444" : "white" }}>{p.stock}</td>
                              <td style={{ padding: "8px", textAlign: "right" }}>${p.cost.toFixed(2)}</td>
                              <td style={{ padding: "8px", textAlign: "right" }}>${p.price.toFixed(2)}</td>
                              <td style={{ padding: "8px", textAlign: "center" }}>
                                <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                                  <button 
                                    onClick={() => handleMergeDuplicates(p, group.products)}
                                    title="Definir este como principal y combinar el stock de los demás en este"
                                    className="btn-primary"
                                    style={{ padding: "4px 8px", background: "rgba(16, 185, 129, 0.2)", border: "1px solid #10b981", color: "#10b981", fontSize: "0.75rem" }}
                                  >
                                    🔄 Combinar aquí
                                  </button>
                                  <button 
                                    onClick={() => handleDeleteProduct(p.id, p.name)}
                                    title="Eliminar este duplicado"
                                    className="btn-primary"
                                    style={{ padding: "4px 8px", background: "rgba(239, 68, 68, 0.2)", border: "1px solid #ef4444", color: "#ef4444", fontSize: "0.75rem" }}
                                  >
                                    🗑️ Eliminar
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}

                  {groups.length > visibleDuplicates && (
                    <button
                      onClick={() => setVisibleDuplicates((prev) => prev + 15)}
                      className="btn-primary"
                      style={{
                        margin: "10px auto 30px auto",
                        display: "block",
                        background: "rgba(234, 179, 8, 0.15)",
                        border: "1px solid #eab308",
                        color: "#eab308",
                        padding: "10px 20px"
                      }}
                    >
                      👇 Cargar más posibles duplicados ({groups.length - visibleDuplicates} restantes)
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              textAlign: "left",
            }}
          >
            <thead
              style={{
                background: "rgba(255,255,255,0.05)",
                borderBottom: "1px solid var(--glass-border)",
              }}
            >
              <tr>
                {renderHeader("Código", "code")}
                {renderHeader("Producto", "name")}
                {renderHeader("Proveedor", "supplier")}
                {renderHeader("Ubicación y Códigos", "location")}
                {renderHeader("Stock", "stock")}
                {renderHeader("Costo Prov.", "cost")}
                {renderHeader("Precio Venta", "price")}
                {renderHeader("Margen (%)", "margin")}
                <th style={{ padding: "15px", textAlign: "center" }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item, rowIndex) => {
                const isRecentlyMerged = mergedItemId === item.id;
                const rowBg =
                  isRecentlyMerged
                    ? "rgba(16, 185, 129, 0.35)"
                    : item.priceChanged === "up"
                      ? "rgba(239, 68, 68, 0.15)"
                      : item.autoPriced
                        ? "rgba(16, 185, 129, 0.1)"
                        : "transparent";
                return (
                  <tr
                    key={item.id}
                    style={{
                      borderBottom: "1px solid var(--glass-border)",
                      background: rowBg,
                      transition: isRecentlyMerged ? "none" : "background 1s ease",
                    }}
                  >
                    <td
                      style={{
                        padding: "15px",
                        fontWeight: "bold",
                        color: "var(--color-primary)",
                      }}
                    >
                      {renderEditableCell(item, "code", "text", true, "var(--color-primary)", rowIndex)}
                    </td>
                    <td style={{ padding: "15px", fontWeight: "bold" }}>
                      {renderEditableCell(item, "name", "text", true, undefined, rowIndex)}
                    </td>
                    <td style={{ padding: "15px" }}>
                      {renderEditableCell(item, "supplier", "text", false, undefined, rowIndex)}
                    </td>
                    <td style={{ padding: "15px" }}>
                      {renderEditableCell(item, "location", "text", false, undefined, rowIndex)}
                    </td>
                    <td
                      style={{
                        padding: "15px",
                        fontWeight: "bold",
                        color:
                          item.stock <= item.minStock ? "#ef4444" : "inherit",
                      }}
                    >
                      {renderEditableCell(item, "stock", "number", true, item.stock <= item.minStock ? "#ef4444" : undefined, rowIndex)}
                    </td>
                    <td style={{ padding: "15px" }}>
                      {renderEditableCell(item, "cost", "number", false, undefined, rowIndex)}
                    </td>
                    <td style={{ padding: "15px" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        {renderEditableCell(item, "price", "number", true, item.autoPriced ? "var(--color-secondary)" : "white", rowIndex)}
                      </div>
                    </td>
                    <td style={{ padding: "15px", color: "var(--color-secondary)", fontWeight: "bold" }}>
                      {item.cost > 0 ? ((item.price - item.cost) / item.cost * 100).toFixed(1) + "%" : "N/A"}
                    </td>
                    <td style={{ padding: "15px", textAlign: "center" }}>
                      <button
                        onClick={() => handleDeleteProduct(item.id, item.name)}
                        title="Eliminar Producto"
                        style={{
                          background: "transparent",
                          border: "1px solid #ef4444",
                          color: "#ef4444",
                          padding: "6px 12px",
                          borderRadius: "6px",
                          cursor: "pointer",
                          fontWeight: "bold",
                          fontSize: "0.85rem",
                        }}
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredItems.length === 0 && !isLoading && (
                <tr>
                  <td
                    colSpan={8}
                    style={{
                      padding: "40px",
                      textAlign: "center",
                      color: "rgba(255, 255, 255, 0.5)",
                    }}
                  >
                    🔍 No se encontraron productos que coincidan con la búsqueda.
                  </td>
                </tr>
              )}
              {hasMore && (
                <tr style={{ background: "transparent" }}>
                  <td colSpan={8} style={{ padding: "15px", textAlign: "center" }}>
                    <button
                      className="btn-primary"
                      onClick={() => loadNextPage()}
                      disabled={isLoadingMore}
                      style={{
                        padding: "6px 15px",
                        fontSize: "0.85rem",
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid var(--glass-border)",
                        color: "white",
                        borderRadius: "6px",
                        cursor: "pointer"
                      }}
                    >
                      {isLoadingMore ? "⏳ Cargando..." : "Mostrar más productos ⬇️"}
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {mounted && showImporter && createPortal(
        <SmartImporter
          avgMargin={avgMargin}
          existingItems={allItems}
          onClose={clearTabParam}
          onImport={async (newProducts, importOption, accumulateStock) => {
            setIsLoading(true);
            // Limpiar caché de columnas faltantes para evitar que errores de sesiones
            // anteriores eliminen campos críticos del INSERT de forma silenciosa.
            clearMissingColumnsCache();
            try {
              let updatedCount = 0;
              let newCount = 0;
              let skippedCount = 0;
              let rescuedCount = 0;
              const undoLog: any[] = [];

              // Cargar todos los artículos de la BD (incluyendo eliminados) para comparar correctamente y evitar colisiones de códigos únicos
              let dbAllItems: any[] = [];
              let from = 0;
              const limit = 1000;
              let hasMoreData = true;
              while (hasMoreData) {
                const { data, error } = await supabase
                  .from("inventory")
                  .select("*")
                  .range(from, from + limit - 1);
                if (error) throw error;
                if (data && data.length > 0) {
                  dbAllItems = [...dbAllItems, ...data];
                  if (data.length < limit) hasMoreData = false;
                  else from += limit;
                } else {
                  hasMoreData = false;
                }
              }

              const processedCodes = new Set(dbAllItems.map(i => (i.code || "").trim().toUpperCase()));

              const inserts: any[] = [];
              const updates: any[] = [];

              for (const p of newProducts) {
                // Usar el código/nombre ORIGINAL del Excel para todo el proceso de import.
                // importedCode e importedName son los valores intactos del archivo,
                // nunca reemplazados por fuzzy match del preview.
                const pCode = (p.importedCode || p.code || "").trim();
                const pName = p.importedName || p.name || "";

                if (importOption === "nuevo") {
                  let uniqueCode = pCode || `SKU-${Date.now()}`;
                  let suffix = 1;
                  const baseCodeUpper = uniqueCode.toUpperCase();
                  if (baseCodeUpper && processedCodes.has(baseCodeUpper)) {
                    let candidate = `${uniqueCode}-${suffix}`;
                    while (processedCodes.has(candidate.toUpperCase())) {
                      suffix++;
                      candidate = `${uniqueCode}-${suffix}`;
                    }
                    uniqueCode = candidate;
                  }
                  processedCodes.add(uniqueCode.toUpperCase());

                  undoLog.push({ isNew: true, code: uniqueCode });
                  inserts.push({
                    code: uniqueCode,
                    name: p.name,
                    cost: p.cost,
                    price: p.price,
                    stock: p.stock,
                    minStock: p.minStock || 5,
                    location: p.location || "Pendiente",
                    supplier: p.supplier || "Pendiente",
                    autoPriced: p.autoPriced !== undefined ? p.autoPriced : true,
                  });
                  newCount++;
                } else {
                  const existing = dbAllItems.find(
                    (i) =>
                      (i.code && pCode && i.code.trim().toUpperCase() === pCode.toUpperCase()) ||
                      (normalizeString(i.name) === normalizeString(pName))
                  );

                  if (existing) {
                    if (importOption === "complementar") {
                      skippedCount++;
                      continue;
                    }

                    // Option: sustituir
                    undoLog.push({ 
                      id: existing.id, 
                      cost: existing.cost, 
                      price: existing.price, 
                      stock: existing.stock, 
                      supplier: existing.supplier, 
                      location: existing.location, 
                      priceChanged: existing.priceChanged,
                      deleted: existing.deleted || false,
                      deleted_at: existing.deleted_at || null
                    });
                    
                    const inflationFlag = p.cost > existing.cost ? "up" : null;
                    const newStock = accumulateStock ? (existing.stock || 0) + p.stock : p.stock;
                    
                    if ((existing.stock || 0) <= existing.minStock && newStock > existing.minStock) {
                      rescuedCount++;
                    }

                    updates.push({
                      id: existing.id,
                      code: p.code || existing.code,
                      name: p.name,
                      cost: p.cost,
                      price: p.price,
                      stock: newStock,
                      supplier: p.supplier || existing.supplier,
                      location: p.location || existing.location,
                      priceChanged: inflationFlag,
                      deleted: false,
                      deleted_at: null,
                      autoPriced: p.autoPriced !== undefined ? p.autoPriced : existing.autoPriced,
                    });
                    updatedCount++;
                  } else {
                    let uniqueCode = pCode || `SKU-${Date.now()}`;
                    let suffix = 1;
                    const baseCodeUpper = uniqueCode.toUpperCase();
                    if (baseCodeUpper && processedCodes.has(baseCodeUpper)) {
                      let candidate = `${uniqueCode}-${suffix}`;
                      while (processedCodes.has(candidate.toUpperCase())) {
                        suffix++;
                        candidate = `${uniqueCode}-${suffix}`;
                      }
                      uniqueCode = candidate;
                    }
                    processedCodes.add(uniqueCode.toUpperCase());
                    
                    undoLog.push({ isNew: true, code: uniqueCode });
                    inserts.push({
                      code: uniqueCode,
                      name: p.name,
                      cost: p.cost,
                      price: p.price,
                      stock: p.stock,
                      minStock: p.minStock || 5,
                      location: p.location || "Pendiente",
                      supplier: p.supplier || "Pendiente",
                      autoPriced: p.autoPriced !== undefined ? p.autoPriced : true,
                    });
                    newCount++;
                  }
                }
              }

              // Ejecutar inserciones en lotes de 50 para que un código duplicado
              // no anule toda la importación.
              const BATCH_SIZE = 50;
              let failedInserts = 0;
              if (inserts.length > 0) {
                for (let batchStart = 0; batchStart < inserts.length; batchStart += BATCH_SIZE) {
                  const batch = inserts.slice(batchStart, batchStart + BATCH_SIZE);
                  const { error: insertError } = await supabase.from("inventory").insert(batch);
                  if (insertError) {
                    // Intento de recuperación: insertar uno por uno para salvar los que sí pasan
                    for (const item of batch) {
                      const { error: singleErr } = await supabase.from("inventory").insert([item]);
                      if (singleErr) {
                        console.warn(`[Import] No se pudo insertar "${item.name}" (${item.code}): ${singleErr.message}`);
                        failedInserts++;
                        newCount--; // descontar del total reportado
                      }
                    }
                  }
                }
              }

              // Ejecutar actualizaciones en lote
              if (updates.length > 0) {
                const { error: updateError } = await supabase.from("inventory").upsert(updates);
                if (updateError) throw updateError;
              }

              if (undoLog.length > 0) {
                setUndoStack(prev => {
                  const newStack = [...(prev || []), undoLog].slice(-5);
                  if (typeof window !== "undefined") {
                    localStorage.setItem("erika_undo_stack", JSON.stringify(newStack));
                  }
                  return newStack;
                });
              }
              await fetchInventory(0, debouncedSearchQuery, true, true);
              await loadAllItems();
              setPage(0);
              
              let rescueMsg = "";
              if (rescuedCount > 0) rescueMsg = `\n🎉 ¡Excelente! Se han rescatado ${rescuedCount} productos de su estado CRÍTICO.`;
              
              let alertMsg = `✅ ERIKA Procesó la Importación en la NUBE.\n\n`;
              if (importOption === "nuevo") {
                alertMsg += `🆕 Nuevos: ${newCount} productos agregados.`;
              } else if (importOption === "complementar") {
                alertMsg += `🆕 Nuevos: ${newCount} productos agregados.\n⏭️ Omitidos por ya existir: ${skippedCount} productos.`;
              } else {
                alertMsg += `📊 Actualizados: ${updatedCount} productos.\n🆕 Nuevos: ${newCount} productos.${rescueMsg}`;
              }
              if (failedInserts > 0) {
                alertMsg += `\n\n⚠️ ${failedInserts} artículo(s) no pudieron guardarse (código duplicado u otro error). Revisa la consola para ver cuáles.`;
              }
              alert(alertMsg);
            } catch (err: any) {
              console.error("Error en importación:", err);
              alert(`❌ Error al importar artículos: ${err.message || err}`);
            } finally {
              setIsLoading(false);
            }
          }}
        />,
        document.body
      )}

      {mounted && showAudit && createPortal(
        <AuditModule 
          onClose={() => router.push("/inventario")}
          inventory={items}
        />,
        document.body
      )}
      
        {mounted && showCreateModal && createPortal(
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000, backdropFilter: "blur(5px)" }}>
            <div className="glass-panel" style={{ width: "400px", padding: "20px", display: "flex", flexDirection: "column", gap: "10px", position: "relative" }}>
              <button onClick={() => { setShowCreateModal(false); router.push("/inventario"); }} style={{ position: "absolute", top: "10px", right: "10px", background: "transparent", border: "none", color: "white", fontSize: "1.2rem", cursor: "pointer" }}>✖</button>
              <h2 style={{ color: "var(--color-primary)", marginBottom: "10px" }}>➕ Crear Nuevo Producto</h2>
              
              <label style={{ fontSize: "0.85rem" }}>Nombre del Producto</label>
              <input type="text" value={newProductName} onChange={e => setNewProductName(e.target.value)} style={{ padding: "10px", borderRadius: "5px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />
              
              <label style={{ fontSize: "0.85rem" }}>Código (Opcional, se autogenera)</label>
              <input type="text" value={newProductCode} onChange={e => setNewProductCode(e.target.value)} style={{ padding: "10px", borderRadius: "5px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />
              
              <div style={{ display: "flex", gap: "10px" }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                  <label style={{ fontSize: "0.85rem" }}>Costo ($)</label>
                  <input type="number" value={newProductCost} onChange={e => setNewProductCost(e.target.value)} style={{ padding: "10px", borderRadius: "5px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                  <label style={{ fontSize: "0.85rem" }}>Precio Venta ($)</label>
                  <input type="number" value={newProductPrice} onChange={e => setNewProductPrice(e.target.value)} style={{ padding: "10px", borderRadius: "5px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />
                </div>
              </div>

              <label style={{ fontSize: "0.85rem" }}>Stock Inicial</label>
              <input type="number" value={newProductStock} onChange={e => setNewProductStock(e.target.value)} style={{ padding: "10px", borderRadius: "5px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />

              <button onClick={handleCreateProduct} className="btn-primary" style={{ marginTop: "15px" }}>Guardar Producto</button>
            </div>
          </div>,
          document.body
        )}
      {mounted && showClientModal && createPortal(
        <ClientCaptureModal onClose={clearTabParam} onSuccess={() => {}} />,
        document.body
      )}
      
      {mounted && showSuppliersModal && createPortal(
        <SuppliersManagerModal onClose={clearTabParam} />,
        document.body
      )}
      
      {mounted && showAccountsPayableModal && createPortal(
        <AccountsPayableModal onClose={clearTabParam} />,
        document.body
      )}
      
      {mounted && showLossesModal && createPortal(
        <LossesManagerModal onClose={clearTabParam} />,
        document.body
      )}

      {mounted && showLayaways && createPortal(
        <LayawayModal show={showLayaways} onClose={clearTabParam} />,
        document.body
      )}
      
      {mounted && showInboundModal && createPortal(
        <InboundModal 
          onClose={clearTabParam} 
          onSuccess={async () => {
            await fetchInventory(0, debouncedSearchQuery, true, true);
            await loadAllItems();
            setPage(0);
            clearTabParam();
          }} 
        />,
        document.body
      )}
      {mounted && showScrollIndicator && (
        <>
          <style>{`
            @keyframes bounceScroll {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-6px); }
            }
          `}</style>
          <div 
            onClick={() => {
              if (panelRef.current) {
                panelRef.current.scrollTo({
                  top: panelRef.current.scrollTop + 250,
                  behavior: "smooth"
                });
              }
            }}
            style={{
              position: "absolute",
              bottom: "20px",
              right: "20px",
              background: "rgba(234, 179, 8, 0.95)",
              color: "black",
              padding: "10px 16px",
              borderRadius: "50px",
              fontSize: "0.85rem",
              fontWeight: "bold",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              cursor: "pointer",
              boxShadow: "0 4px 15px rgba(0,0,0,0.5)",
              animation: "bounceScroll 2s infinite",
              zIndex: 9999,
              transition: "opacity 0.3s, background 0.2s"
            }}
          >
            <span>👇 Desplazar hacia abajo</span>
          </div>
        </>
      )}
      {lastManualChange && (
        <div
          style={{
            position: "fixed",
            bottom: "30px",
            left: "30px",
            background: "#18181b",
            border: "1px solid var(--color-primary)",
            boxShadow: "0 4px 15px rgba(244, 63, 94, 0.25)",
            padding: "12px 20px",
            borderRadius: "10px",
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            gap: "15px",
            color: "white",
            fontSize: "0.9rem",
          }}
        >
          <span>✏️ Cambio realizado.</span>
          <button
            onClick={handleUndoLastChange}
            className="btn-primary"
            style={{
              background: "var(--color-primary)",
              border: "none",
              padding: "5px 12px",
              borderRadius: "5px",
              color: "black",
              cursor: "pointer",
              fontWeight: "bold"
            }}
          >
            ↩️ Deshacer (Ctrl+Z)
          </button>
          <button
            onClick={() => setLastManualChange(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "rgba(255,255,255,0.4)",
              cursor: "pointer",
              fontSize: "1rem"
            }}
          >
            ✖
          </button>
        </div>
      )}
      {isReverting && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0, 0, 0, 0.55)",
          backdropFilter: "blur(4px)",
          zIndex: 999999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: "15px",
          color: "white"
        }}>
          <div style={{
            border: "4px solid rgba(255,255,255,0.1)",
            width: "40px",
            height: "40px",
            borderRadius: "50%",
            borderLeftColor: "var(--color-primary)",
            animation: "erika-spin 1s linear infinite"
          }}></div>
          <span style={{ fontWeight: "bold", fontSize: "1.1rem", textShadow: "0 2px 10px rgba(0,0,0,0.5)" }}>
            🔮 Revirtiendo cambio en la base de datos...
          </span>
          <style dangerouslySetInnerHTML={{__html: `
            @keyframes erika-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          `}} />
        </div>
      )}
    </div>
  );
}
