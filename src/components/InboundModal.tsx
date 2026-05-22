"use client";
import React, { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

interface InventoryItem {
  id: string;
  name: string;
  stock: number;
  cost: number;
  price: number;
}

interface InboundEntry {
  item: InventoryItem;
  qtyReceived: number;
  newCost: number;
}

interface InboundModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function InboundModal({ onClose, onSuccess }: InboundModalProps) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [entries, setEntries] = useState<InboundEntry[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchItems();
  }, []);

  const fetchItems = async () => {
    const { data } = await supabase.from("inventory").select("id, name, stock, cost, price");
    if (data) setItems(data);
  };

  const filteredItems = searchTerm.length > 1 
    ? items.filter(i => i.name.toLowerCase().includes(searchTerm.toLowerCase())).slice(0, 5)
    : [];

  const handleSelect = (item: InventoryItem) => {
    setSelectedItem(item);
    setSearchTerm(item.name);
    setCost(item.cost.toString());
    setQty("");
  };

  const handleAddEntry = () => {
    if (!selectedItem) return alert("Selecciona un producto");
    const q = parseFloat(qty);
    const c = parseFloat(cost);
    if (isNaN(q) || q <= 0) return alert("Cantidad inválida");
    if (isNaN(c) || c < 0) return alert("Costo inválido");

    setEntries([...entries, { item: selectedItem, qtyReceived: q, newCost: c }]);
    setSelectedItem(null);
    setSearchTerm("");
    setQty("");
    setCost("");
  };

  const handleRemoveEntry = (index: number) => {
    setEntries(entries.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (entries.length === 0) return alert("No hay artículos en la lista de recepción");
    setIsSaving(true);
    
    let hasError = false;
    for (const entry of entries) {
      const newStock = entry.item.stock + entry.qtyReceived;
      const { error } = await supabase
        .from("inventory")
        .update({ stock: newStock, cost: entry.newCost })
        .eq("id", entry.item.id);
      if (error) {
         console.error(error);
         hasError = true;
      }
    }

    setIsSaving(false);
    if (hasError) {
      alert("Hubo un error al actualizar algunos productos. Revisa la consola.");
    } else {
      alert(`✅ Se recibieron ${entries.length} productos correctamente.`);
      onSuccess();
    }
  };

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: "rgba(0,0,0,0.8)", display: "flex",
      alignItems: "center", justifyContent: "center",
      zIndex: 10000, backdropFilter: "blur(5px)"
    }}>
      <div className="glass-panel animate-fade-in" style={{ width: "800px", maxWidth: "95%", maxHeight: "90vh", display: "flex", flexDirection: "column", position: "relative" }}>
        <button onClick={onClose} style={{ position: "absolute", top: "15px", right: "15px", background: "transparent", border: "none", color: "white", fontSize: "1.5rem", cursor: "pointer" }}>✖</button>
        <h2 style={{ color: "#10b981", marginBottom: "20px" }}>📦 Recepción de Mercancía</h2>
        
        <div style={{ display: "flex", gap: "10px", marginBottom: "15px", alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 2, position: "relative" }}>
             <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "5px" }}>Buscar Producto</label>
             <input type="text" placeholder="Escribe para buscar..." value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setSelectedItem(null); }} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />
             {searchTerm.length > 1 && !selectedItem && filteredItems.length > 0 && (
                <ul style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#1e293b", border: "1px solid var(--glass-border)", borderRadius: "6px", listStyle: "none", padding: 0, margin: 0, zIndex: 10, maxHeight: "150px", overflowY: "auto" }}>
                  {filteredItems.map(i => (
                    <li key={i.id} onClick={() => handleSelect(i)} style={{ padding: "10px", borderBottom: "1px solid rgba(255,255,255,0.1)", cursor: "pointer" }}>
                      {i.name} (Stock: {i.stock})
                    </li>
                  ))}
                </ul>
             )}
          </div>
          <div style={{ flex: 1 }}>
             <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "5px" }}>Cant. Recibida</label>
             <input type="number" placeholder="Ej. 10" value={qty} onChange={e => setQty(e.target.value)} disabled={!selectedItem} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />
          </div>
          <div style={{ flex: 1 }}>
             <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "5px" }}>Costo Unitario ($)</label>
             <input type="number" placeholder="Costo Facturado" value={cost} onChange={e => setCost(e.target.value)} disabled={!selectedItem} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />
          </div>
          <button className="btn-primary" onClick={handleAddEntry} disabled={!selectedItem} style={{ padding: "10px 15px", background: "#3b82f6", border: "none" }}>➕ Añadir</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", border: "1px solid var(--glass-border)", borderRadius: "8px", padding: "10px", background: "rgba(0,0,0,0.2)" }}>
           <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                 <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", textAlign: "left" }}>
                   <th style={{ padding: "8px" }}>Producto</th>
                   <th style={{ padding: "8px" }}>Cant.</th>
                   <th style={{ padding: "8px" }}>Nuevo Costo</th>
                   <th style={{ padding: "8px", textAlign: "right" }}>Total</th>
                   <th></th>
                 </tr>
              </thead>
              <tbody>
                 {entries.length === 0 && <tr><td colSpan={5} style={{ padding: "20px", textAlign: "center", color: "rgba(255,255,255,0.5)" }}>No hay artículos en la recepción</td></tr>}
                 {entries.map((entry, idx) => (
                   <tr key={idx} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                     <td style={{ padding: "8px" }}>
                       {entry.item.name}<br/>
                       <small style={{ color: "rgba(255,255,255,0.5)" }}>Stock previo: {entry.item.stock}</small>
                     </td>
                     <td style={{ padding: "8px", color: "#10b981", fontWeight: "bold" }}>+{entry.qtyReceived}</td>
                     <td style={{ padding: "8px" }}>${entry.newCost.toFixed(2)}</td>
                     <td style={{ padding: "8px", textAlign: "right" }}>${(entry.qtyReceived * entry.newCost).toFixed(2)}</td>
                     <td style={{ padding: "8px", textAlign: "right" }}>
                        <button onClick={() => handleRemoveEntry(idx)} style={{ background: "transparent", color: "#ef4444", border: "none", cursor: "pointer" }}>✖</button>
                     </td>
                   </tr>
                 ))}
              </tbody>
           </table>
        </div>

        <div style={{ marginTop: "20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
           <div>
              <strong style={{ fontSize: "1.2rem", color: "#10b981" }}>Total Factura: ${entries.reduce((sum, e) => sum + (e.qtyReceived * e.newCost), 0).toFixed(2)}</strong>
           </div>
           <button className="btn-primary" onClick={handleSave} disabled={entries.length === 0 || isSaving} style={{ background: "#10b981", border: "none", padding: "12px 24px", fontSize: "1.1rem" }}>
             {isSaving ? "Guardando..." : "✅ Confirmar Entrada al Inventario"}
           </button>
        </div>
      </div>
    </div>
  );
}
