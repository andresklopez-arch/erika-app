"use client";
import { useState } from "react";

interface POSItem {
  id: string;
  name: string;
  price: number;
  qty: number;
  unit: string;
}

interface Ticket {
  id: number;
  items: POSItem[];
}

export default function POSModule() {
  const [tickets, setTickets] = useState<Ticket[]>([{ id: 1, items: [] }]);
  const [activeTicketId, setActiveTicketId] = useState(1);
  const [nextTicketId, setNextTicketId] = useState(2);

  const activeTicket = tickets.find(t => t.id === activeTicketId) || tickets[0];

  const addToCart = (productName: string, price: number, unit: string = "pz") => {
    setTickets(tickets.map(t => {
      if (t.id === activeTicketId) {
        const existing = t.items.find(i => i.name === productName);
        if (existing) {
          return { ...t, items: t.items.map(i => i.name === productName ? { ...i, qty: i.qty + 1 } : i) };
        }
        return { ...t, items: [...t.items, { id: Date.now().toString(), name: productName, price, qty: 1, unit }] };
      }
      return t;
    }));
  };

  const updateItemQty = (itemId: string, newQty: number) => {
    if (newQty <= 0) return;
    setTickets(tickets.map(t => {
      if (t.id === activeTicketId) {
        return { ...t, items: t.items.map(i => i.id === itemId ? { ...i, qty: newQty } : i) };
      }
      return t;
    }));
  };

  const removeItem = (itemId: string) => {
    setTickets(tickets.map(t => {
      if (t.id === activeTicketId) {
        return { ...t, items: t.items.filter(i => i.id !== itemId) };
      }
      return t;
    }));
  };

  // Motor Inteligente de Venta Cruzada (Cross-Selling)
  const getCrossSellSuggestions = () => {
    const suggestions: { name: string, price: number }[] = [];
    const itemNames = activeTicket.items.map(i => i.name.toLowerCase());
    
    if (itemNames.some(n => n.includes("pintura"))) {
      suggestions.push({ name: "Brocha 4 pulgadas", price: 65.0 });
      suggestions.push({ name: "Cinta Masking Tape", price: 35.0 });
    }
    if (itemNames.some(n => n.includes("cemento"))) {
      suggestions.push({ name: "Bote de Arena (Bote)", price: 20.0 });
      suggestions.push({ name: "Paleta Albañil", price: 120.0 });
    }
    if (itemNames.some(n => n.includes("martillo") || n.includes("taladro") || n.includes("clavo"))) {
      suggestions.push({ name: "Caja de Taquetes", price: 25.0 });
      suggestions.push({ name: "Broca para Concreto", price: 55.0 });
    }

    if (suggestions.length === 0) {
      suggestions.push({ name: "Guantes de Carnaza", price: 45.0 });
      suggestions.push({ name: "Cúter Truper", price: 30.0 });
    }

    return suggestions.slice(0, 3);
  };

  const total = activeTicket.items.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const iva = total * 0.16;
  const subtotal = total - iva;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', gap: '20px', height: '100%' }}>
      
      {/* Lado Izquierdo: Buscador y Sugerencias IA */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div className="glass-panel" style={{ flex: 1 }}>
          <h2 style={{ color: 'var(--color-primary)', marginBottom: '15px' }}>Buscador de Productos</h2>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <input type="text" placeholder="Buscar producto o escanear código de barras..." style={{ flex: 1, padding: '12px', borderRadius: '8px', background: 'rgba(0,0,0,0.3)', color: 'white', border: '1px solid var(--color-primary)' }} autoFocus />
            <button className="btn-primary" onClick={() => addToCart("Producto Escaneado", 150)}>Agregar</button>
          </div>
          
          <h3 style={{ color: 'var(--color-secondary)', marginBottom: '10px' }}>Atajos Rápidos (Teclado Numérico)</h3>
          <div className="grid-cols-2" style={{ gap: '10px' }}>
            <button className="btn-primary" style={{ background: 'rgba(255,255,255,0.05)' }} onClick={() => addToCart("Cemento Tolteca 50kg", 210, "bulto")}>[1] Cemento 50kg</button>
            <button className="btn-primary" style={{ background: 'rgba(255,255,255,0.05)' }} onClick={() => addToCart("Pintura Blanca 19L", 1250, "cubeta")}>[2] Pintura Blanca</button>
            <button className="btn-primary" style={{ background: 'rgba(255,255,255,0.05)' }} onClick={() => addToCart("Cable Calibre 12", 15, "metro")}>[3] Cable Calibre 12</button>
            <button className="btn-primary" style={{ background: 'rgba(255,255,255,0.05)' }} onClick={() => addToCart("Clavo 2 pulg", 45, "caja")}>[4] Clavos 2"</button>
          </div>
        </div>

        <div className="glass-panel" style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1), transparent)', border: '1px solid var(--color-secondary)' }}>
          <h3 style={{ color: 'var(--color-secondary)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            🧠 ERIKA Sugiere Ofrecer:
          </h3>
          <p style={{ fontSize: '0.85rem', marginBottom: '15px', opacity: 0.8 }}>Con base en la nota virtual, los clientes también se llevan:</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {getCrossSellSuggestions().map((sug, idx) => (
              <div key={idx} className="flex-between" style={{ background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '8px' }}>
                <span>{sug.name} <strong style={{ color: 'var(--color-primary)' }}>${sug.price}</strong></span>
                <button className="btn-primary" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => addToCart(sug.name, sug.price)}>+ Añadir a la Nota</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Lado Derecho: Nota Virtual Editable */}
      <div className="glass-panel" style={{ width: '450px', display: 'flex', flexDirection: 'column' }}>
        <div className="flex-between" style={{ marginBottom: '15px' }}>
          <h2 style={{ margin: 0 }}>🧾 Nota Virtual</h2>
          <button className="btn-primary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => {
            setTickets([...tickets, { id: nextTicketId, items: [] }]);
            setActiveTicketId(nextTicketId);
            setNextTicketId(nextTicketId + 1);
          }}>+ Nueva Nota</button>
        </div>

        <div style={{ display: 'flex', gap: '5px', marginBottom: '20px', overflowX: 'auto', paddingBottom: '10px' }}>
          {tickets.map(t => (
            <button 
              key={t.id} 
              onClick={() => setActiveTicketId(t.id)}
              className={`btn-primary ${activeTicketId !== t.id ? 'inactive' : ''}`}
              style={{ padding: '8px 15px', borderRadius: '20px', opacity: activeTicketId === t.id ? 1 : 0.5 }}
            >
              Cliente {t.id}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '10px', marginBottom: '20px' }}>
          {activeTicket.items.length === 0 ? (
            <div style={{ textAlign: 'center', opacity: 0.5, marginTop: '50px' }}>La nota está vacía. Captura artículos a la izquierda.</div>
          ) : (
            <ul style={{ listStyle: 'none' }}>
              {activeTicket.items.map((item, idx) => (
                <li key={idx} style={{ padding: '15px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div className="flex-between">
                    <strong style={{ fontSize: '1.1rem' }}>{item.name}</strong>
                    <strong style={{ color: 'var(--color-secondary)', fontSize: '1.1rem' }}>${(item.price * item.qty).toFixed(2)}</strong>
                  </div>
                  <div className="flex-between" style={{ alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,255,255,0.1)', padding: '5px', borderRadius: '20px' }}>
                      <button style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', padding: '0 10px' }} onClick={() => updateItemQty(item.id, item.qty - 1)}>-</button>
                      <span style={{ minWidth: '40px', textAlign: 'center' }}>{item.qty} {item.unit}</span>
                      <button style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', padding: '0 10px' }} onClick={() => updateItemQty(item.id, item.qty + 1)}>+</button>
                    </div>
                    <button style={{ background: 'var(--color-primary)', border: 'none', color: 'white', cursor: 'pointer', padding: '5px 10px', borderRadius: '6px', fontSize: '0.8rem' }} onClick={() => removeItem(item.id)}>🗑️ Eliminar</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '20px', borderRadius: '12px' }}>
          <div className="flex-between" style={{ marginBottom: '10px', color: 'rgba(255,255,255,0.6)' }}>
            <span>Subtotal</span>
            <span>${subtotal.toFixed(2)}</span>
          </div>
          <div className="flex-between" style={{ marginBottom: '15px', color: 'rgba(255,255,255,0.6)' }}>
            <span>IVA (16%)</span>
            <span>${iva.toFixed(2)}</span>
          </div>
          <div className="flex-between" style={{ marginBottom: '20px', fontSize: '1.5rem', fontWeight: 'bold', borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: '15px' }}>
            <span>TOTAL</span>
            <span style={{ color: 'var(--color-secondary)' }}>${total.toFixed(2)}</span>
          </div>
          
          <button className="btn-primary" style={{ width: '100%', padding: '15px', fontSize: '1.2rem' }}>
            💰 Cobrar e Imprimir Ticket
          </button>
        </div>
      </div>
    </div>
  );
}
