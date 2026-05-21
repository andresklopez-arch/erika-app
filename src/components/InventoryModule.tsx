"use client";
import { useState } from "react";
import * as XLSX from "xlsx";
import SmartImporter from "./SmartImporter";

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
}

const INVENTORY_DB: InventoryItem[] = [
  { id: "1", code: "TRU-16", name: "Martillo Truper 16oz", price: 120.5, cost: 80.0, stock: 12, minStock: 5, salesIndex: 85, supplier: "Truper", location: "A-1" },
  { id: "2", code: "CLA-02", name: "Clavo para concreto 2 pulgadas", price: 45.0, cost: 25.0, stock: 15, minStock: 50, salesIndex: 90, supplier: "Aceros México", location: "B-6" },
  { id: "3", code: "COM-19", name: "Pintura Blanca 19L Comex", price: 1250.0, cost: 900.0, stock: 4, minStock: 5, salesIndex: 40, supplier: "Comex", location: "P-12" },
  { id: "4", code: "TOL-50", name: "Cemento Tolteca 50kg", price: 210.0, cost: 180.0, stock: 200, minStock: 100, salesIndex: 95, supplier: "Cemex", location: "AAA-100" },
  { id: "5", code: "CAB-12", name: "Cable Calibre 12 AWG (m)", price: 15.0, cost: 8.0, stock: 1500, minStock: 500, salesIndex: 80, supplier: "Condumex", location: "E-4" },
];

export default function InventoryModule() {
  const [items, setItems] = useState<InventoryItem[]>(INVENTORY_DB);
  const [importHistory, setImportHistory] = useState<InventoryItem[][]>([]);
  const [showImporter, setShowImporter] = useState(false);

  const avgMargin = items.reduce((acc, i) => acc + ((i.price - i.cost) / i.cost), 0) / items.length;

  const exportToExcel = () => {
    const data = items.map(i => ({
      "CÓDIGO": i.code || i.id,
      "Producto": i.name,
      "Ubicación (Pasillo)": i.location || "Sin Asignar",
      "Proveedor": i.supplier || "No Asignado",
      "Costo Compra": i.cost,
      "Precio Venta": i.price,
      "Stock": i.stock,
      "Automático": i.autoPriced ? "SÍ" : "NO"
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventario_Filtrado");
    XLSX.writeFile(wb, `Exportacion_ERIKA_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const printQRLocation = (location: string, productName: string) => {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=ERIKA-LOC-${location}`;
    const newWindow = window.open("", "_blank");
    if (newWindow) {
      newWindow.document.write(`
        <html>
          <body style="text-align: center; font-family: sans-serif; padding-top: 50px;">
            <h2>Etiqueta de Almacén ERIKA</h2>
            <h1>ÁREA: ${location}</h1>
            <h3 style="color: #666;">Contiene: ${productName}</h3>
            <img src="${qrUrl}" alt="QR Code" style="margin: 20px; border: 2px solid black; padding: 10px;" />
            <p style="font-size: 1.2rem;">Pegue esta etiqueta en el pasillo correspondiente.</p>
            <script>
              setTimeout(() => { window.print(); }, 500);
            </script>
          </body>
        </html>
      `);
      newWindow.document.close();
    }
  };

  const undoLastImport = () => {
    if (importHistory.length === 0) return;
    const previousState = importHistory[importHistory.length - 1];
    setItems(previousState);
    setImportHistory(importHistory.slice(0, -1));
    alert("🔙 Importación deshecha. La base de datos regresó a su estado anterior.");
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%' }}>
      
      <div className="glass-panel flex-between" style={{ padding: '20px' }}>
        <div>
          <h3 style={{ margin: 0, color: 'var(--color-primary)' }}>Módulo de Almacén e Inventario Físico</h3>
          <p style={{ fontSize: '0.85rem', opacity: 0.7 }}>Margen de Utilidad Promedio Actual: {(avgMargin * 100).toFixed(1)}%</p>
        </div>
        
        <div style={{ display: 'flex', gap: '10px' }}>
          {importHistory.length > 0 && (
            <button className="btn-primary" onClick={undoLastImport} style={{ background: 'transparent', border: '1px solid var(--color-primary)' }}>↩️ Deshacer Importación</button>
          )}
          <button className="btn-primary" onClick={exportToExcel} style={{ background: 'var(--glass-bg)', border: '1px solid #10b981', color: '#10b981' }}>📥 Exportar Catálogo</button>
          <button className="btn-primary" onClick={() => setShowImporter(true)} style={{ background: 'linear-gradient(135deg, var(--color-secondary), #059669)' }}>⚡ Carga Inteligente</button>
        </div>
      </div>

      <div className="glass-panel" style={{ flex: 1, overflowY: 'auto', padding: '0' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead style={{ background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid var(--glass-border)' }}>
            <tr>
              <th style={{ padding: '15px' }}>Código</th>
              <th style={{ padding: '15px' }}>Producto</th>
              <th style={{ padding: '15px' }}>Ubicación Física</th>
              <th style={{ padding: '15px' }}>Stock</th>
              <th style={{ padding: '15px' }}>Costo Prov.</th>
              <th style={{ padding: '15px' }}>Precio Venta</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              return (
                <tr key={item.id} style={{ borderBottom: '1px solid var(--glass-border)', background: item.autoPriced ? 'rgba(16, 185, 129, 0.1)' : 'transparent' }}>
                  <td style={{ padding: '15px', fontWeight: 'bold', color: 'var(--color-primary)' }}>{item.code || '-'}</td>
                  <td style={{ padding: '15px', fontWeight: 'bold' }}>
                    {item.name}
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-secondary)' }}>Prov: {item.supplier || 'N/A'}</div>
                  </td>
                  <td style={{ padding: '15px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ background: 'rgba(255,255,255,0.1)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--color-secondary)' }}>
                        📍 {item.location || 'PENDIENTE'}
                      </span>
                      {item.location && (
                        <button 
                          onClick={() => printQRLocation(item.location!, item.name)} 
                          title="Imprimir Código QR de Área"
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}
                        >
                          🖨️
                        </button>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '15px', fontWeight: 'bold' }}>{item.stock}</td>
                  <td style={{ padding: '15px' }}>${item.cost.toFixed(2)}</td>
                  <td style={{ padding: '15px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ color: item.autoPriced ? 'var(--color-secondary)' : 'white', fontWeight: 'bold' }}>${item.price.toFixed(2)}</span>
                      {item.autoPriced && <span title="Precio Asignado Automáticamente" style={{ fontSize: '0.8rem', background: 'var(--color-secondary)', color: 'black', padding: '2px 6px', borderRadius: '4px' }}>AUTO</span>}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showImporter && (
        <SmartImporter 
          avgMargin={avgMargin}
          onClose={() => setShowImporter(false)} 
          onImport={(newProducts) => {
            setImportHistory([...importHistory, items]);
            setItems([...newProducts, ...items]);
            alert(`✅ ERIKA enrutó los productos hacia tu Almacén.\nSe generaron ubicaciones a partir de C-1 en adelante. Dirígete a inventario a imprimir las etiquetas QR.`);
          }} 
        />
      )}
    </div>
  );
}
