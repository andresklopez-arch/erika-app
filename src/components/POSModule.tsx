"use client";
import { useState, useEffect } from "react";
import { LoggerService } from "../services/loggerService";
import { Html5QrcodeScanner } from "html5-qrcode";
import { supabase } from "../lib/supabaseClient";

interface POSItem {
  id: string;
  code?: string;
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
  const [globalCatalog, setGlobalCatalog] = useState<any[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([{ id: 1, items: [], discountPct: 0 }]);
  const [activeTicketId, setActiveTicketId] = useState(1);
  const [nextTicketId, setNextTicketId] = useState(2);
  const [cancellations, setCancellations] = useState<{time: string, item: string}[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [securityKeyword, setSecurityKeyword] = useState("erika");
  const [searchInput, setSearchInput] = useState("");

  const activeTicket = tickets.find(t => t.id === activeTicketId) || tickets[0];

  useEffect(() => {
    const saved = localStorage.getItem("ERIKA_VOICE_KEYWORD");
    if (saved) setSecurityKeyword(saved.toLowerCase());

    // Cargar Catálogo desde Supabase
    const fetchCatalog = async () => {
      const { data } = await supabase.from('inventory').select('*');
      if (data) setGlobalCatalog(data);
    };
    fetchCatalog();
  }, []);

  // Lector Láser Interceptor
  useEffect(() => {
    let barcodeBuffer = "";
    let barcodeTimeout: any = null;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F4') { e.preventDefault(); applyDiscount("percent"); return; } 
      if (e.key === 'F8') { e.preventDefault(); applyDiscount("fixed"); return; }

      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === 'Enter' && barcodeBuffer.length > 2) {
        e.preventDefault();
        const scannedCode = barcodeBuffer.toUpperCase();
        barcodeBuffer = "";
        
        const matched = globalCatalog.find(c => c.code === scannedCode);
        if (matched) {
          addToCart(matched.name, matched.price, "pz", matched.cost, 1);
          speak(`Escaneado: ${matched.name}`);
        } else {
          speak("Producto no encontrado en Supabase.");
        }
      } else if (e.key.length === 1) {
        barcodeBuffer += e.key;
        clearTimeout(barcodeTimeout);
        barcodeTimeout = setTimeout(() => { barcodeBuffer = ""; }, 100);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tickets, activeTicketId, globalCatalog]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim().toUpperCase();
    if (!q) return;
    
    const matched = globalCatalog.find(c => c.code === q || c.name.toUpperCase().includes(q));
    if (matched) {
      addToCart(matched.name, matched.price, "pz", matched.cost, 1);
      setSearchInput("");
    } else {
      alert("No se encontró el producto.");
    }
  };

  useEffect(() => {
    let scanner: any = null;
    if (showScanner) {
      scanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: { width: 250, height: 250 } }, false);
      scanner.render((decodedText: string) => {
        scanner.clear();
        setShowScanner(false);
        const loc = decodedText.replace("ERIKA-LOC-", "");
        const matched = globalCatalog.find(c => c.location === loc || c.code === decodedText);
        if(matched) {
          addToCart(matched.name, matched.price, "pz", matched.cost, 1);
          speak(`Visión detectada. ${matched.name} agregado.`);
        } else {
           alert(`📷 Código no mapeado (${decodedText}).`);
        }
      }, () => { /* ignore */ });
    }
    return () => { if(scanner) scanner.clear().catch(()=>{}); };
  }, [showScanner, globalCatalog]);

  const addToCart = (productName: string, price: number, unit: string = "pz", cost: number = price * 0.7, addedQty: number = 1) => {
    setTickets(tickets.map(t => {
      if (t.id === activeTicketId) {
        const existing = t.items.find(i => i.name === productName);
        if (existing) return { ...t, items: t.items.map(i => i.name === productName ? { ...i, qty: i.qty + addedQty } : i) };
        return { ...t, items: [...t.items, { id: Date.now().toString(), name: productName, price, cost, qty: addedQty, unit }] };
      }
      return t;
    }));
  };

  const updateItemQty = (itemId: string, newQty: number) => {
    if (newQty <= 0) return;
    setTickets(tickets.map(t => {
      if (t.id === activeTicketId) return { ...t, items: t.items.map(i => i.id === itemId ? { ...i, qty: newQty } : i) };
      return t;
    }));
  };

