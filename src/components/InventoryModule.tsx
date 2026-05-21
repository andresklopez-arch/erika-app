"use client";
import { useState } from "react";
import SmartImporter from "./SmartImporter";

interface InventoryItem {
  id: string;
  name: string;
  price: number;
  stock: number;
  minStock: number;
  cost: number;
  salesIndex: number;
}

const INVENTORY_DB: InventoryItem[] = [
  { id: "1", name: "Martillo Truper 16oz", price: 120.5, cost: 80.0, stock: 12, minStock: 5, salesIndex: 85 },
  { id: "2", name: "Clavo para concreto 2 pulgadas", price: 45.0, cost: 25.0, stock: 15, minStock: 50, salesIndex: 90 },
  { id: "3", name: "Pintura Blanca 19L Comex", price: 1250.0, cost: 900.0, stock: 4, minStock: 5, salesIndex: 40 },
  { id: "4", name: "Cemento Tolteca 50kg", price: 210.0, cost: 180.0, stock: 200, minStock: 100, salesIndex: 95 },
  { id: "5", name: "Cable Calibre 12 AWG (m)", price: 15.0, cost: 8.0, stock: 1500, minStock: 500, salesIndex: 80 },
];

export default function InventoryModule() {
  const [items, setItems] = useState<InventoryItem[]>(INVENTORY_DB);
  const [bulkAdjustment, setBulkAdjustment] = useState<number>(0);
  const [adjustmentType, setAdjustmentType] = useState<"percentage" | "fixed">("percentage");
  const [showImporter, setShowImporter] = useState(false);

  const applyBulkPriceChange = () => {
    if (bulkAdjustment === 0) return;
    setItems(items.map(i => {
      const newPrice = adjustmentType === "percentage" 
        ? i.price * (1 + (bulkAdjustment / 100))
        : i.price + bulkAdjustment;
      return { ...i, price: Math.max(0.5, newPrice) };
    }));
    alert(`✅ Precios actualizados de forma masiva en la base de datos.`);
    setBulkAdjustment(0);
  };

  const generateWhatsappOrder = (item: InventoryItem) => {
    const qtyToOrder = Math.max((item.minStock * 2) - item.stock, item.minStock); 
    const msg = `Hola, soy ERIKA (Sistema). Necesito hacer un pedido automático de ${qtyToOrder} unidades de *${item.name}*. Mi último precio registrado fue $${item.cost}. ¿Me confirmas existencias y envío?`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%' }}>
      
      <div className="glass-panel flex-between" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Ajuste de Precios Masivo</h3>
          <input 
            type="number" 
            value={bulkAdjustment}
            onChange={(e) => setBulkAdjustment(Number(e.target.value))}
            style={{ width: '80px', padding: '8px', borderRadius: '8px', background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)' }}
          />
          <select 
            value={adjustmentType}
            onChange={(e) => setAdjustmentType(e.target.value as any)}
            style={{ padding: '8px', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'white', border: '1px solid rgba(255,255,255,0.2)' }}
          >
            <option value="percentage">% Porcentaje</option>
            <option value="fixed">$ Fijo</option>
          </select>
          <button className="btn-primary" onClick={applyBulkPriceChange} style={{ padding: '8px 16px', fontSize: '0.9rem' }}>Aplicar a todo</button>
        </div>
        
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn-primary" onClick={() => setShowImporter(true)} style={{ background: 'linear-gradient(135deg, var(--color-secondary), #059669)' }}>⚡ Carga Inteligente</button>
          <button className="btn-primary" style={{ background: 'var(--glass-bg)', border: '1px solid var(--color-primary)' }}>+ Nuevo Producto</button>
        </div>
      </div>

      <div className="glass-panel" style={{ flex: 1, overflowY: 'auto', padding: '0' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead style={{ background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid var(--glass-border)' }}>
            <tr>
              <th style={{ padding: '15px' }}>Producto</th>
              <th style={{ padding: '15px' }}>Stock Actual</th>
              <th style={{ padding: '15px' }}>Mínimo Óptimo</th>
              <th style={{ padding: '15px' }}>Costo Compra</th>
              <th style={{ padding: '15px' }}>Precio Venta</th>
              <th style={{ padding: '15px' }}>Desplazamiento</th>
              <th style={{ padding: '15px' }}>Acciones IA</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const isLowStock = item.stock <= item.minStock;
              return (
                <tr key={item.id} style={{ borderBottom: '1px solid var(--glass-border)', background: isLowStock ? 'rgba(244, 63, 94, 0.1)' : 'transparent' }}>
                  <td style={{ padding: '15px', fontWeight: 'bold' }}>{item.name}</td>
                  <td style={{ padding: '15px', color: isLowStock ? 'var(--color-primary)' : 'white', fontWeight: 'bold' }}>
                    {item.stock} {isLowStock && '⚠️'}
                  </td>
                  <td style={{ padding: '15px', opacity: 0.7 }}>{item.minStock}</td>
                  <td style={{ padding: '15px' }}>${item.cost.toFixed(2)}</td>
                  <td style={{ padding: '15px', color: 'var(--color-secondary)', fontWeight: 'bold' }}>${item.price.toFixed(2)}</td>
                  <td style={{ padding: '15px' }}>
                    <div style={{ width: '100%', maxWidth: '100px', background: 'rgba(255,255,255,0.1)', height: '8px', borderRadius: '4px' }}>
                      <div style={{ width: `${item.salesIndex}%`, background: item.salesIndex > 80 ? 'var(--color-secondary)' : 'var(--color-accent)', height: '100%', borderRadius: '4px' }}></div>
                    </div>
                  </td>
                  <td style={{ padding: '15px' }}>
                    {isLowStock ? (
                      <button onClick={() => generateWhatsappOrder(item)} style={{ background: '#25D366', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        📱 Pedir por WA
                      </button>
                    ) : (
                      <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.4)' }}>Stock Óptimo</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showImporter && (
        <SmartImporter 
          onClose={() => setShowImporter(false)} 
          onImport={(newProducts) => {
            setItems([...newProducts, ...items]);
            alert(`✅ ERIKA procesó tu archivo y agregó ${newProducts.length} productos a tu inventario exitosamente.`);
          }} 
        />
      )}
    </div>
  );
}
