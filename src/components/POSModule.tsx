"use client";
import { useState } from "react";
import SearchModule, { Product } from "./SearchModule";

interface CartItem extends Product {
  cartId: string;
  quantity: number;
  unit: string;
}

interface SaleTab {
  id: string;
  name: string;
  items: CartItem[];
}

export default function POSModule() {
  const [tabs, setTabs] = useState<SaleTab[]>([{ id: "1", name: "Venta 1", items: [] }]);
  const [activeTabId, setActiveTabId] = useState("1");
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

  const handleSelectProduct = (product: Product) => {
    setTabs(prev => prev.map(tab => {
      if (tab.id === activeTabId) {
        const existing = tab.items.find(i => i.id === product.id);
        if (existing) {
          return { ...tab, items: tab.items.map(i => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i) };
        }
        return { ...tab, items: [...tab.items, { ...product, cartId: Date.now().toString(), quantity: 1, unit: "pieza" }] };
      }
      return tab;
    }));

    // Simulación de Big Data / Asociación Market Basket
    if (product.name.toLowerCase().includes("martillo")) {
      setAiSuggestion("💡 Sugerencia IA: El cliente que lleva un Martillo normalmente lleva Clavos. ¿Ofrecer 'Clavo para concreto 2 pulgadas' (10% desc)?");
    } else {
      setAiSuggestion(null);
    }
  };

  const createTab = () => {
    const newId = (tabs.length + 1).toString();
    setTabs([...tabs, { id: newId, name: `Venta ${newId}`, items: [] }]);
    setActiveTabId(newId);
  };

  const total = activeTab.items.reduce((acc, item) => acc + (item.price * item.quantity), 0);

  return (
    <div className="pos-container animate-fade-in" style={{ display: 'flex', gap: '20px', minHeight: '600px' }}>
      
      {/* Columna Izquierda: Buscador */}
      <div style={{ flex: '1', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div className="glass-panel" style={{ flex: 1 }}>
          <h2 style={{ marginBottom: '20px' }}>Buscador de Inventario</h2>
          <SearchModule onSelect={handleSelectProduct} />
        </div>
        
        {aiSuggestion && (
          <div className="glass-panel animate-fade-in" style={{ borderLeft: '4px solid var(--color-secondary)' }}>
            <h3 style={{ color: 'var(--color-secondary)', marginBottom: '10px' }}>🧠 Asesor ERIKA</h3>
            <p>{aiSuggestion}</p>
            <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
              <button className="btn-primary" style={{ padding: '8px 16px', fontSize: '0.9rem' }}>Agregar Oferta</button>
              <button className="btn-primary" style={{ padding: '8px 16px', fontSize: '0.9rem', background: 'transparent', border: '1px solid white' }} onClick={() => setAiSuggestion(null)}>Ignorar</button>
            </div>
          </div>
        )}
      </div>

      {/* Columna Derecha: Ticket / Carrito Multiple */}
      <div className="glass-panel" style={{ width: '450px', display: 'flex', flexDirection: 'column' }}>
        
        <div style={{ display: 'flex', gap: '5px', overflowX: 'auto', marginBottom: '15px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>
          {tabs.map(tab => (
            <button 
              key={tab.id} 
              onClick={() => setActiveTabId(tab.id)}
              style={{
                padding: '8px 16px',
                background: tab.id === activeTabId ? 'var(--color-primary)' : 'rgba(255,255,255,0.05)',
                color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold'
              }}
            >
              {tab.name} <span style={{ opacity: 0.7, fontSize: '0.8rem' }}>({tab.items.length})</span>
            </button>
          ))}
          <button onClick={createTab} style={{ padding: '8px 16px', background: 'transparent', color: 'var(--color-secondary)', border: '1px dashed var(--color-secondary)', borderRadius: '8px', cursor: 'pointer' }}>+ Nueva</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {activeTab.items.length === 0 ? (
            <div className="flex-center" style={{ height: '100%', color: 'rgba(255,255,255,0.3)', flex: 1 }}>El ticket está vacío. Busca un producto para comenzar.</div>
          ) : (
            activeTab.items.map(item => (
              <div key={item.cartId} style={{ display: 'flex', justifyContent: 'space-between', padding: '15px', background: 'rgba(0,0,0,0.4)', borderRadius: '8px', borderLeft: '2px solid var(--color-primary)' }}>
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>{item.name}</div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <input 
                      type="number" 
                      defaultValue={item.quantity} 
                      style={{ width: '60px', padding: '5px', borderRadius: '4px', background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none', textAlign: 'center' }} 
                    />
                    <select defaultValue={item.unit} style={{ padding: '5px', borderRadius: '4px', background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none' }}>
                      <option value="pieza">pz</option>
                      <option value="kilo">kg</option>
                      <option value="litro">L</option>
                      <option value="caja">caja</option>
                      <option value="metro">m</option>
                    </select>
                  </div>
                </div>
                <div style={{ fontWeight: 'bold', fontSize: '1.1rem', display: 'flex', alignItems: 'center' }}>
                  ${(item.price * item.quantity).toFixed(2)}
                </div>
              </div>
            ))
          )}
        </div>

        <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--glass-border)' }}>
          <div className="flex-between" style={{ fontSize: '1.2rem', marginBottom: '15px' }}>
            <span>Subtotal:</span>
            <span style={{ color: 'rgba(255,255,255,0.7)' }}>${(total / 1.16).toFixed(2)}</span>
          </div>
          <div className="flex-between" style={{ fontSize: '1.2rem', marginBottom: '15px' }}>
            <span>IVA (16%):</span>
            <span style={{ color: 'rgba(255,255,255,0.7)' }}>${(total - (total / 1.16)).toFixed(2)}</span>
          </div>
          <div className="flex-between" style={{ fontSize: '1.5rem', marginBottom: '20px' }}>
            <span>Total Neto:</span>
            <span style={{ color: 'var(--color-secondary)', fontWeight: 'bold' }}>${total.toFixed(2)}</span>
          </div>
          <button className="btn-primary" style={{ width: '100%', padding: '16px', fontSize: '1.2rem' }}>💰 Cobrar y Generar Ticket</button>
        </div>
      </div>
    </div>
  );
}