  const removeItem = async (itemId: string) => {
    const pass = window.prompt("🔒 ACCESO RESTRINGIDO: Contraseña requerida:");
    if (pass !== "admin123") return alert("❌ Contraseña incorrecta.");

    const itemToRemove = activeTicket.items.find(i => i.id === itemId);
    if (itemToRemove) {
      const reason = window.prompt(`¿Qué pasará con: ${itemToRemove.name}?\n\n[ 1 ] Regresa a Almacén (Sano)\n[ 2 ] Basura / Dañado (Merma)`);
      if (reason === "1") alert("✅ Stock devuelto al inventario físico correctamente.");
      else if (reason === "2") {
         setCancellations([...cancellations, { time: new Date().toLocaleTimeString(), item: `${itemToRemove.qty}x ${itemToRemove.name} (MERMA) - Pérdida: $${(itemToRemove.cost * itemToRemove.qty).toFixed(2)}` }]);
         LoggerService.logCancellation(itemToRemove.name, itemToRemove.qty);
         alert("⚠️ Registrado como Pérdida/Merma Financiera en el Historial.");
      } else return;
    }
    setTickets(tickets.map(t => t.id === activeTicketId ? { ...t, items: t.items.filter(i => i.id !== itemId) } : t));
  };

  const applyDiscount = (mode: "percent" | "fixed") => {
    if (activeTicket.items.length === 0) return;
    const rawTotal = activeTicket.items.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const totalCost = activeTicket.items.reduce((sum, item) => sum + (item.cost * item.qty), 0);
    const safeMinimum = totalCost * 1.05;

    let proposedTotal = 0, finalPct = 0;
    if (mode === "percent") {
      const pct = parseFloat(window.prompt(`Máx: ${((1-(safeMinimum/rawTotal))*100).toFixed(1)}%\nIngresa %:`) || "");
      if (isNaN(pct)) return;
      proposedTotal = rawTotal * (1 - (pct / 100)); finalPct = pct;
    } else {
      const fixedAmount = parseFloat(window.prompt(`Mínimo seguro: $${safeMinimum.toFixed(2)}\nTotal deseado:`) || "");
      if (isNaN(fixedAmount)) return;
      proposedTotal = fixedAmount; finalPct = (1 - (fixedAmount / rawTotal)) * 100;
    }

    if (proposedTotal < safeMinimum) return alert(`⚠️ SEGURO DE UTILIDAD\nLímite Mínimo: $${safeMinimum.toFixed(2)}`);
    setTickets(tickets.map(t => t.id === activeTicketId ? { ...t, discountPct: finalPct } : t));
  };

  const fuzzyMatchKeywords = (fragment: string, name: string) => {
    const fWords = fragment.split(/\s+/);
    const nWords = name.toLowerCase().split(/\s+/);
    for (const kw of nWords) {
      if (kw.length < 4) continue;
      if (fragment.includes(kw)) return true;
      for (const fWord of fWords) {
        if (fWord.length > 4 && Math.abs(fWord.length - kw.length) <= 2) {
          let diffs = 0;
          for (let i = 0; i < Math.min(fWord.length, kw.length); i++) if (fWord[i] !== kw[i]) diffs++;
          if (diffs <= 2) return true;
        }
      }
    }
    return false;
  };

