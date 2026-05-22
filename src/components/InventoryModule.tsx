"use client";
import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import SmartImporter from "./SmartImporter";
import { supabase } from "../lib/supabaseClient";
import ClientCaptureModal from "./ClientCaptureModal";
import SuppliersManagerModal from "./SuppliersManagerModal";
import AccountsPayableModal from "./AccountsPayableModal";
import LossesManagerModal from "./LossesManagerModal";
import LayawayModal from "./LayawayModal";

interface InventoryItem {
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
}

export default function InventoryModule() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [importHistory, setImportHistory] = useState<InventoryItem[][]>([]);
  const [showImporter, setShowImporter] = useState(false);
  const [showCritical, setShowCritical] = useState(false);
  const [showClientModal, setShowClientModal] = useState(false);
  const [showSuppliersModal, setShowSuppliersModal] = useState(false);
  const [showAccountsPayableModal, setShowAccountsPayableModal] = useState(false);
  const [showLossesModal, setShowLossesModal] = useState(false);
  const [showLayaways, setShowLayaways] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const fetchInventory = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("inventory")
      .select("*")
      .order("name", { ascending: true });
    if (data) setItems(data);
    if (error) console.error(error);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchInventory();
  }, []);

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
    const grouped: Record<string, any[]> = {};

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
              window.onload = function() { JsBarcode("#barcode", "${productCode}", { format: "CODE128", width: 2.5, height: 100, displayValue: true }); setTimeout(() => { window.print(); }, 800); };
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
      <div className="glass-panel flex-between" style={{ padding: "20px" }}>
        <div>
          <h3 style={{ margin: 0, color: "var(--color-primary)" }}>
            Módulo de Almacén (Supabase Cloud ☁️)
          </h3>
          <p style={{ fontSize: "0.85rem", opacity: 0.7 }}>
            Margen de Utilidad Promedio Actual: {(avgMargin * 100).toFixed(1)}%
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            className="btn-primary"
            onClick={() => setShowCritical(!showCritical)}
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
            onClick={() => setShowClientModal(true)}
            style={{
              background: "transparent",
              border: "1px solid var(--color-primary)",
            }}
          >
            👤 Clientes
          </button>
          <button
            className="btn-primary"
            onClick={() => setShowSuppliersModal(true)}
            style={{
              background: "transparent",
              border: "1px solid var(--color-accent)",
            }}
          >
            🏭 Proveedores
          </button>
          <button
            className="btn-primary"
            onClick={() => setShowAccountsPayableModal(true)}
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
            onClick={() => setShowLossesModal(true)}
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
            onClick={() => setShowLayaways(true)}
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
          <button
            className="btn-primary"
            onClick={() => setShowImporter(true)}
            style={{
              background:
                "linear-gradient(135deg, var(--color-secondary), #059669)",
            }}
          >
            ⚡ Carga Inteligente
          </button>
        </div>
      </div>

      <div
        className="glass-panel"
        style={{ flex: 1, overflowY: "auto", padding: "0" }}
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
                            title="Imprimir Etiqueta"
                            className="btn-primary"
                            style={{ padding: "4px 8px", fontSize: "0.9rem" }}
                          >
                            🖨️
                          </button>
                        )}
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showImporter && (
        <SmartImporter
          avgMargin={avgMargin}
          onClose={() => setShowImporter(false)}
          onImport={async (newProducts) => {
            setIsLoading(true);
            let updatedCount = 0;
            let newCount = 0;

            for (const p of newProducts) {
              const existing = items.find(
                (i) => i.code === p.code && i.code !== "",
              );
              if (existing) {
                const inflationFlag = p.cost > existing.cost ? "up" : null;
                await supabase
                  .from("inventory")
                  .update({
                    cost: p.cost,
                    price: p.price,
                    stock: existing.stock + p.stock,
                    supplier: p.supplier || existing.supplier,
                    priceChanged: inflationFlag,
                  })
                  .eq("id", existing.id);
                updatedCount++;
              } else {
                await supabase.from("inventory").insert({
                  code: p.code,
                  name: p.name,
                  cost: p.cost,
                  price: p.price,
                  stock: p.stock,
                  minStock: p.minStock,
                  location: p.location,
                  supplier: p.supplier,
                  autoPriced: true,
                });
                newCount++;
              }
            }
            await fetchInventory();
            alert(
              `✅ ERIKA Procesó la Importación en la NUBE.\n\n📊 Actualizados: ${updatedCount} productos.\n🆕 Nuevos: ${newCount} productos.`,
            );
          }}
        />
      )}
      
      {showClientModal && (
        <ClientCaptureModal onClose={() => setShowClientModal(false)} onSuccess={() => {}} />
      )}
      
      {showSuppliersModal && (
        <SuppliersManagerModal onClose={() => setShowSuppliersModal(false)} />
      )}
      
      {showAccountsPayableModal && (
        <AccountsPayableModal onClose={() => setShowAccountsPayableModal(false)} />
      )}
      
      {showLossesModal && (
        <LossesManagerModal onClose={() => setShowLossesModal(false)} />
      )}

      {showLayaways && (
        <LayawayModal show={showLayaways} onClose={() => setShowLayaways(false)} />
      )}
    </div>
  );
}
