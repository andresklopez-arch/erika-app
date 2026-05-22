"use client";
import { useState, useEffect } from "react";
import { LoggerService } from "../services/loggerService";
import { Html5QrcodeScanner } from "html5-qrcode";
import { supabase } from "../lib/supabaseClient";
import {
  saveTransactionOffline,
  syncOfflineTransactions,
  getOfflineTransactions,
} from "../lib/offlineSync";
import PosScannerModal from "./PosScannerModal";
import PosCreditModal from "./PosCreditModal";

interface POSItem {
  id: string;
  code?: string;
  name: string;
  price: number;
  cost: number;
  qty: number;
  unit: string;
  image_url?: string;
}

interface Ticket {
  id: number;
  items: POSItem[];
  discountPct: number;
}

export default function POSModule() {
  const [globalCatalog, setGlobalCatalog] = useState<any[]>([]);
  const [offlinePendingCount, setOfflinePendingCount] = useState(0);

  const [loyaltyRates, setLoyaltyRates] = useState({
    earnRate: 100, // $100 -> 1 pt
    earnPoints: 1,
    redeemRate: 10, // 10 pts -> $1 discount
  });
  
  const [wholesaleRules, setWholesaleRules] = useState({
    minQty: 10,
    discountPct: 10,
  });

  useEffect(() => {
    const sEarnRate = parseFloat(localStorage.getItem("ERIKA_EARN_RATE") || "100");
    const sEarnPts = parseFloat(localStorage.getItem("ERIKA_EARN_PTS") || "1");
    const sRedeem = parseFloat(localStorage.getItem("ERIKA_REDEEM_RATE") || "10");
    const sWQ = parseInt(localStorage.getItem("ERIKA_WHOLESALE_QTY") || "10");
    const sWP = parseInt(localStorage.getItem("ERIKA_WHOLESALE_PCT") || "10");
    
    setLoyaltyRates({
      earnRate: sEarnRate > 0 ? sEarnRate : 100,
      earnPoints: sEarnPts > 0 ? sEarnPts : 1,
      redeemRate: sRedeem > 0 ? sRedeem : 10
    });
    
    setWholesaleRules({
      minQty: sWQ > 0 ? sWQ : 10,
      discountPct: sWP > 0 ? sWP : 10
    });
  }, []);

  const [tickets, setTickets] = useState<Ticket[]>([
    { id: 1, items: [], discountPct: 0 },
  ]);
  const [activeTicketId, setActiveTicketId] = useState(1);
  const [nextTicketId, setNextTicketId] = useState(2);
  const [cancellations, setCancellations] = useState<
    { time: string; item: string }[]
  >([]);
  const [isListening, setIsListening] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [securityKeyword, setSecurityKeyword] = useState("erika");
  const [searchInput, setSearchInput] = useState("");
  const [customers, setCustomers] = useState<any[]>([]);
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);

  const activeTicket =
    tickets.find((t) => t.id === activeTicketId) || tickets[0];

  const updateOfflineStatus = async () => {
    setIsOffline(!navigator.onLine);
    if (navigator.onLine) {
      const synced = await syncOfflineTransactions();
      if (synced > 0)
        alert(
          `☁️ ¡Conexión recuperada! Se sincronizaron ${synced} tickets pendientes.`,
        );
    }
    const pending = await getOfflineTransactions();
    setPendingOfflineCount(pending.length);
  };

  useEffect(() => {
    updateOfflineStatus();
    window.addEventListener("online", updateOfflineStatus);
    window.addEventListener("offline", updateOfflineStatus);
    return () => {
      window.removeEventListener("online", updateOfflineStatus);
      window.removeEventListener("offline", updateOfflineStatus);
    };
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("ERIKA_VOICE_KEYWORD");
    if (saved) setSecurityKeyword(saved.toLowerCase());

    // Cargar Catálogo desde Supabase
    const fetchCatalog = async () => {
      const { data } = await supabase.from("inventory").select("*");
      if (data) setGlobalCatalog(data);
      const { data: custData } = await supabase.from("customers").select("*");
      if (custData) setCustomers(custData);
    };
    fetchCatalog();
  }, []);

  // Lector Láser Interceptor
  useEffect(() => {
    let barcodeBuffer = "";
    let barcodeTimeout: any = null;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F4") {
        e.preventDefault();
        applyDiscount("percent");
        return;
      }
      if (e.key === "F8") {
        e.preventDefault();
        applyDiscount("fixed");
        return;
      }

      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if (e.key === "Enter" && barcodeBuffer.length > 2) {
        e.preventDefault();
        const scannedCode = barcodeBuffer.toUpperCase();
        barcodeBuffer = "";

        const matched = globalCatalog.find((c) => c.code === scannedCode);
        if (matched) {
          addToCart(
            matched.name,
            matched.price,
            "pz",
            matched.cost,
            1,
            matched.image_url,
          );
          let msg = `Escaneado: ${matched.name}.`;
          if (matched.stock <= matched.min_stock)
            msg += ` Alerta: Quedan pocas unidades en bodega.`;
          speak(msg);
        } else {
          speak("Producto no encontrado en Supabase.");
        }
      } else if (e.key.length === 1) {
        barcodeBuffer += e.key;
        clearTimeout(barcodeTimeout);
        barcodeTimeout = setTimeout(() => {
          barcodeBuffer = "";
        }, 100);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tickets, activeTicketId, globalCatalog]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim().toUpperCase();
    if (!q) return;

    const matched = globalCatalog.find(
      (c) => c.code === q || c.name.toUpperCase().includes(q),
    );
    if (matched) {
      addToCart(
        matched.name,
        matched.price,
        "pz",
        matched.cost,
        1,
        matched.image_url,
      );
      setSearchInput("");
    } else {
      alert("No se encontró el producto.");
    }
  };

  // Moved Scanner to component

  const addToCart = (
    productName: string,
    price: number,
    unit: string = "pz",
    cost: number = price * 0.7,
    addedQty: number = 1,
    image_url: string = "",
  ) => {
    setTickets(
      tickets.map((t) => {
        if (t.id === activeTicketId) {
          const existing = t.items.find((i) => i.name === productName);
          if (existing)
            return {
              ...t,
              items: t.items.map((i) =>
                i.name === productName ? { ...i, qty: i.qty + addedQty } : i,
              ),
            };
          return {
            ...t,
            items: [
              ...t.items,
              {
                id: Date.now().toString(),
                name: productName,
                price,
                cost,
                qty: addedQty,
                unit,
                image_url,
              },
            ],
          };
        }
        return t;
      }),
    );
  };

  const updateItemQty = (itemId: string, newQty: number) => {
    if (newQty <= 0) return;
    setTickets(
      tickets.map((t) => {
        if (t.id === activeTicketId)
          return {
            ...t,
            items: t.items.map((i) =>
              i.id === itemId ? { ...i, qty: newQty } : i,
            ),
          };
        return t;
      }),
    );
  };

  const removeItem = async (itemId: string) => {
    const pass = window.prompt("🔒 ACCESO RESTRINGIDO: Contraseña requerida:");
    if (pass !== "admin123") return alert("❌ Contraseña incorrecta.");

    const itemToRemove = activeTicket.items.find((i) => i.id === itemId);
    if (itemToRemove) {
      const reason = window.prompt(
        `¿Qué pasará con: ${itemToRemove.name}?\n\n[ 1 ] Regresa a Almacén (Sano)\n[ 2 ] Basura / Dañado (Merma)`,
      );
      if (reason === "1")
        alert("✅ Stock devuelto al inventario físico correctamente.");
      else if (reason === "2") {
        setCancellations([
          ...cancellations,
          {
            time: new Date().toLocaleTimeString(),
            item: `${itemToRemove.qty}x ${itemToRemove.name} (MERMA) - Pérdida: $${(itemToRemove.cost * itemToRemove.qty).toFixed(2)}`,
          },
        ]);
        LoggerService.logCancellation(itemToRemove.name, itemToRemove.qty);
        alert("⚠️ Registrado como Pérdida/Merma Financiera en el Historial.");
      } else return;
    }
    setTickets(
      tickets.map((t) =>
        t.id === activeTicketId
          ? { ...t, items: t.items.filter((i) => i.id !== itemId) }
          : t,
      ),
    );
  };

  const applyDiscount = (mode: "percent" | "fixed") => {
    if (activeTicket.items.length === 0) return;
    const currentRawTotal = activeTicket.items.reduce((sum, item) => {
      let p = item.price;
      if (item.qty >= wholesaleRules.minQty) {
        p = item.price * (1 - wholesaleRules.discountPct / 100);
      }
      return sum + p * item.qty;
    }, 0);
    const totalCost = activeTicket.items.reduce(
      (sum, item) => sum + item.cost * item.qty,
      0,
    );
    const safeMinimum = totalCost * 1.05;

    let proposedTotal = 0,
      finalPct = 0;
    if (mode === "percent") {
      const pct = parseFloat(
        window.prompt(
          `Máx: ${((1 - safeMinimum / currentRawTotal) * 100).toFixed(1)}%\nIngresa %:`,
        ) || "",
      );
      if (isNaN(pct)) return;
      proposedTotal = currentRawTotal * (1 - pct / 100);
      finalPct = pct;
    } else {
      const fixedAmount = parseFloat(
        window.prompt(
          `Mínimo seguro: $${safeMinimum.toFixed(2)}\nTotal deseado:`,
        ) || "",
      );
      if (isNaN(fixedAmount)) return;
      proposedTotal = fixedAmount;
      finalPct = (1 - fixedAmount / currentRawTotal) * 100;
    }

    if (proposedTotal < safeMinimum)
      return alert(
        `⚠️ SEGURO DE UTILIDAD\nLímite Mínimo: $${safeMinimum.toFixed(2)}`,
      );

    if (finalPct > 5) {
      const pin = window.prompt(
        "⚠️ Descuento mayor al 5%. Requiere PIN de administrador:",
      );
      if (pin !== "admin123")
        return alert("❌ PIN incorrecto. Descuento denegado.");
    }

    setTickets(
      tickets.map((t) =>
        t.id === activeTicketId ? { ...t, discountPct: finalPct } : t,
      ),
    );
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
          for (let i = 0; i < Math.min(fWord.length, kw.length); i++)
            if (fWord[i] !== kw[i]) diffs++;
          if (diffs <= 2) return true;
        }
      }
    }
    return false;
  };

  const speak = (text: string) => {
    if (!("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-MX";
    utterance.rate = 1.05;
    window.speechSynthesis.speak(utterance);
  };

  const startVoiceRecognition = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return alert("Navegador no soporta micrófono.");
    const recognition = new SpeechRecognition();
    recognition.lang = "es-MX";
    recognition.continuous = false;

    recognition.onstart = () => setIsListening(true);
    recognition.onerror = () => {
      setIsListening(false);
      alert("Error de micrófono.");
    };
    recognition.onend = () => setIsListening(false);

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript.toLowerCase();
      if (!transcript.includes(securityKeyword))
        return speak(`Error de autenticación. No escuché la palabra clave.`);

      const fragments = transcript
        .replace(/además/g, "y")
        .replace(/,/g, "y")
        .split(" y ");
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
        for (const prod of globalCatalog)
          if (fuzzyMatchKeywords(fragment, prod.name)) {
            matchedProduct = prod;
            break;
          }

        if (matchedProduct) {
          if (qty > matchedProduct.stock) {
            voiceReply += `Solo hay ${matchedProduct.stock} de ${matchedProduct.name}. `;
          } else {
            addToCart(
              matchedProduct.name,
              matchedProduct.price,
              "pz",
              matchedProduct.cost,
              qty,
              matchedProduct.image_url,
            );
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
    return globalCatalog
      .slice(0, 3)
      .map((p) => ({
        name: p.name,
        price: p.price,
        cost: p.cost,
        image_url: p.image_url,
      }));
  };

  const rawTotal = activeTicket.items.reduce((sum, item) => {
    let p = item.price;
    if (item.qty >= wholesaleRules.minQty) {
      p = item.price * (1 - wholesaleRules.discountPct / 100);
    }
    return sum + p * item.qty;
  }, 0);
  const discountAmount = rawTotal * (activeTicket.discountPct / 100);
  const finalTotal = rawTotal - discountAmount;
  const iva = finalTotal * 0.16;
  const subtotal = finalTotal - iva;

  const sendWhatsApp = (type: "quote" | "receipt") => {
    if (activeTicket.items.length === 0) return alert("El ticket está vacío.");
    let phone = "";
    if (selectedCustomerId) {
       const c = customers.find(x => x.id === selectedCustomerId);
       if (c?.phone) phone = c.phone;
    }
    if (!phone) {
       phone = window.prompt("Ingresa el número de WhatsApp a 10 dígitos (sin espacios):") || "";
    }
    if (!phone || phone.length < 10) return;
    
    const title = type === "quote" ? "*COTIZACIÓN - FERRETERÍA ERIKA*" : "*RECIBO DE COMPRA - FERRETERÍA ERIKA*";
    const itemsText = activeTicket.items.map(i => `▪️ ${i.qty}x ${i.name} - $${(i.price * i.qty).toFixed(2)}`).join("%0A");
    const totalText = `*TOTAL: $${finalTotal.toFixed(2)}*`;
    
    const msg = `${title}%0A%0A${itemsText}%0A%0A${totalText}%0A%0A¡Gracias por su preferencia!`;
    window.open(`https://wa.me/52${phone}?text=${msg}`, "_blank");
  };

  return (
    <div
      className="animate-fade-in"
      style={{ display: "flex", gap: "20px", height: "100%" }}
    >
      <PosScannerModal
        show={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={(decodedText) => {
          const loc = decodedText.replace("ERIKA-LOC-", "");
          const matched = globalCatalog.find(
            (c) => c.location === loc || c.code === decodedText,
          );
          if (matched) {
            addToCart(
              matched.name,
              matched.price,
              "pz",
              matched.cost,
              1,
              matched.image_url,
            );
            let msg = `Visión detectada. ${matched.name} agregado.`;
            if (matched.stock <= matched.min_stock)
              msg += ` Alerta: Quedan pocas unidades en bodega.`;
            speak(msg);
          } else {
            alert(`📷 Código no mapeado (${decodedText}).`);
          }
        }}
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: "20px",
        }}
      >
        <div
          className="glass-panel"
          style={{
            flex: 1,
            position: "relative",
            border: isOffline
              ? "2px solid #ef4444"
              : "1px solid rgba(255,255,255,0.1)",
          }}
        >
          <div className="flex-between" style={{ marginBottom: "15px" }}>
            <h2
              style={{
                color: isOffline ? "#ef4444" : "var(--color-primary)",
                margin: 0,
              }}
            >
              Terminal de Ventas {isOffline ? "(⚠️ MODO OFFLINE)" : "(☁️ Nube)"}
            </h2>
            <div style={{ display: "flex", gap: "10px" }}>
              {pendingOfflineCount > 0 && (
                <span
                  style={{
                    background: "#ef4444",
                    padding: "5px 10px",
                    borderRadius: "8px",
                    fontSize: "0.8rem",
                    fontWeight: "bold",
                  }}
                >
                  {pendingOfflineCount} pendientes
                </span>
              )}
              <button
                onClick={() => setShowScanner(true)}
                className="btn-primary"
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-secondary)",
                }}
              >
                📷 Visión
              </button>
              <button
                onClick={startVoiceRecognition}
                className="btn-primary"
                style={{
                  background: isListening ? "#ef4444" : "var(--glass-bg)",
                  border: "1px solid var(--color-primary)",
                }}
              >
                🎤 Dictar
              </button>
            </div>
          </div>

          <form
            onSubmit={handleSearchSubmit}
            style={{ display: "flex", gap: "10px", marginBottom: "20px" }}
          >
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar por Nombre, Código de Barras o Disparar Pistola Láser..."
              style={{
                flex: 1,
                padding: "12px",
                borderRadius: "8px",
                background: "rgba(0,0,0,0.3)",
                color: "white",
                border: "1px solid var(--color-primary)",
              }}
            />
            <button
              type="submit"
              className="btn-primary"
              style={{ background: "var(--color-secondary)", color: "black" }}
            >
              Agregar
            </button>
          </form>

          <h3 style={{ color: "var(--color-secondary)", marginBottom: "10px" }}>
            Atajos Rápidos (Teclado Numérico)
          </h3>
          <div className="grid-cols-2" style={{ gap: "10px" }}>
            {globalCatalog.slice(0, 4).map((c, i) => (
              <button
                key={c.id}
                className="btn-primary"
                style={{ background: "rgba(255,255,255,0.05)" }}
                onClick={() =>
                  addToCart(c.name, c.price, "pz", c.cost, 1, c.image_url)
                }
              >
                [{i + 1}] {c.name.substring(0, 15)}...
              </button>
            ))}
          </div>
        </div>

        <div
          className="glass-panel"
          style={{
            background:
              "linear-gradient(135deg, rgba(16, 185, 129, 0.1), transparent)",
            border: "1px solid var(--color-secondary)",
          }}
        >
          <h3 style={{ color: "var(--color-secondary)", marginBottom: "10px" }}>
            🧠 ERIKA Sugiere Ofrecer:
          </h3>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "10px" }}
          >
            {getCrossSellSuggestions().map((sug, idx) => (
              <div
                key={idx}
                className="flex-between"
                style={{
                  background: "rgba(0,0,0,0.3)",
                  padding: "10px",
                  borderRadius: "8px",
                }}
              >
                <span>
                  {sug.name}{" "}
                  <strong style={{ color: "var(--color-primary)" }}>
                    ${sug.price}
                  </strong>
                </span>
                <button
                  className="btn-primary"
                  style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                  onClick={() =>
                    addToCart(
                      sug.name,
                      sug.price,
                      "pz",
                      sug.cost,
                      1,
                      sug.image_url,
                    )
                  }
                >
                  + Añadir
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        className="glass-panel"
        style={{ width: "450px", display: "flex", flexDirection: "column" }}
      >
        <div className="flex-between" style={{ marginBottom: "15px" }}>
          <h2 style={{ margin: 0 }}>🧾 Nota Virtual</h2>
          <div style={{ display: "flex", gap: "10px" }}>
            {cancellations.length > 0 && (
              <button
                className="btn-primary"
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-primary)",
                  padding: "6px 12px",
                  fontSize: "0.8rem",
                }}
                onClick={() =>
                  alert(
                    cancellations
                      .map((c) => `[${c.time}] Canceló: ${c.item}`)
                      .join("\n"),
                  )
                }
              >
                ☁️ Mermas
              </button>
            )}
            <button
              className="btn-primary"
              style={{ padding: "6px 12px", fontSize: "0.8rem" }}
              onClick={() => {
                setTickets([
                  ...tickets,
                  { id: nextTicketId, items: [], discountPct: 0 },
                ]);
                setActiveTicketId(nextTicketId);
                setNextTicketId(nextTicketId + 1);
              }}
            >
              + Nueva Nota
            </button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: "5px",
            marginBottom: "20px",
            overflowX: "auto",
            paddingBottom: "10px",
          }}
        >
          {tickets.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTicketId(t.id)}
              className={`btn-primary ${activeTicketId !== t.id ? "inactive" : ""}`}
              style={{
                padding: "8px 15px",
                borderRadius: "20px",
                opacity: activeTicketId === t.id ? 1 : 0.5,
              }}
            >
              Cliente {t.id}
            </button>
          ))}
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            background: "rgba(0,0,0,0.2)",
            borderRadius: "8px",
            padding: "10px",
            marginBottom: "20px",
          }}
        >
          <ul style={{ listStyle: "none" }}>
            {activeTicket.items.map((item) => (
              <li
                key={item.id}
                style={{
                  padding: "15px 10px",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "center", gap: "10px" }}
                >
                  {item.image_url && (
                    <img
                      src={item.image_url}
                      alt={item.name}
                      style={{
                        width: "40px",
                        height: "40px",
                        objectFit: "cover",
                        borderRadius: "6px",
                      }}
                    />
                  )}
                  <div className="flex-between" style={{ flex: 1 }}>
                    <div>
                      <strong style={{ fontSize: "1.1rem" }}>{item.name}</strong>
                      {item.qty >= wholesaleRules.minQty && (
                        <span style={{ marginLeft: "10px", background: "#3b82f6", color: "white", padding: "2px 6px", borderRadius: "4px", fontSize: "0.7rem", fontWeight: "bold" }}>
                           MAYOREO -{wholesaleRules.discountPct}%
                        </span>
                      )}
                    </div>
                    <strong
                      style={{
                        color: "var(--color-secondary)",
                        fontSize: "1.1rem",
                      }}
                    >
                      ${((item.qty >= wholesaleRules.minQty ? item.price * (1 - wholesaleRules.discountPct/100) : item.price) * item.qty).toFixed(2)}
                    </strong>
                  </div>
                </div>
                <div className="flex-between" style={{ alignItems: "center" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      background: "rgba(255,255,255,0.1)",
                      padding: "5px",
                      borderRadius: "20px",
                    }}
                  >
                    <button
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "white",
                        cursor: "pointer",
                        padding: "0 10px",
                      }}
                      onClick={() => updateItemQty(item.id, item.qty - 1)}
                    >
                      -
                    </button>
                    <span>
                      {item.qty} {item.unit}
                    </span>
                    <button
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "white",
                        cursor: "pointer",
                        padding: "0 10px",
                      }}
                      onClick={() => updateItemQty(item.id, item.qty + 1)}
                    >
                      +
                    </button>
                  </div>
                  <button
                    style={{
                      background: "transparent",
                      border: "1px solid var(--color-primary)",
                      color: "var(--color-primary)",
                      cursor: "pointer",
                      padding: "5px 10px",
                      borderRadius: "6px",
                      fontSize: "0.8rem",
                    }}
                    onClick={() => removeItem(item.id)}
                  >
                    🔒 Eliminar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div
          style={{
            background: "rgba(255,255,255,0.05)",
            padding: "20px",
            borderRadius: "12px",
          }}
        >
          <div className="flex-between" style={{ marginBottom: "10px" }}>
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => applyDiscount("percent")}
                style={{
                  background: "transparent",
                  color: "var(--color-secondary)",
                  border: "none",
                  cursor: "pointer",
                  textDecoration: "underline",
                  fontSize: "0.9rem",
                }}
              >
                % Descuento [F4]
              </button>
              <button
                onClick={() => applyDiscount("fixed")}
                style={{
                  background: "transparent",
                  color: "var(--color-secondary)",
                  border: "none",
                  cursor: "pointer",
                  textDecoration: "underline",
                  fontSize: "0.9rem",
                }}
              >
                $ Cierre [F8]
              </button>
            </div>
            {activeTicket.discountPct > 0 && (
              <span
                style={{ color: "var(--color-primary)", fontWeight: "bold" }}
              >
                -{activeTicket.discountPct.toFixed(1)}%
              </span>
            )}
          </div>

          <div
            className="flex-between"
            style={{ marginBottom: "10px", color: "rgba(255,255,255,0.6)" }}
          >
            <span>Subtotal</span>
            <span>${subtotal.toFixed(2)}</span>
          </div>
          <div
            className="flex-between"
            style={{
              marginBottom: "20px",
              fontSize: "1.5rem",
              fontWeight: "bold",
              borderTop: "1px solid rgba(255,255,255,0.2)",
              paddingTop: "15px",
            }}
          >
            <span>TOTAL</span>
            <span style={{ color: "var(--color-secondary)" }}>
              ${finalTotal.toFixed(2)}
            </span>
          </div>
          <div style={{ marginBottom: "15px" }}>
            <select
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "8px",
                background: "rgba(0,0,0,0.3)",
                color: "white",
                border: "1px solid var(--color-primary)",
              }}
            >
              <option value="">-- Cliente de Mostrador (Sin Puntos) --</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (Pts: {c.points || 0})
                </option>
              ))}
            </select>
            {selectedCustomerId && customers.find(c => c.id === selectedCustomerId)?.points > 0 && (
              <button 
                onClick={async () => {
                   if (activeTicket.items.length === 0) return alert("Agrega artículos primero.");
                   const customer = customers.find(c => c.id === selectedCustomerId);
                   if (!customer || !customer.points) return;
                   const pointsToRedeemStr = window.prompt(`El cliente tiene ${customer.points} puntos.\nCanje de ${loyaltyRates.redeemRate} puntos = $1.00 de descuento.\n¿Cuántos puntos desea canjear?`);
                   if (!pointsToRedeemStr) return;
                   const pointsToRedeem = parseInt(pointsToRedeemStr, 10);
                   if (isNaN(pointsToRedeem) || pointsToRedeem <= 0) return;
                   if (pointsToRedeem > customer.points) return alert("El cliente no tiene suficientes puntos.");
                   
                   const discountAmount = pointsToRedeem / loyaltyRates.redeemRate;
                   if (discountAmount > finalTotal) return alert("El descuento no puede ser mayor al total de la cuenta.");

                   const { error } = await supabase.from("customers").update({ points: customer.points - pointsToRedeem }).eq("id", customer.id);
                   if (error) return alert("Error al descontar puntos.");

                   // Apply as a fixed discount item
                   setTickets(tickets.map(t => {
                     if (t.id === activeTicketId) {
                        return {
                           ...t,
                           items: [...t.items, {
                              id: "DESC-PUNTOS-" + Date.now(),
                              name: "Descuento por Puntos ERIKA",
                              qty: 1,
                              price: -discountAmount,
                              cost: 0,
                              unit: "PZA"
                           }]
                        }
                     }
                     return t;
                   }));

                   alert(`✅ Canje exitoso. Se descontaron ${pointsToRedeem} puntos y se aplicó un descuento de $${discountAmount.toFixed(2)}.`);
                   
                   // Reload customers to refresh points
                   const { data: custData } = await supabase.from("customers").select("*");
                   if (custData) setCustomers(custData);
                }}
                style={{
                  width: "100%",
                  marginTop: "10px",
                  padding: "8px",
                  borderRadius: "8px",
                  background: "linear-gradient(135deg, #f59e0b, #d97706)",
                  color: "white",
                  border: "none",
                  cursor: "pointer",
                  fontWeight: "bold"
                }}>
                🌟 Canjear Puntos de Lealtad
              </button>
            )}
          </div>

          <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
            <button
              className="btn-primary"
              style={{
                flex: 1,
                padding: "15px",
                background: "transparent",
                border: "1px solid var(--color-primary)",
              }}
              onClick={async () => {
                if (activeTicket.items.length === 0)
                  return alert("El ticket está vacío.");

                if (isOffline) {
                  // MODO OFFLINE: Guardar localmente
                  await saveTransactionOffline({
                    session_id: 0, // Mock id for offline
                    type: "sale",
                    amount: finalTotal,
                    description: `Venta Offline Ticket #${activeTicket.id}`,
                    device_info: navigator.userAgent,
                  });
                  alert(
                    `⚠️ ¡Cobro Exitoso en Efectivo (Modo Offline)!\nSe sincronizará con la nube cuando regrese el Internet.`,
                  );
                  updateOfflineStatus();
                } else {
                  // MODO ONLINE
                  const { data: session } = await supabase
                    .from("cash_sessions")
                    .select("*")
                    .eq("status", "open")
                    .order("opened_at", { ascending: false })
                    .limit(1)
                    .single();
                  if (!session)
                    return alert(
                      "❌ LA CAJA ESTÁ CERRADA. Ve al menú 'Arqueo de Caja' para iniciar tu turno y declarar el fondo inicial.",
                    );

                  const { error } = await supabase
                    .from("cash_transactions")
                    .insert({
                      session_id: session.id,
                      type: "sale",
                      amount: finalTotal,
                      description: `Venta Ticket #${activeTicket.id}${selectedCustomerId ? ` (Cliente ID: ${selectedCustomerId})` : ""}`,
                      device_info: navigator.userAgent,
                    });

                  if (error) return alert("Error al cobrar: " + error.message);

                  // Sumar Puntos si hay cliente (según configuración)
                  let puntosGanados = 0;
                  if (selectedCustomerId) {
                     const customer = customers.find(c => c.id === selectedCustomerId);
                     if (customer) {
                        puntosGanados = Math.floor(finalTotal / loyaltyRates.earnRate) * loyaltyRates.earnPoints;
                        if (puntosGanados > 0) {
                           await supabase.from("customers").update({ points: (customer.points || 0) + puntosGanados }).eq("id", selectedCustomerId);
                           alert(`⭐ El cliente ganó ${puntosGanados} Erika Puntos.`);
                        }
                     }
                  }
                  alert(
                    `✅ ¡Cobro Exitoso en Efectivo por $${finalTotal.toFixed(2)}!\nEl dinero ha sido ingresado a la Caja Fuerte.`,
                  );
                }

                setTickets(
                  tickets.map((t) =>
                    t.id === activeTicketId
                      ? { ...t, items: [], discountPct: 0 }
                      : t,
                  ),
                );
              }}
            >
              💰 Efectivo
            </button>
            <button
              className="btn-primary"
              style={{
                flex: 1,
                padding: "15px",
                background: "transparent",
                border: "1px solid #eab308",
                color: "#eab308",
              }}
              onClick={() => {
                if (activeTicket.items.length === 0)
                  return alert("El ticket está vacío.");
                if (isOffline)
                  return alert(
                    "❌ No puedes cobrar a crédito en Modo Offline por seguridad.",
                  );
                setShowCreditModal(true);
              }}
            >
              💳 Crédito
            </button>
          </div>
          <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
            <button
              className="btn-primary"
              style={{
                flex: 1,
                padding: "10px",
                background: "transparent",
                border: "1px solid #3b82f6",
                color: "#3b82f6",
              }}
              onClick={async () => {
                if (activeTicket.items.length === 0)
                  return alert("El ticket está vacío.");
                if (isOffline)
                  return alert(
                    "❌ Las cotizaciones requieren conexión a internet para guardarse.",
                  );
                const customerName = window.prompt(
                  "Nombre del cliente para la cotización:",
                );
                if (!customerName) return;

                const { error } = await supabase.from("quotes").insert({
                  customer_name: customerName,
                  items: activeTicket.items,
                  total: finalTotal,
                  status: "pending",
                });

                if (error)
                  return alert("Error al guardar cotización: " + error.message);
                alert("✅ Cotización guardada con éxito.");
                setTickets(
                  tickets.map((t) =>
                    t.id === activeTicketId
                      ? { ...t, items: [], discountPct: 0 }
                      : t,
                  ),
                );
              }}
            >
              📄 Guardar Cotización
            </button>
            <button
              className="btn-primary"
              style={{
                flex: 1,
                padding: "10px",
                background: "transparent",
                border: "1px solid #22c55e",
                color: "#22c55e",
              }}
              onClick={() => sendWhatsApp("quote")}
            >
              💬 Enviar Cotización por WhatsApp
            </button>
          </div>
          <button
            className="btn-primary"
            style={{
              width: "100%",
              marginTop: "10px",
              padding: "10px",
              background: "transparent",
              border: "1px solid #10b981",
              color: "#10b981",
            }}
            onClick={() => {
              if (activeTicket.items.length === 0) return alert("El ticket está vacío.");
              if (!selectedCustomerId) return alert("❌ Debes seleccionar un cliente para hacer un Apartado (Layaway).");
              // Open Layaway Creation Modal (mocked for now)
              const downPayment = parseFloat(window.prompt(`El total es $${finalTotal.toFixed(2)}.\n¿Cuánto dejará de enganche (Mínimo $${(finalTotal*0.1).toFixed(2)})?`) || "");
              if (isNaN(downPayment) || downPayment <= 0) return;
              if (downPayment > finalTotal) return alert("El enganche no puede ser mayor al total.");
              
              const makeLayaway = async () => {
                 const customer = customers.find(c => c.id === selectedCustomerId);
                 const { error } = await supabase.from("layaways").insert({
                    customer_id: selectedCustomerId,
                    customer_name: customer?.name || "Desconocido",
                    total_amount: finalTotal,
                    down_payment: downPayment,
                    balance: finalTotal - downPayment,
                    due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
                    items: activeTicket.items,
                    status: "pending"
                 });
                 if (error) return alert("Error al crear apartado: " + error.message);

                 // Reduce Inventory
                 for (const item of activeTicket.items) {
                    const invItem = globalCatalog.find(i => i.id === item.id); // note item.id from POS is sometimes random, should match properly by code or name
                    if (invItem) {
                       await supabase.from("inventory").update({ stock: invItem.stock - item.qty }).eq("name", item.name);
                    }
                 }

                 // Print Thermal Ticket for Layaway
                 const ticketWindow = window.open("", "_blank", "width=300,height=500");
                 if (ticketWindow) {
                   const itemsHtml = activeTicket.items
                     .map(
                       (item) => `
                         <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 5px;">
                           <div style="flex: 2;">${item.qty}x ${item.name}</div>
                           <div style="flex: 1; text-align: right;">$${(item.price * item.qty).toFixed(2)}</div>
                         </div>
                       `,
                     )
                     .join("");
                     
                   const ticketHtml = `
                     <html>
                       <head>
                         <style>
                           body { font-family: 'Courier New', Courier, monospace; margin: 0; padding: 10px; width: 58mm; color: #000; background: #fff; }
                           .center { text-align: center; }
                           .divider { border-bottom: 1px dashed #000; margin: 10px 0; }
                           .bold { font-weight: bold; }
                         </style>
                       </head>
                       <body>
                         <div class="center bold" style="font-size: 16px; margin-bottom: 5px;">FERRETERÍA ERIKA</div>
                         <div class="center" style="font-size: 12px;">Comprobante de Apartado</div>
                         <div class="divider"></div>
                         <div style="font-size: 12px; margin-bottom: 5px;">Fecha: ${new Date().toLocaleString()}</div>
                         <div style="font-size: 12px; margin-bottom: 5px;">Cliente: ${customer?.name || "Desconocido"}</div>
                         <div class="divider"></div>
                         ${itemsHtml}
                         <div class="divider"></div>
                         <div style="display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 5px;">
                           <div>Total Mercancía:</div>
                           <div class="bold">$${finalTotal.toFixed(2)}</div>
                         </div>
                         <div style="display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 5px;">
                           <div>Enganche Dado:</div>
                           <div class="bold">$${downPayment.toFixed(2)}</div>
                         </div>
                         <div style="display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 5px;">
                           <div>Saldo Pendiente:</div>
                           <div class="bold">$${(finalTotal - downPayment).toFixed(2)}</div>
                         </div>
                         <div class="divider"></div>
                         <div class="center bold" style="font-size: 12px; margin-bottom: 5px; color: red;">¡ATENCIÓN!</div>
                         <div class="center" style="font-size: 10px;">Vence: ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}</div>
                         <div class="center" style="font-size: 10px; margin-top: 5px;">Pasando esta fecha, la mercancía regresará a piso de ventas.</div>
                       </body>
                     </html>
                   `;
                   ticketWindow.document.write(ticketHtml);
                   ticketWindow.document.close();
                   setTimeout(() => {
                     ticketWindow.print();
                     ticketWindow.close();
                   }, 500);
                 }

                 alert(`✅ Apartado creado con éxito. Enganche de $${downPayment.toFixed(2)} registrado.\nTiene 30 días para liquidar el saldo de $${(finalTotal - downPayment).toFixed(2)}.`);
                 setTickets(tickets.map(t => t.id === activeTicketId ? { ...t, items: [], discountPct: 0 } : t));
              };
              makeLayaway();
            }}
          >
            📦 Sistema de Apartado (Layaway)
          </button>
        </div>
      </div>

      <PosCreditModal
        show={showCreditModal}
        onClose={() => setShowCreditModal(false)}
        finalTotal={finalTotal}
        customers={customers}
        activeTicketId={activeTicket.id}
        onSuccess={() => {
          setShowCreditModal(false);
          setTickets(
            tickets.map((t) =>
              t.id === activeTicketId ? { ...t, items: [], discountPct: 0 } : t,
            ),
          );
        }}
        reloadCustomers={async () => {
          const { data: custData } = await supabase
            .from("customers")
            .select("*");
          if (custData) setCustomers(custData);
        }}
      />
    </div>
  );
}
