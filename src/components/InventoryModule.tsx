"use client";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useSearchParams, useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import SmartImporter from "./SmartImporter";
import { supabase } from "../lib/supabaseClient";
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
    await fetchInventory(true);
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
      autoPriced: true
    });
    
    alert("✅ Producto creado con éxito");
    setShowCreateModal(false);
    fetchInventory();
    router.push("/inventario");
  };

  const clearTabParam = () => {
    window.location.href = "/inventario";
  };

  const fetchInventory = async (showLoading = false) => {
    if (showLoading) setIsLoading(true);
    let { data, error } = await supabase
      .from("inventory")
      .select("*")
      .not("deleted", "eq", true)
      .order("name", { ascending: true });
    
    if (data) {
      setItems(data);
    }
    if (error) console.error(error);
    setIsLoading(false);
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
      fetchInventory();
    }
  };

  const getDuplicateGroups = () => {
    const codeGroups: { [key: string]: InventoryItem[] } = {};
    const nameGroups: { [key: string]: InventoryItem[] } = {};

    items.forEach((item) => {
      if (item.code && item.code.trim() !== "") {
        const cleanCode = item.code.trim().toUpperCase();
        if (!codeGroups[cleanCode]) codeGroups[cleanCode] = [];
        codeGroups[cleanCode].push(item);
      }

      const cleanName = normalizeString(item.name);
      if (cleanName !== "") {
        if (!nameGroups[cleanName]) nameGroups[cleanName] = [];
        nameGroups[cleanName].push(item);
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

      alert("✅ Productos combinados con éxito.");
      await fetchInventory(true);
    } catch (err: any) {
      console.error("Error al combinar duplicados:", err);
      alert(`❌ Error al combinar productos: ${err.message || err}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    fetchInventory(false);
  }, []);

  const loadAllItemsForImport = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("inventory")
      .select("*")
      .order("name", { ascending: true });
    if (data) {
      setAllItems(data);
    }
    if (error) console.error(error);
    setIsLoading(false);
  };

  useEffect(() => {
    if (showImporter) {
      loadAllItemsForImport();
    }
  }, [showImporter]);

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

  const avgMargin =
    items.length > 0
      ? items.reduce((acc, i) => {
          if (!i.cost || i.cost <= 0) return acc;
          return acc + (i.price - i.cost) / i.cost;
        }, 0) / (items.filter((i) => i.cost > 0).length || 1)
      : 0.5;
  const criticalItems = items.filter((i) => i.stock <= i.minStock);

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
    const data = items.map((i) => ({
      CÓDIGO: i.code || i.id,
      Producto: i.name,
      "Ubicación (Pasillo)": i.location || "Sin Asignar",
      Proveedor: i.supplier || "No Asignado",
      "Costo Compra": i.cost,
      "Precio Venta": i.price,
      Stock: i.stock,
      Automático: i.autoPriced ? "SÍ" : "NO",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
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

      <div
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
          <div style={{ padding: "20px", maxHeight: "calc(100vh - 280px)", overflowY: "auto" }}>
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
          <div style={{ padding: "20px", maxHeight: "calc(100vh - 280px)", overflowY: "auto" }}>
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
                  {groups.map((group, gIdx) => (
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
                <th style={{ padding: "15px" }}>Código</th>
                <th style={{ padding: "15px" }}>Producto</th>
                <th style={{ padding: "15px" }}>Ubicación y Códigos</th>
                <th style={{ padding: "15px" }}>Stock</th>
                <th style={{ padding: "15px" }}>Costo Prov.</th>
                <th style={{ padding: "15px" }}>Precio Venta</th>
                <th style={{ padding: "15px", color: "var(--color-secondary)" }}>Margen (%)</th>
                <th style={{ padding: "15px", textAlign: "center" }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const rowBg =
                  item.priceChanged === "up"
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
                    }}
                  >
                    <td
                      style={{
                        padding: "15px",
                        fontWeight: "bold",
                        color: "var(--color-primary)",
                      }}
                    >
                      {item.code || "-"}
                    </td>
                    <td style={{ padding: "15px", fontWeight: "bold" }}>
                      {item.name}
                      {item.priceChanged === "up" && (
                        <span
                          style={{
                            marginLeft: "10px",
                            color: "#ef4444",
                            fontSize: "0.8rem",
                          }}
                        >
                          ⚠️ INFLACIÓN
                        </span>
                      )}
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "var(--color-secondary)",
                        }}
                      >
                        Prov: {item.supplier || "N/A"}
                      </div>
                    </td>
                    <td style={{ padding: "15px" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <span
                          style={{
                            background: "rgba(255,255,255,0.1)",
                            padding: "4px 8px",
                            borderRadius: "4px",
                            border: "1px solid var(--color-secondary)",
                          }}
                        >
                          📍 {item.location || "PENDIENTE"}
                        </span>
                        {item.location && (
                          <button
                            onClick={() =>
                              printDualLabel(
                                item.location!,
                                item.name,
                                item.code || item.id,
                              )
                            }
                            title="Imprimir Etiqueta Pasillo"
                            className="btn-primary"
                            style={{ padding: "4px 8px", fontSize: "0.9rem" }}
                          >
                            🗺️
                          </button>
                        )}
                        <button
                            onClick={() =>
                              printSingleBarcode(
                                item.name,
                                item.code || item.id,
                              )
                            }
                            title="Imprimir Código de Barras Individual"
                            className="btn-primary"
                            style={{ padding: "4px 8px", fontSize: "0.9rem", background: "transparent", border: "1px solid var(--color-secondary)", color: "var(--color-secondary)" }}
                          >
                            🏷️
                        </button>
                      </div>
                    </td>
                    <td
                      style={{
                        padding: "15px",
                        fontWeight: "bold",
                        color:
                          item.stock <= item.minStock ? "#ef4444" : "inherit",
                      }}
                    >
                      {item.stock}
                    </td>
                    <td style={{ padding: "15px" }}>
                      ${Number(item.cost).toFixed(2)}
                    </td>
                    <td style={{ padding: "15px" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <span
                          style={{
                            color: item.autoPriced
                              ? "var(--color-secondary)"
                              : "white",
                            fontWeight: "bold",
                          }}
                        >
                          ${Number(item.price).toFixed(2)}
                        </span>
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
            </tbody>
          </table>
        )}
      </div>

      {mounted && showImporter && createPortal(
        <SmartImporter
          avgMargin={avgMargin}
          existingItems={allItems}
          onClose={clearTabParam}
          onImport={async (newProducts, importOption) => {
            setIsLoading(true);
            try {
              let updatedCount = 0;
              let newCount = 0;
              let skippedCount = 0;
              let rescuedCount = 0;
              const undoLog: any[] = [];
              const processedCodes = new Set(allItems.map(i => (i.code || "").trim().toUpperCase()));

              const inserts: any[] = [];
              const updates: any[] = [];

              for (const p of newProducts) {
                if (importOption === "nuevo") {
                  let uniqueCode = p.code || `SKU-${Date.now()}`;
                  let suffix = 1;
                  const baseCodeUpper = (p.code || "").trim().toUpperCase();
                  if (baseCodeUpper && processedCodes.has(baseCodeUpper)) {
                    let candidate = `${p.code}-${suffix}`;
                    while (processedCodes.has(candidate.toUpperCase())) {
                      suffix++;
                      candidate = `${p.code}-${suffix}`;
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
                    autoPriced: true,
                  });
                  newCount++;
                } else {
                  const existing = allItems.find(
                    (i) =>
                      (i.code && p.code && i.code.trim().toUpperCase() === p.code.trim().toUpperCase() && p.code !== "") ||
                      (normalizeString(i.name) === normalizeString(p.name))
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
                    const newStock = p.stock;
                    
                    if ((existing.stock || 0) <= existing.minStock && newStock > existing.minStock) {
                      rescuedCount++;
                    }

                    updates.push({
                      id: existing.id,
                      cost: p.cost,
                      price: p.price,
                      stock: newStock,
                      supplier: p.supplier || existing.supplier,
                      location: p.location || existing.location,
                      priceChanged: inflationFlag,
                      deleted: false,
                      deleted_at: null,
                    });
                    updatedCount++;
                  } else {
                    let uniqueCode = p.code || `SKU-${Date.now()}`;
                    let suffix = 1;
                    const baseCodeUpper = (p.code || "").trim().toUpperCase();
                    if (baseCodeUpper && processedCodes.has(baseCodeUpper)) {
                      let candidate = `${p.code}-${suffix}`;
                      while (processedCodes.has(candidate.toUpperCase())) {
                        suffix++;
                        candidate = `${p.code}-${suffix}`;
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
                      autoPriced: true,
                    });
                    newCount++;
                  }
                }
              }

              // Ejecutar inserciones en lote
              if (inserts.length > 0) {
                const { error: insertError } = await supabase.from("inventory").insert(inserts);
                if (insertError) throw insertError;
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
              await fetchInventory(true);
              
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
            await fetchInventory(true);
            clearTabParam();
          }} 
        />,
        document.body
      )}
    </div>
  );
}
