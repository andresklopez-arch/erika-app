"use client";
import { useState, useEffect } from "react";
import { LoggerService } from "../services/loggerService";

interface POSItem {
  id: string;
  name: string;
  price: number;
  cost: number;
  qty: number;
  unit: string;
}

interface Ticket {
  id: number;
  items: POSItem[];
  discountPct: number;
}

export default function POSModule() {
  const [tickets, setTickets] = useState<Ticket[]>([{ id: 1, items: [], discountPct: 0 }]);
  const [activeTicketId, setActiveTicketId] = useState(1);
  const [nextTicketId, setNextTicketId] = useState(2);
  const [cancellations, setCancellations] = useState<{time: string, item: string}[]>([]);
  const [isListening, setIsListening] = useState(false);

  const activeTicket = tickets.find(t => t.id === activeTicketId) || tickets[0];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F4') {
        e.preventDefault();
        applyDiscount("percent");
      } else if (e.key === 'F8') {
        e.preventDefault();
        applyDiscount("fixed");
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tickets, activeTicketId]);

  const addToCart = (productName: string, price: number, unit: string = "pz", cost: number = price * 0.7, addedQty: number = 1) => {
    setTickets(tickets.map(t => {
      if (t.id === activeTicketId) {
        const existing = t.items.find(i => i.name === productName);
        if (existing) {
          return { ...t, items: t.items.map(i => i.name === productName ? { ...i, qty: i.qty + addedQty } : i) };
        }
        return { ...t, items: [...t.items, { id: Date.now().toString(), name: productName, price, cost, qty: addedQty, unit }] };
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

  const removeItem = async (itemId: string) => {
    const pass = window.prompt("🔒 ACCESO RESTRINGIDO: Contraseña de Administrador requerida:");
    if (pass !== "admin123") {
      alert("❌ Contraseña incorrecta. Operación bloqueada.");
      return;
    }

    const itemToRemove = activeTicket.items.find(i => i.id === itemId);
    if (itemToRemove) {
      setCancellations([...cancellations, {
        time: new Date().toLocaleTimeString(),
        item: `${itemToRemove.qty}x ${itemToRemove.name}`
      }]);
      // Sincroniza con la nube en segundo plano
      LoggerService.logCancellation(itemToRemove.name, itemToRemove.qty);
    }

    setTickets(tickets.map(t => {
      if (t.id === activeTicketId) {
        return { ...t, items: t.items.filter(i => i.id !== itemId) };
      }
      return t;
    }));
  };

  const applyDiscount = (mode: "percent" | "fixed") => {
    if (activeTicket.items.length === 0) return alert("No hay artículos para descontar.");

    const rawTotal = activeTicket.items.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const totalCost = activeTicket.items.reduce((sum, item) => sum + (item.cost * item.qty), 0);
    
    const safeMinimum = totalCost * 1.05;

    let proposedTotal = 0;
    let finalPct = 0;

    if (mode === "percent") {
      const valStr = window.prompt(`Límite seguro de descuento permitido: ${((1 - (safeMinimum / rawTotal)) * 100).toFixed(1)}%\nIngresa el PORCENTAJE de descuento a aplicar (Ej. 10):`);
      if (!valStr) return;
      const pct = parseFloat(valStr);
      if (isNaN(pct) || pct < 0 || pct > 100) return alert("Porcentaje inválido.");
      proposedTotal = rawTotal * (1 - (pct / 100));
      finalPct = pct;
    } else {
      const valStr = window.prompt(`El total actual es $${rawTotal.toFixed(2)}.\nPrecio MÁS BAJO permitido: $${safeMinimum.toFixed(2)}\n\nIngresa la CANTIDAD EXACTA en la que quieres cerrar la cuenta (Ej. 1000):`);
      if (!valStr) return;
      const fixedAmount = parseFloat(valStr);
      if (isNaN(fixedAmount) || fixedAmount < 0 || fixedAmount > rawTotal) return alert("Valor inválido.");
      proposedTotal = fixedAmount;
      finalPct = (1 - (fixedAmount / rawTotal)) * 100;
    }

    if (proposedTotal < safeMinimum) {
      alert(`⚠️ SEGURO DE UTILIDAD ACTIVADO ⚠️\n\nCerrar la cuenta en $${proposedTotal.toFixed(2)} violaría tus límites y generaría pérdida de utilidad.\n\nEl sistema bloqueará este descuento. El precio más bajo que te puedo autorizar es: $${safeMinimum.toFixed(2)}`);
      return;
    }

    setTickets(tickets.map(t => t.id === activeTicketId ? { ...t, discountPct: finalPct } : t));
  };

  const getCrossSellSuggestions = () => {
    const suggestions: { name: string, price: number, cost: number }[] = [];
    const itemNames = activeTicket.items.map(i => i.name.toLowerCase());
    
    if (itemNames.some(n => n.includes("pintura"))) {
      suggestions.push({ name: "Brocha 4 pulgadas", price: 65.0, cost: 40.0 });
      suggestions.push({ name: "Cinta Masking Tape", price: 35.0, cost: 20.0 });
    }
    if (itemNames.some(n => n.includes("cemento"))) {
      suggestions.push({ name: "Bote de Arena (Bote)", price: 20.0, cost: 10.0 });
      suggestions.push({ name: "Paleta Albañil", price: 120.0, cost: 80.0 });
    }
    if (itemNames.some(n => n.includes("martillo") || n.includes("taladro") || n.includes("clavo"))) {
      suggestions.push({ name: "Caja de Taquetes", price: 25.0, cost: 12.0 });
      suggestions.push({ name: "Broca para Concreto", price: 55.0, cost: 30.0 });
    }

    if (suggestions.length === 0) {
      suggestions.push({ name: "Guantes de Carnaza", price: 45.0, cost: 25.0 });
      suggestions.push({ name: "Cúter Truper", price: 30.0, cost: 15.0 });
    }

    return suggestions.slice(0, 3);
  };

  // HARDWARE: Lógica del Micrófono (Speech API)
  const startVoiceRecognition = () => {
    // @ts-ignore
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      return alert("Tu navegador no soporta reconocimiento de voz. Usa Google Chrome para PC o Android.");
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'es-MX';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setIsListening(true);
    recognition.onerror = () => { setIsListening(false); alert("Error en el micrófono. Revisa los permisos."); };
    recognition.onend = () => setIsListening(false);

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript.toLowerCase();
      
      // Inteligencia Heurística: Extraer números del texto hablado
      const matchNumber = transcript.match(/(\d+)/);
      const qty = matchNumber ? parseInt(matchNumber[0]) : 1;
      
      let found = false;
      if (transcript.includes("cemento")) { addToCart("Cemento Tolteca 50kg", 210, "bulto", 180, qty); found = true; }
      else if (transcript.includes("pintura")) { addToCart("Pintura Blanca 19L", 1250, "cubeta", 900, qty); found = true; }
      else if (transcript.includes("cable")) { addToCart("Cable Calibre 12", 15, "metro", 8, qty); found = true; }
      else if (transcript.includes("clavo")) { addToCart("Clavo 2 pulg", 45, "caja", 25, qty); found = true; }

      if (found) {
        alert(`🎤 ERIKA Entendió: "Agregando ${qty} unidades de ${transcript}"`);
      } else {
        alert(`🎤 ERIKA Escuchó: "${transcript}", pero no encontró ese artículo en el catálogo rápido.`);
      }
    };

    recognition.start();
  };

  // HARDWARE: Lógica de Impresión Térmica Bluetooth
  const printTicketBluetooth = async () => {
    try {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb'] // UUID Genérico de impresoras térmicas
      });
      alert(`✅ Conectando con impresora: "${device.name}"... Preparando el formato térmico.`);
      // En producción aquí se mandaría el string ESC/POS al servidor GATT del dispositivo.
      setTimeout(() => alert("🖨️ ERIKA envió la orden de impresión por Bluetooth con éxito."), 1500);
    } catch (error) {
      console.error(error);
      alert("❌ Se canceló la búsqueda o tu computadora/celular no tiene encendido el Bluetooth.");
    }
  };

  const rawTotal = activeTicket.items.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const discountAmount = rawTotal * (activeTicket.discountPct / 100);
  const finalTotal = rawTotal - discountAmount;
  const iva = finalTotal * 0.16;
  const subtotal = finalTotal - iva;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', gap: '20px', height: '100%' }}>
      
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div className="glass-panel" style={{ flex: 1, position: 'relative' }}>
          <div className="flex-between" style={{ marginBottom: '15px' }}>
            <h2 style={{ color: 'var(--color-primary)', margin: 0 }}>Buscador de Productos</h2>
            <button 
              onClick={startVoiceRecognition}
              className="btn-primary" 
              style={{ background: isListening ? '#ef4444' : 'var(--glass-bg)', border: '1px solid var(--color-primary)', display: 'flex', alignItems: 'center', gap: '8px', animation: isListening ? 'pulse 1.5s infinite' : 'none' }}
            >
              🎤 {isListening ? 'Escuchando...' : 'Dictar Pedido'}
            </button>
            <style>{`@keyframes pulse { 0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); } 70% { transform: scale(1.05); box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); } 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); } }`}</style>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <input type="text" placeholder="Buscar producto o escanear código de barras..." style={{ flex: 1, padding: '12px', borderRadius: '8px', background: 'rgba(0,0,0,0.3)', color: 'white', border: '1px solid var(--color-primary)' }} autoFocus />
            <button className="btn-primary" onClick={() => addToCart("Producto Escaneado", 150)}>Agregar</button>
          </div>
          
          <h3 style={{ color: 'var(--color-secondary)', marginBottom: '10px' }}>Atajos Rápidos (Teclado Numérico)</h3>
          <div className="grid-cols-2" style={{ gap: '10px' }}>
            <button className="btn-primary" style={{ background: 'rgba(255,255,255,0.05)' }} onClick={() => addToCart("Cemento Tolteca 50kg", 210, "bulto", 180)}>[1] Cemento 50kg</button>
            <button className="btn-primary" style={{ background: 'rgba(255,255,255,0.05)' }} onClick={() => addToCart("Pintura Blanca 19L", 1250, "cubeta", 900)}>[2] Pintura Blanca</button>
            <button className="btn-primary" style={{ background: 'rgba(255,255,255,0.05)' }} onClick={() => addToCart("Cable Calibre 12", 15, "metro", 8)}>[3] Cable Calibre 12</button>
            <button className="btn-primary" style={{ background: 'rgba(255,255,255,0.05)' }} onClick={() => addToCart("Clavo 2 pulg", 45, "caja", 25)}>[4] Clavos 2"</button>
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
                <button className="btn-primary" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => addToCart(sug.name, sug.price, "pz", sug.cost)}>+ Añadir a la Nota</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="glass-panel" style={{ width: '450px', display: 'flex', flexDirection: 'column' }}>
        <div className="flex-between" style={{ marginBottom: '15px' }}>
          <h2 style={{ margin: 0 }}>🧾 Nota Virtual</h2>
          <div style={{ display: 'flex', gap: '10px' }}>
            {cancellations.length > 0 && (
              <button 
                className="btn-primary" 
                style={{ background: 'transparent', border: '1px solid var(--color-primary)', padding: '6px 12px', fontSize: '0.8rem' }} 
                onClick={() => alert("🚨 LOG EN NUBE (Simulado) 🚨\n\n" + cancellations.map(c => `[${c.time}] Canceló: ${c.item}`).join('\n'))}
              >
                ☁️ Nube Mermas ({cancellations.length})
              </button>
            )}
            <button className="btn-primary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => {
              setTickets([...tickets, { id: nextTicketId, items: [], discountPct: 0 }]);
              setActiveTicketId(nextTicketId);
              setNextTicketId(nextTicketId + 1);
            }}>+ Nueva Nota</button>
          </div>
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
            <div style={{ textAlign: 'center', opacity: 0.5, marginTop: '50px' }}>La nota está vacía. Escanea o dicta un artículo.</div>
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
                    <button style={{ background: 'transparent', border: '1px solid var(--color-primary)', color: 'var(--color-primary)', cursor: 'pointer', padding: '5px 10px', borderRadius: '6px', fontSize: '0.8rem' }} onClick={() => removeItem(item.id)}>🔒 Eliminar</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '20px', borderRadius: '12px' }}>
          
          <div className="flex-between" style={{ marginBottom: '10px' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => applyDiscount("percent")} style={{ background: 'transparent', color: 'var(--color-secondary)', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.9rem' }}>
                % Descuento [F4]
              </button>
              <button onClick={() => applyDiscount("fixed")} style={{ background: 'transparent', color: 'var(--color-secondary)', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.9rem' }}>
                $ Cierre Exacto [F8]
              </button>
            </div>
            {activeTicket.discountPct > 0 && (
              <span style={{ color: 'var(--color-primary)', fontWeight: 'bold' }}>-{activeTicket.discountPct.toFixed(1)}%</span>
            )}
          </div>

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
            <span style={{ color: 'var(--color-secondary)' }}>${finalTotal.toFixed(2)}</span>
          </div>
          
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn-primary" style={{ flex: 1, padding: '15px', fontSize: '1.2rem', background: 'transparent', border: '1px solid var(--color-primary)' }}>
              💰 Cobro Rápido
            </button>
            <button onClick={printTicketBluetooth} className="btn-primary" style={{ flex: 1, padding: '15px', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
              🖨️ Imprimir (BT)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