  const speak = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-MX'; utterance.rate = 1.05;
    window.speechSynthesis.speak(utterance);
  };

  const startVoiceRecognition = () => {
    // @ts-ignore
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return alert("Navegador no soporta micrófono.");
    const recognition = new SpeechRecognition();
    recognition.lang = 'es-MX'; recognition.continuous = false;

    recognition.onstart = () => setIsListening(true);
    recognition.onerror = () => { setIsListening(false); alert("Error de micrófono."); };
    recognition.onend = () => setIsListening(false);

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript.toLowerCase();
      if (!transcript.includes(securityKeyword)) return speak(`Error de autenticación. No escuché la palabra clave.`);

      const fragments = transcript.replace(/además/g, 'y').replace(/,/g, 'y').split(' y ');
      let nothingFound = true;
      let voiceReply = "";

      fragments.forEach((fragment: string) => {
        const matchNumber = fragment.match(/(\d+)/);
        let qty = matchNumber ? parseInt(matchNumber[0]) : 1;
        if (!matchNumber) {
          if (fragment.includes("un") || fragment.includes("una")) qty = 1;
          if (fragment.includes("dos") || fragment.includes("par")) qty = 2;
          if (fragment.includes("tres")) qty = 3;
        }

        let matchedProduct = null;
        for (const prod of globalCatalog) if (fuzzyMatchKeywords(fragment, prod.name)) { matchedProduct = prod; break; }

        if (matchedProduct) {
          if (qty > matchedProduct.stock) {
            voiceReply += `Solo hay ${matchedProduct.stock} de ${matchedProduct.name}. `;
          } else {
            addToCart(matchedProduct.name, matchedProduct.price, "pz", matchedProduct.cost, qty);
            voiceReply += `Agregué ${qty} ${matchedProduct.name}. `;
          }
          nothingFound = false;
        }
      });

      if (nothingFound) speak("No encontré artículos válidos.");
      else speak("Autorizado. " + voiceReply);
    };

    recognition.start();
  };

  const getCrossSellSuggestions = () => {
    if (globalCatalog.length === 0) return [];
    return globalCatalog.slice(0, 3).map(p => ({ name: p.name, price: p.price, cost: p.cost }));
  };

  const rawTotal = activeTicket.items.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const discountAmount = rawTotal * (activeTicket.discountPct / 100);
  const finalTotal = rawTotal - discountAmount;
  const iva = finalTotal * 0.16;
  const subtotal = finalTotal - iva;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', gap: '20px', height: '100%' }}>
      {showScanner && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.9)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <h2 style={{ color: 'var(--color-primary)' }}>📷 Escáner de Visión Artificial</h2>
          <div id="qr-reader" style={{ width: '400px', maxWidth: '90%', background: 'white' }}></div>
          <button className="btn-primary" onClick={() => setShowScanner(false)} style={{ marginTop: '20px', background: 'transparent', border: '1px solid var(--color-primary)' }}>Cerrar Cámara</button>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div className="glass-panel" style={{ flex: 1, position: 'relative' }}>
          <div className="flex-between" style={{ marginBottom: '15px' }}>
            <h2 style={{ color: 'var(--color-primary)', margin: 0 }}>Terminal de Ventas (☁️ Nube)</h2>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setShowScanner(true)} className="btn-primary" style={{ background: 'transparent', border: '1px solid var(--color-secondary)' }}>📷 Visión</button>
              <button onClick={startVoiceRecognition} className="btn-primary" style={{ background: isListening ? '#ef4444' : 'var(--glass-bg)', border: '1px solid var(--color-primary)' }}>🎤 Dictar</button>
            </div>
          </div>

          <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <input 
              type="text" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar por Nombre, Código de Barras o Disparar Pistola Láser..." 
              style={{ flex: 1, padding: '12px', borderRadius: '8px', background: 'rgba(0,0,0,0.3)', color: 'white', border: '1px solid var(--color-primary)' }} 
            />
            <button type="submit" className="btn-primary" style={{ background: 'var(--color-secondary)', color: 'black' }}>Agregar</button>
          </form>
          
          <h3 style={{ color: 'var(--color-secondary)', marginBottom: '10px' }}>Atajos Rápidos (Teclado Numérico)</h3>
          <div className="grid-cols-2" style={{ gap: '10px' }}>
            {globalCatalog.slice(0, 4).map((c, i) => (
              <button key={c.id} className="btn-primary" style={{ background: 'rgba(255,255,255,0.05)' }} onClick={() => addToCart(c.name, c.price, "pz", c.cost)}>[{i+1}] {c.name.substring(0,15)}...</button>
            ))}
          </div>
        </div>

        <div className="glass-panel" style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1), transparent)', border: '1px solid var(--color-secondary)' }}>
          <h3 style={{ color: 'var(--color-secondary)', marginBottom: '10px' }}>🧠 ERIKA Sugiere Ofrecer:</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {getCrossSellSuggestions().map((sug, idx) => (
              <div key={idx} className="flex-between" style={{ background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '8px' }}>
                <span>{sug.name} <strong style={{ color: 'var(--color-primary)' }}>${sug.price}</strong></span>
                <button className="btn-primary" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => addToCart(sug.name, sug.price, "pz", sug.cost)}>+ Añadir</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="glass-panel" style={{ width: '450px', display: 'flex', flexDirection: 'column' }}>
        <div className="flex-between" style={{ marginBottom: '15px' }}>
          <h2 style={{ margin: 0 }}>🧾 Nota Virtual</h2>
          <div style={{ display: 'flex', gap: '10px' }}>
            {cancellations.length > 0 && <button className="btn-primary" style={{ background: 'transparent', border: '1px solid var(--color-primary)', padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => alert(cancellations.map(c => `[${c.time}] Canceló: ${c.item}`).join('\n'))}>☁️ Mermas</button>}
            <button className="btn-primary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => { setTickets([...tickets, { id: nextTicketId, items: [], discountPct: 0 }]); setActiveTicketId(nextTicketId); setNextTicketId(nextTicketId + 1); }}>+ Nueva Nota</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '5px', marginBottom: '20px', overflowX: 'auto', paddingBottom: '10px' }}>
          {tickets.map(t => (
            <button key={t.id} onClick={() => setActiveTicketId(t.id)} className={`btn-primary ${activeTicketId !== t.id ? 'inactive' : ''}`} style={{ padding: '8px 15px', borderRadius: '20px', opacity: activeTicketId === t.id ? 1 : 0.5 }}>Cliente {t.id}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '10px', marginBottom: '20px' }}>
          <ul style={{ listStyle: 'none' }}>
            {activeTicket.items.map(item => (
              <li key={item.id} style={{ padding: '15px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div className="flex-between">
                  <strong style={{ fontSize: '1.1rem' }}>{item.name}</strong>
                  <strong style={{ color: 'var(--color-secondary)', fontSize: '1.1rem' }}>${(item.price * item.qty).toFixed(2)}</strong>
                </div>
                <div className="flex-between" style={{ alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,255,255,0.1)', padding: '5px', borderRadius: '20px' }}>
                    <button style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', padding: '0 10px' }} onClick={() => updateItemQty(item.id, item.qty - 1)}>-</button>
                    <span>{item.qty} {item.unit}</span>
                    <button style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', padding: '0 10px' }} onClick={() => updateItemQty(item.id, item.qty + 1)}>+</button>
                  </div>
                  <button style={{ background: 'transparent', border: '1px solid var(--color-primary)', color: 'var(--color-primary)', cursor: 'pointer', padding: '5px 10px', borderRadius: '6px', fontSize: '0.8rem' }} onClick={() => removeItem(item.id)}>🔒 Eliminar</button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '20px', borderRadius: '12px' }}>
          <div className="flex-between" style={{ marginBottom: '10px' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => applyDiscount("percent")} style={{ background: 'transparent', color: 'var(--color-secondary)', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.9rem' }}>% Descuento [F4]</button>
              <button onClick={() => applyDiscount("fixed")} style={{ background: 'transparent', color: 'var(--color-secondary)', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.9rem' }}>$ Cierre [F8]</button>
            </div>
            {activeTicket.discountPct > 0 && <span style={{ color: 'var(--color-primary)', fontWeight: 'bold' }}>-{activeTicket.discountPct.toFixed(1)}%</span>}
          </div>

          <div className="flex-between" style={{ marginBottom: '10px', color: 'rgba(255,255,255,0.6)' }}>
            <span>Subtotal</span><span>${subtotal.toFixed(2)}</span>
          </div>
          <div className="flex-between" style={{ marginBottom: '20px', fontSize: '1.5rem', fontWeight: 'bold', borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: '15px' }}>
            <span>TOTAL</span><span style={{ color: 'var(--color-secondary)' }}>${finalTotal.toFixed(2)}</span>
          </div>
          <button className="btn-primary" style={{ width: '100%', padding: '15px', background: 'transparent', border: '1px solid var(--color-primary)' }}>💰 Cobro PC</button>
        </div>
      </div>
    </div>
  );
}
