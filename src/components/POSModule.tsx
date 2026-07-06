"use client";
import { useState, useEffect } from "react";
import { LoggerService } from "../services/loggerService";
import { Html5QrcodeScanner } from "html5-qrcode";
import { supabase } from "../lib/supabaseClient";
import toast from "react-hot-toast";
import {
  saveTransactionOffline,
  syncOfflineTransactions,
  getOfflineTransactions,
  saveInvoiceClaimOffline,
} from "../lib/offlineSync";
import PosScannerModal from "./PosScannerModal";
import PosCreditModal from "./PosCreditModal";
import { useAuth, useBusinessProfile } from "./AuthProvider";
import { CustomerSchema, CashSessionSchema } from "../lib/schemas";

interface POSItem {
  id: string;
  code?: string;
  name: string;
  price: number;
  cost: number;
  qty: number;
  unit: string;
  image_url?: string;
  discountPct?: number;
}

interface Ticket {
  id: number;
  items: POSItem[];
  discountPct: number;
}

const levenshtein = (a: string, b: string) => {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) matrix[i][j] = matrix[i - 1][j - 1];
      else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[a.length][b.length];
};

const getActiveDiscount = (item: any): number => {
  if (!item || !item.discount_pct || item.discount_pct <= 0) return 0;
  const now = new Date();
  if (item.discount_start_at && new Date(item.discount_start_at) > now) return 0;
  if (item.discount_end_at && new Date(item.discount_end_at) < now) return 0;
  return item.discount_pct;
};

const fuzzyMatch = (itemName: string, query: string) => {
  const itemWords = itemName.split(/\s+/);
  const queryWords = query.split(/\s+/);
  return queryWords.every(qw => {
    if (qw.length === 0) return true;
    return itemWords.some(iw => {
      if (iw.includes(qw)) return true;
      if (qw.length <= 3) return false;
      return levenshtein(iw, qw) <= 2;
    });
  });
};

// 🪙 Redondear al múltiplo de $0.50 más cercano (para facilitar operaciones en caja)
// Ejemplos: $12.10 → $12.00 | $12.30 → $12.50 | $12.80 → $13.00
const roundTo50 = (value: number): number => {
  return Math.round(value * 2) / 2;
};

// Formatear precio redondeado a 2 decimales en pantalla
const formatPrice = (value: number): string => {
  return roundTo50(value).toFixed(2);
};

const getItemFinalPrice = (item: any, wholesaleRules: any): number => {
  const isWholesale = item.qty >= wholesaleRules.minQty;
  const wholesaleDiscountPct = isWholesale ? (wholesaleRules.discountPct || 0) : 0;
  const productDiscountPct = item.discountPct || 0;
  const maxDiscountPct = Math.max(wholesaleDiscountPct, productDiscountPct);
  return item.price * (1 - maxDiscountPct / 100);
};

const SYNONYMS: Record<string, string[]> = {
  "pegamento": ["adhesivo", "resistol", "kola loka", "silicon", "cinta"],
  "pinza": ["alicate", "tenaza"],
  "desarmador": ["destornillador", "phillips", "plano"],
  "taquete": ["ramplug", "espiga", "anclaje"],
  "cinta": ["tape", "aislante", "teflon", "masking"],
  "foco": ["bombilla", "lampara", "led", "luminaria"],
  "taladro": ["rotomartillo", "perforadora"],
  "cable": ["alambre", "cordon", "thw"]
};

const renderHighlightedName = (name: string, query: string) => {
  const qLower = query.toLowerCase();
  if (name.toLowerCase().includes(qLower) && qLower.length > 0) {
    const idx = name.toLowerCase().indexOf(qLower);
    return (
      <>
        {name.substring(0, idx)}
        <span style={{ color: "var(--color-primary)", fontWeight: "bold" }}>{name.substring(idx, idx + query.length)}</span>
        {name.substring(idx + query.length)}
      </>
    );
  }
  
  const queryWords = qLower.split(/\s+/).filter(w => w.length > 0);
  if (queryWords.length === 0) return <>{name}</>;

  return name.split(" ").map((word, wIdx) => {
    const wLower = word.toLowerCase();
    let isFuzzy = false;
    let matchedQw = "";
    for (const qw of queryWords) {
      if (qw.length > 2 && levenshtein(wLower, qw) <= 2) {
        isFuzzy = true;
        matchedQw = qw;
        break;
      }
    }
    
    if (isFuzzy) {
      return (
        <span key={wIdx}>
          {word.split('').map((char, i) => {
            const isMatch = matchedQw.includes(char.toLowerCase());
            return (
              <span key={i} style={{ 
                color: isMatch ? "var(--color-primary)" : "#10b981", 
                fontWeight: "bold",
                background: isMatch ? "transparent" : "rgba(16, 185, 129, 0.2)",
                borderRadius: "2px"
              }}>
                {char}
              </span>
            );
          })}
          {wIdx < name.split(" ").length - 1 ? " " : ""}
        </span>
      );
    }
    return <span key={wIdx}>{word}{wIdx < name.split(" ").length - 1 ? " " : ""}</span>;
  });
};

export default function POSModule() {
  const { currentUser, businessSettings } = useAuth();
  const businessProfile = useBusinessProfile();
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

  useEffect(() => {
    if (typeof window !== "undefined") {
      const hasItems = tickets.some((t) => t.items && t.items.length > 0);
      (window as any).__ERIKA_HAS_ACTIVE_CART__ = hasItems;
    }
    return () => {
      if (typeof window !== "undefined") {
        delete (window as any).__ERIKA_HAS_ACTIVE_CART__;
      }
    };
  }, [tickets]);

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
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"efectivo" | "tarjeta" | "transferencia" | "mixto" | "credito">("efectivo");
  const [cashPayAmount, setCashPayAmount] = useState("");
  const [cardPayAmount, setCardPayAmount] = useState("");
  const [transferPayAmount, setTransferPayAmount] = useState("");
  const [applyIva, setApplyIva] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [paymentReference, setPaymentReference] = useState("");
  const [receiptToPrint, setReceiptToPrint] = useState<any>(null);
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  // Estados del Modal del PIN (Sugerencia 2)
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const [pinModalCallback, setPinModalCallback] = useState<((pin: string) => void) | null>(null);
  const [pinModalTitle, setPinModalTitle] = useState("AUTORIZACIÓN REQUERIDA");
  const [pinModalMessage, setPinModalMessage] = useState("");
  
  // Bitácora de Sincronización (Sugerencia 3)
  const [showSyncLogModal, setShowSyncLogModal] = useState(false);

  // Estados del Buscador y Registro de Clientes (Sugerencia 1 y 3)
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [showQuickCustomerModal, setShowQuickCustomerModal] = useState(false);
  const [quickCustomerName, setQuickCustomerName] = useState("");
  const [quickCustomerPhone, setQuickCustomerPhone] = useState("");
  const [isSavingQuickCustomer, setIsSavingQuickCustomer] = useState(false);

  // Estados para historial de compras del cliente (Sugerencia 1)
  const [showCustomerHistoryModal, setShowCustomerHistoryModal] = useState(false);
  const [customerHistoryTickets, setCustomerHistoryTickets] = useState<any[]>([]);
  const [isLoadingCustomerHistory, setIsLoadingCustomerHistory] = useState(false);
  const [historySearchTerm, setHistorySearchTerm] = useState("");

  useEffect(() => {
    if (selectedCustomerId) {
       const c = customers.find(cust => cust.id === selectedCustomerId);
       if (c) {
          setCustomerSearch(`${c.name} (Pts: ${c.points || 0})`);
       }
    } else {
       setCustomerSearch("");
    }
  }, [selectedCustomerId, customers]);

  const handleSaveQuickCustomer = async () => {
    if (!quickCustomerName.trim()) return alert("El nombre del cliente es obligatorio.");
    setIsSavingQuickCustomer(true);
    try {
      const { data, error } = await supabase.from("customers").insert({
        name: quickCustomerName.trim().toUpperCase(),
        phone: quickCustomerPhone.trim() || null,
        points: 0
      }).select().single();
      
      if (error) throw error;
      
      setCustomers(prev => [...prev, data]);
      setSelectedCustomerId(data.id);
      setCustomerSearch(`${data.name} (Pts: 0)`);
      
      toast.success("✅ Cliente registrado y seleccionado con éxito.");
      setShowQuickCustomerModal(false);
      setQuickCustomerName("");
      setQuickCustomerPhone("");
    } catch (err: any) {
      console.error("Error creating quick customer:", err);
      alert("❌ Error al crear cliente: " + err.message);
    } finally {
      setIsSavingQuickCustomer(false);
    }
  };

  const fetchCustomerHistory = async (customerId: string) => {
     if (!customerId) return;
     setIsLoadingCustomerHistory(true);
     setHistorySearchTerm("");
     try {
       // Query quotes with notes column fallback
       let { data, error } = await supabase
         .from("quotes")
         .select("id, created_at, total, items, notes")
         .eq("customer_id", customerId)
         .eq("status", "ticket")
         .order("created_at", { ascending: false })
         .limit(5);
       
       if (error) {
         console.warn("Falla al seleccionar notes, reintentando con fallback...");
         const fallback = await supabase
           .from("quotes")
           .select("id, created_at, total, items")
           .eq("customer_id", customerId)
           .eq("status", "ticket")
           .order("created_at", { ascending: false })
           .limit(5);
         if (fallback.error) throw fallback.error;
         data = fallback.data;
       }
       
       setCustomerHistoryTickets(data || []);
       setShowCustomerHistoryModal(true);
     } catch (err: any) {
       console.error("Error fetching customer history:", err);
       alert("❌ Error al cargar historial: " + err.message);
     } finally {
       setIsLoadingCustomerHistory(false);
     }
  };

  const cloneTicketItems = (itemsJson: any) => {
     let ticketItems = [];
     if (typeof itemsJson === "string") {
        try { ticketItems = JSON.parse(itemsJson); } catch { ticketItems = []; }
     } else {
        ticketItems = Array.isArray(itemsJson) ? itemsJson : [];
     }
     
     if (ticketItems.length === 0) return alert("Este ticket no contiene productos válidos.");
     
     const adjustedMsg = [];
     const newItems: POSItem[] = [];
     
     // Validación de Stock en tiempo real al clonar (Sugerencia 1)
     for (const item of ticketItems) {
        const invItem = globalCatalog.find(i => i.name === item.name || (i.code && i.code === item.code));
        let qtyToLoad = item.qty;
        
        if (invItem) {
           if (invItem.stock <= 0) {
              adjustedMsg.push(`⚠️ "${item.name}" no tiene existencias (sin stock). No se agregó.`);
              continue;
           } else if (invItem.stock < item.qty) {
              adjustedMsg.push(`⚠️ "${item.name}" ajustado de ${item.qty} a ${invItem.stock} unidades (límite de stock).`);
              qtyToLoad = invItem.stock;
           }
        }
        
        newItems.push({
           id: `${item.id || "cloned"}-${Date.now()}-${Math.random()}`,
           code: item.code || "",
           name: item.name,
           price: item.price,
           cost: item.cost || 0,
           qty: qtyToLoad,
           unit: item.unit || "PZA",
           discountPct: item.discountPct || 0
        });
     }
     
     if (newItems.length === 0) {
        return alert("❌ Ningún producto del ticket histórico tiene existencias disponibles para ser agregado.");
     }
     
     setTickets(tickets.map(t => {
       if (t.id === activeTicketId) {
         return {
           ...t,
           items: [...t.items, ...newItems]
         };
       }
       return t;
     }));
     
     if (adjustedMsg.length > 0) {
        alert(`🛒 Productos cargados con ajustes de stock:\n\n${adjustedMsg.join("\n")}`);
     } else {
        toast.success("🛒 Productos cargados al ticket actual.");
     }
     setShowCustomerHistoryModal(false);
  };

  const handleReprintHistoryTicket = (ticket: any) => {
     let ticketItems = [];
     if (typeof ticket.items === "string") {
        try { ticketItems = JSON.parse(ticket.items); } catch { ticketItems = []; }
     } else {
        ticketItems = Array.isArray(ticket.items) ? ticket.items : [];
     }
     
     triggerPrint({
        type: "ticket",
        data: {
           realTicketId: ticket.id,
           items: ticketItems,
           finalTotal: ticket.total
        }
     });
     toast.success(`🖨️ Reenviando Ticket #${ticket.id} a la cola de impresión.`);
  };

  const handleSaveTicketNote = async (ticketId: number, currentNotes: string) => {
     const newNotes = window.prompt("Escribe una nota para este ticket:", currentNotes || "");
     if (newNotes === null) return;
     
     const { error } = await supabase
       .from("quotes")
       .update({ notes: newNotes.trim() })
       .eq("id", ticketId);
       
     if (error) {
       console.warn("Falla al guardar nota en quotes, reintentando con description...");
       const { error: fallbackError } = await supabase
         .from("quotes")
         .update({ description: newNotes.trim() })
         .eq("id", ticketId);
         
       if (fallbackError) {
         return alert("❌ Error al guardar nota: " + fallbackError.message);
       }
     }
     
     setCustomerHistoryTickets(prev => 
       prev.map(t => t.id === ticketId ? { ...t, notes: newNotes.trim() } : t)
     );
     toast.success("✅ Nota de ticket actualizada.");
  };

  const requestPin = (title: string, message: string, callback: (pin: string) => void) => {
    setPinModalTitle(title);
    setPinModalMessage(message);
    setPinValue("");
    setPinModalCallback(() => callback);
    setShowPinModal(true);
  };

  const getPinAsync = (title: string, message: string): Promise<string> => {
    return new Promise((resolve) => {
      requestPin(title, message, (pin) => {
        resolve(pin);
      });
    });
  };

  // Printer Connection States
  const [isPrinterConnected, setIsPrinterConnected] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("ERIKA_PRINTER_CONNECTED") !== "false";
    }
    return true;
  });
  const [printerConnectionType, setPrinterConnectionType] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("ERIKA_PRINTER_TYPE") || "system";
    }
    return "system";
  });
  const [silentKiosk, setSilentKiosk] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("ERIKA_PRINTER_SILENT_KIOSK") === "true";
    }
    return false;
  });
  const [pendingPrintJob, setPendingPrintJob] = useState<any>(null);
  const [showPrinterModal, setShowPrinterModal] = useState<boolean>(false);
  const [isReconnecting, setIsReconnecting] = useState<boolean>(false);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const playSuccessBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.15);
    } catch (e) {
      console.error("Audio no soportado");
    }
  };

  const normalizeString = (str: string) => {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  };

  const searchNormalized = normalizeString(searchInput);
  const queryWords = searchNormalized.split(/\s+/).filter(w => w.length > 0);
  
  const expandedQueryWords = [...queryWords];
  queryWords.forEach(qw => {
    if (SYNONYMS[qw]) expandedQueryWords.push(...SYNONYMS[qw]);
  });

  const filteredCatalog = searchInput.length > 1 ? globalCatalog.map(c => {
    const nameNorm = normalizeString(c.name);
    const codeNorm = c.code ? normalizeString(c.code) : "";
    let score = 0;
    
    if (nameNorm.includes(searchNormalized) || codeNorm.includes(searchNormalized)) {
      score = 100;
    } else {
      expandedQueryWords.forEach(qw => {
        if (nameNorm.includes(qw)) {
          score += 50;
        } else if (qw.length > 3 && fuzzyMatch(nameNorm, qw)) {
          score += 30;
        }
      });
    }
    
    return { ...c, __score: score };
  }).filter(c => c.__score > 0)
    .sort((a, b) => b.__score - a.__score)
    .slice(0, 15) : [];

  const activeTicket =
    tickets.find((t) => t.id === activeTicketId) || tickets[0];

  const [invoiceToken, setInvoiceToken] = useState("");

  useEffect(() => {
    const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    setInvoiceToken(`FAC-${activeTicketId}-${uuid}`);
  }, [activeTicketId, activeTicket.items.length === 0]);

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

    const handleSWMessage = async (event: MessageEvent) => {
      if (event.data && event.data.type === "SYNC_SALES") {
         console.log("Service Worker solicitó sincronización de ventas...");
         const synced = await syncOfflineTransactions();
         if (synced > 0) {
            toast.success(`✅ ${synced} ventas offline sincronizadas con éxito.`);
            updateOfflineStatus();
         }
      }
    };

    if ("serviceWorker" in navigator) {
       navigator.serviceWorker.addEventListener("message", handleSWMessage);
    }

    return () => {
      window.removeEventListener("online", updateOfflineStatus);
      window.removeEventListener("offline", updateOfflineStatus);
      if ("serviceWorker" in navigator) {
         navigator.serviceWorker.removeEventListener("message", handleSWMessage);
      }
    };
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("ERIKA_VOICE_KEYWORD");
    if (saved) setSecurityKeyword(saved.toLowerCase());

    const fetchInventoryAndCustomers = async () => {
      let allData: any[] = [];
      let from = 0;
      const limit = 1000;
      let hasMore = true;
      let lastError = null;

      while (hasMore) {
        const { data, error } = await supabase
          .from("inventory")
          .select("*")
          .range(from, from + limit - 1);

        if (error) {
          lastError = error;
          hasMore = false;
        } else if (data && data.length > 0) {
          allData = [...allData, ...data];
          if (data.length < limit) {
            hasMore = false;
          } else {
            from += limit;
          }
        } else {
          hasMore = false;
        }
      }

      if (lastError) {
        console.error("Error al cargar inventario:", lastError);
        LoggerService.logError("POSModule_fetchInventory", lastError);
        toast.error(`Error al cargar catálogo de inventario: ${lastError.message}`);
      } else if (allData.length > 0) {
        setGlobalCatalog(allData);
      }

      let { data: custData, error: custError } = await supabase.from("customers").select("*").not("deleted", "eq", true);
      if (custError) {
        console.warn("Fallo el filtro de base de datos 'deleted' en clientes, usando fallback local:", custError.message);
        const fallback = await supabase.from("customers").select("*");
        if (fallback.error) {
          console.error("Error al cargar clientes (fallback):", fallback.error);
          LoggerService.logError("POSModule_fetchCustomers_fallback", fallback.error);
          toast.error(`Error al cargar lista de clientes: ${fallback.error.message}`);
        } else if (fallback.data) {
          custData = fallback.data.filter((c: any) => c.deleted !== true);
          custError = null;
        }
      }
      if (!custError && custData) {
        const validated = custData.map((item: any) => {
          const result = CustomerSchema.safeParse(item);
          if (!result.success) {
            console.error("Error de validacion Zod en cliente de caja:", result.error);
            return {
              id: item.id || String(Math.random()),
              name: item.name || "Cliente Invalido",
              phone: item.phone || "",
              rfc: item.rfc || "",
              email: item.email || "",
              company_name: item.company_name || "",
              credit_limit: Number(item.credit_limit) || 0,
              balance: Number(item.balance) || 0,
              points: Number(item.points) || 0,
              deleted: item.deleted === true
            };
          }
          return result.data;
        });
        setCustomers(validated);
      }
    };

    const restoreQuote = () => {
       const saved = localStorage.getItem("ERIKA_RESTORE_QUOTE");
       if (saved) {
          try {
             const items = JSON.parse(saved);
             if (items && items.length > 0) {
                setTickets([{ id: 1, items, discountPct: 0 }]);
                setActiveTicketId(1);
                
                // Restablecer cliente si existe
                const savedCustId = localStorage.getItem("ERIKA_RESTORE_CUSTOMER_ID");
                if (savedCustId) {
                   setSelectedCustomerId(savedCustId);
                   localStorage.removeItem("ERIKA_RESTORE_CUSTOMER_ID");
                }
                
                localStorage.removeItem("ERIKA_RESTORE_QUOTE");
                alert("✅ Cotización cargada en la caja exitosamente.");
             }
          } catch(e) {}
       }
    };

    fetchInventoryAndCustomers();
    restoreQuote();
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
          if (matched.stock <= matched.minStock)
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

  // Efecto para procesar impresión del sistema en ventana principal (evita bloqueadores de popups)
  useEffect(() => {
    if (receiptToPrint) {
      const timer = setTimeout(() => {
        window.print();
        setReceiptToPrint(null);
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [receiptToPrint]);

  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (filteredCatalog.length > 0) {
      const c = filteredCatalog[focusedIndex >= 0 ? focusedIndex : 0];
      if (c.stock <= 0) {
        if (window.confirm(`El producto "${c.name}" está AGOTADO. ¿Deseas registrarlo en el Radar de Demanda (Ventas Perdidas)?`)) {
          supabase.from("lost_sales_requests").insert({ term: c.name, type: "AGOTADO" }).then(async () => {
            await supabase.from("internal_tasks").insert({
              title: `Reabastecer urgencia: ${c.name}`,
              assigned_to: "Administrador",
              status: "pending",
              created_by: "Caja"
            });
            alert("✅ Registrado en el radar de demanda.");
          });
        }
      } else {
        addToCart(c.name, c.price, "pz", c.cost, 1, c.image_url);
      }
      setSearchInput("");
      setShowAutocomplete(false);
      setFocusedIndex(-1);
    } else if (searchInput.trim() !== "") {
      supabase.from("lost_sales_requests").insert({ term: searchInput, type: "NUEVO_PRODUCTO" }).then(() => {
        alert(`✅ "${searchInput}" registrado en el reporte de productos solicitados.`);
        setSearchInput("");
        setShowAutocomplete(false);
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showAutocomplete || filteredCatalog.length === 0) {
      if (e.key === "Enter" && searchInput.trim() !== "") {
        e.preventDefault();
        handleSearchSubmit(e as any);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex(prev => (prev < filteredCatalog.length - 1 ? prev + 1 : prev));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex(prev => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSearchSubmit(e as any);
    } else if (e.key === "Escape") {
      setShowAutocomplete(false);
      setFocusedIndex(-1);
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
    // Check stock warning when adding product (Sugerencia 1)
    const invItem = globalCatalog.find(i => i.name === productName);
    if (invItem) {
       if (addedQty > invItem.stock) {
          toast.error(`⚠️ Existencias insuficientes para "${productName}". Se requerirá PIN de Administrador para cobrar.`);
       } else if (invItem.stock > 0 && invItem.stock <= 5) {
          toast(`⚠️ Stock bajo para "${productName}": quedan sólo ${invItem.stock} unidades.`, { icon: '⚠️' });
       }
    }

    const itemDiscountPct = invItem ? getActiveDiscount(invItem) : 0;

    // Client price history logic
    if (selectedCustomerId) {
       const historyStr = localStorage.getItem(`ERIKA_CLIENT_HISTORY_${selectedCustomerId}`) || "{}";
       const historyObj = JSON.parse(historyStr);
       historyObj[productName] = price;
       localStorage.setItem(`ERIKA_CLIENT_HISTORY_${selectedCustomerId}`, JSON.stringify(historyObj));
    }

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
                discountPct: itemDiscountPct,
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

    // Check if increasing qty exceeds stock to show toast warning (Sugerencia 1)
    const currentTicket = tickets.find(t => t.id === activeTicketId);
    if (currentTicket) {
      const item = currentTicket.items.find(i => i.id === itemId);
      if (item) {
        const invItem = globalCatalog.find(i => i.name === item.name);
        if (invItem) {
           if (newQty > invItem.stock && newQty > item.qty) {
              toast.error(`⚠️ Existencias insuficientes para "${item.name}". Se requerirá PIN de Administrador para cobrar.`);
           } else if (invItem.stock > 0 && invItem.stock <= 5 && newQty > item.qty) {
              toast(`⚠️ Stock bajo para "${item.name}": quedan sólo ${invItem.stock} unidades.`, { icon: '⚠️' });
           }
        }
      }
    }

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
    if (currentUser?.role !== "admin") {
       const pass = window.prompt("🔒 ACCESO RESTRINGIDO: Contraseña de Administrador requerida:");
       const { data: admin } = await supabase.from("users").select("*").eq("pin", pass).eq("role", "admin").single();
       if (!admin) return alert("❌ PIN incorrecto o sin privilegios.");
    }

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

  const applyItemDiscount = async (itemId: string) => {
     const ticket = tickets.find(t => t.id === activeTicketId);
     if (!ticket) return;
     const item = ticket.items.find(i => i.id === itemId);
     if (!item) return;
     
     const pctStr = window.prompt(`Ingresa el % de descuento para "${item.name}":`, String(item.discountPct || ""));
     if (pctStr === null) return;
     const pct = parseFloat(pctStr) || 0;
     if (isNaN(pct) || pct < 0 || pct > 100) return alert("Porcentaje no válido");
     
     const maxCajeroDiscount = businessSettings?.config?.max_cajero_discount_pct ?? 5;
     
     // Calcular precio propuesto y margen de costo + 3% (Sugerencia 3)
     let basePrice = item.price;
     if (item.qty >= wholesaleRules.minQty) {
        basePrice = item.price * (1 - wholesaleRules.discountPct / 100);
     }
     const proposedPrice = basePrice * (1 - pct / 100);
     const minSafePrice = item.cost * 1.03; // Costo + 3% de margen mínimo
     
     const requiresPin = pct > maxCajeroDiscount || proposedPrice < minSafePrice;
     
     // PIN Override si excede descuento autónomo o el margen mínimo (Sugerencia 3)
     if (requiresPin) {
       if (currentUser?.role !== "admin") {
          let reason = `El descuento del ${pct}% para "${item.name}" supera el ${maxCajeroDiscount}% permitido.`;
          if (proposedPrice < minSafePrice) {
             reason = `⚠️ MARGEN CRÍTICO DETECTADO: El precio final ($${proposedPrice.toFixed(2)}) es inferior al costo mínimo seguro con utilidad del 3% ($${minSafePrice.toFixed(2)}).`;
          }
          
          const pin = await getPinAsync(
            "⚠️ AUTORIZACIÓN REQUERIDA",
            `${reason}\n\nIngresa el PIN de Administrador para autorizar:`
          );
          if (!pin) return;
          const { data: admin } = await supabase.from("users").select("*").eq("pin", pin).eq("role", "admin").single();
          if (!admin) return alert("❌ PIN incorrecto o sin privilegios de administrador. Descuento denegado.");
       }
     }
     
     setTickets(tickets.map(t => {
       if (t.id === activeTicketId) {
         return {
           ...t,
           items: t.items.map(i => i.id === itemId ? { ...i, discountPct: pct } : i)
         };
       }
       return t;
     }));
  };

  const applyDiscount = async (mode: "percent" | "fixed") => {
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
      if (currentUser?.role !== "admin") {
         const pin = window.prompt("⚠️ Descuento mayor al 5%. Requiere PIN de administrador:");
         const { data: admin } = await supabase.from("users").select("*").eq("pin", pin).eq("role", "admin").single();
         if (!admin) return alert("❌ PIN incorrecto o sin privilegios. Descuento denegado.");
      }
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
          if (fragment.includes("cuatro")) qty = 4;
          if (fragment.includes("cinco")) qty = 5;
        }

        // Algoritmo de scoring inteligente para emparejar productos
        let matchedProduct = null;
        let highestScore = 0;
        
        // Limpiamos y dividimos la frase en palabras significativas
        const fWords = fragment.toLowerCase()
          .replace(new RegExp(securityKeyword, 'g'), "") // Quitamos la palabra clave
          .replace(/[^a-z0-9áéíóúñ\s]/g, "") // Limpieza especial español
          .split(/\s+/)
          .filter((w: string) => w.length > 1 && w !== "un" && w !== "una" && w !== "dos" && w !== "tres" && w !== "agrega" && w !== "agregar" && w !== "de" && w !== "con");

        for (const prod of globalCatalog) {
          const pNameClean = prod.name.toLowerCase().replace(/[^a-z0-9áéíóúñ\s]/g, "");
          const pWords = pNameClean.split(/\s+/).filter((w: string) => w.length > 1);
          if (prod.code) {
             const codeClean = prod.code.toLowerCase().replace(/[^a-z0-9áéíóúñ\s]/g, "");
             pWords.push(...codeClean.split(/\s+/));
          }
          
          let matches = 0;
          let exactMatches = 0;
          
          for (const pw of pWords) {
            // Coincidencia exacta de la palabra del producto en el comando de voz
            if (fWords.includes(pw)) {
              matches += 1;
              exactMatches += 1;
            } else {
              // Coincidencia difusa de palabras de más de 3 letras
              for (const fw of fWords) {
                if (pw.length > 3 && fw.length > 3) {
                  if (Math.abs(pw.length - fw.length) <= 1) {
                    let diffs = 0;
                    for (let i = 0; i < Math.min(pw.length, fw.length); i++) {
                      if (pw[i] !== fw[i]) diffs++;
                    }
                    if (diffs <= 1) {
                      matches += 0.8;
                      break;
                    }
                  }
                }
              }
            }
          }

          if (matches > 0) {
            // Puntuación: prioriza coincidencias múltiples y cobertura del nombre
            const coverage = matches / pWords.length;
            const score = matches * 10 + exactMatches * 5 + coverage * 15;
            
            if (score > highestScore) {
              highestScore = score;
              matchedProduct = prod;
            }
          }
        }

        // Umbral de seguridad para considerar un acierto (al menos 1 coincidencia sólida)
        if (matchedProduct && highestScore > 6) {
          playSuccessBeep();
          setSearchInput(matchedProduct.name);
          setShowAutocomplete(true);
          voiceReply += `Busqué ${matchedProduct.name}. Selecciónalo en la lista. `;
          nothingFound = false;
        }
      });

      if (nothingFound) speak("No encontré artículos válidos.");
      else speak("Autorizado. " + voiceReply);
    };

    recognition.start();
  };

  const handleCheckoutSubmit = async (selectedMethod: "efectivo" | "tarjeta" | "transferencia" | "mixto", cashAmt: number, cardAmt: number, transferAmt: number, reference: string) => {
    if (activeTicket.items.length === 0)
      return alert("El ticket está vacío.");

    const totalAmt = finalTotal;
    setIsProcessingPayment(true);

    // 3. Validación de Stock Estricta
    if (!isOffline) {
      const itemsExceedingStock = activeTicket.items.filter(item => {
         const invItem = globalCatalog.find(i => i.name === item.name);
         return invItem && item.qty > invItem.stock;
      });

      if (itemsExceedingStock.length > 0) {
         const itemNames = itemsExceedingStock.map(i => `• ${i.name} (Venta: ${i.qty}, Stock: ${globalCatalog.find(cat => cat.name === i.name)?.stock || 0})`).join("\n");
         
         const pin = await getPinAsync(
           "⚠️ STOCK INSUFICIENTE",
           `Los siguientes artículos superan las existencias físicas en inventario:\n${itemNames}\n\nIngresa el PIN de Administrador para autorizar:`
         );
         if (!pin) {
            setIsProcessingPayment(false);
            return;
         }
         
         const { data: admin, error: adminErr } = await supabase
           .from("users")
           .select("*")
           .eq("pin", pin)
           .eq("role", "admin")
           .single();
           
         if (adminErr || !admin) {
            alert("❌ PIN incorrecto o sin privilegios de administrador. Cobro cancelado.");
            setIsProcessingPayment(false);
            return;
         }
      }
    }

    try {
      if (isOffline) {
        await saveTransactionOffline({
          session_id: 0,
          type: "sale",
          amount: totalAmt,
          description: `Venta Offline Ticket #${activeTicket.id} [Método: ${selectedMethod}]`,
          device_info: navigator.userAgent,
          items: activeTicket.items.map(item => {
             const invItem = globalCatalog.find(i => i.name === item.name);
             return { id: invItem ? invItem.id : null, qty: item.qty };
          }).filter(item => item.id !== null)
        });
        alert(
          `⚠️ ¡Cobro Exitoso en ${selectedMethod.toUpperCase()} (Modo Offline)!\nSe sincronizará con la nube cuando regrese el Internet.`,
        );
        updateOfflineStatus();
      } else {
        const { data: rawSession } = await supabase
          .from("cash_sessions")
          .select("*")
          .eq("status", "open")
          .order("opened_at", { ascending: false })
          .limit(1)
          .single();
        
        let session = null;
        if (rawSession) {
          const result = CashSessionSchema.safeParse(rawSession);
          if (!result.success) {
            console.error("Error validando sesion de caja con Zod:", result.error);
            session = rawSession; // Fallback
          } else {
            session = result.data;
          }
        }

        if (!session) {
          setIsProcessingPayment(false);
          return alert(
            "❌ LA CAJA ESTÁ CERRADA. Ve al menú 'Arqueo de Caja' para iniciar tu turno y declarar el fondo inicial.",
          );
        }

        const descriptionText = `Venta Ticket #${activeTicket.id}${selectedCustomerId ? ` (Cliente ID: ${selectedCustomerId})` : ""} [METODO:${selectedMethod}] [CASH:${cashAmt}] [CARD:${cardAmt}] [TRANS:${transferAmt}] [COSTO:${totalCost.toFixed(2)}]${reference ? ` [REF:${reference}]` : ""}`;

        const { error } = await supabase
          .from("cash_transactions")
          .insert({
            session_id: session.id,
            type: "sale",
            amount: totalAmt,
            description: descriptionText,
            device_info: navigator.userAgent,
            payment_method: selectedMethod,
            cash_amount: cashAmt,
            card_amount: cardAmt,
            transfer_amount: transferAmt
          });

        if (error) {
          console.warn("Falla al insertar nuevas columnas de método de pago, reintentando con fallback...");
          const { error: fallbackError } = await supabase
            .from("cash_transactions")
            .insert({
              session_id: session.id,
              type: "sale",
              amount: totalAmt,
              description: descriptionText,
              device_info: navigator.userAgent
            });
          
          if (fallbackError) {
            setIsProcessingPayment(false);
            return alert("Error al cobrar: " + fallbackError.message);
          }
        }

        let realTicketId = Date.now();
        
        // Registrar en quotes (completamente aislado)
        try {
          const insertObj = {
             customer_name: selectedCustomerId ? (customers.find(c => c.id === selectedCustomerId)?.name || "Venta Registrada") : "Venta Mostrador",
             customer_id: selectedCustomerId || null,
             items: activeTicket.items,
             total: totalAmt,
             status: "ticket",
             notes: `Pago: ${selectedMethod.toUpperCase()}${reference ? ` (Ref: ${reference})` : ""}`
          };
          const { data: quoteData, error: quoteErr } = await supabase.from("quotes").insert(insertObj).select("id").single();

          if (quoteErr) {
             console.warn("Falla al insertar quotes con notes, reintentando con fallback...");
             delete (insertObj as any).notes;
             const fallback = await supabase.from("quotes").insert(insertObj).select("id").single();
             if (fallback.data) {
                realTicketId = fallback.data.id;
             }
          } else if (quoteData) {
             realTicketId = quoteData.id;
          }

          if (quoteData) {
             realTicketId = quoteData.id;
             
             // Registrar en invoice_claims (completamente aislado)
             try {
                const { error: insertErr } = await supabase.from("invoice_claims").insert({
                   ticket_id: realTicketId,
                   token: invoiceToken,
                   claimed: false
                });
                if (insertErr) {
                   console.warn("Error insertando claim en la nube, guardando offline:", insertErr);
                   saveInvoiceClaimOffline({
                      ticket_id: realTicketId,
                      token: invoiceToken,
                      claimed: false
                   }).catch(idbErr => console.error("Fallo al guardar reclamo offline en IndexedDB:", idbErr));
                }
             } catch (err) {
                console.warn("No se pudo registrar token de facturacion en invoice_claims, guardando offline:", err);
                saveInvoiceClaimOffline({
                   ticket_id: realTicketId,
                   token: invoiceToken,
                   claimed: false
                }).catch(idbErr => console.error("Fallo al guardar reclamo offline en IndexedDB:", idbErr));
             }
          }
        } catch (quoteErr) {
          console.error("Error al registrar el ticket en quotes:", quoteErr);
        }

        // Puntos de lealtad (completamente aislado)
        let puntosGanados = 0;
        if (selectedCustomerId) {
           try {
              const customer = customers.find(c => c.id === selectedCustomerId);
              if (customer) {
                 puntosGanados = Math.floor(totalAmt / loyaltyRates.earnRate) * loyaltyRates.earnPoints;
                 if (puntosGanados > 0) {
                    await supabase.from("customers").update({ points: (customer.points || 0) + puntosGanados }).eq("id", selectedCustomerId);
                    alert(`⭐ El cliente ganó ${puntosGanados} Erika Puntos.`);
                 }
              }
           } catch (ptsErr) {
              console.error("Error al actualizar puntos de cliente:", ptsErr);
           }
        }

        // Reduce Inventory (Descontar existencias de Supabase mediante RPC o manual)
        try {
          const { error: rpcErr } = await supabase.rpc("reduce_inventory_stock", {
             items: activeTicket.items.map(item => {
                const invItem = globalCatalog.find(i => i.name === item.name);
                return { id: invItem ? invItem.id : null, qty: item.qty };
             }).filter(item => item.id !== null),
             ref_id: realTicketId.toString(),
             user_name: currentUser?.name || "Venta Mostrador",
             move_type: "sale"
          });

          if (rpcErr) {
             console.warn("Falla al llamar RPC reduce_inventory_stock, reintentando con fallback manual...", rpcErr);
             for (const item of activeTicket.items) {
                const invItem = globalCatalog.find(i => i.name === item.name);
                if (invItem) {
                   await supabase
                     .from("inventory")
                     .update({ stock: invItem.stock - item.qty })
                     .eq("id", invItem.id);
                }
             }
          }
        } catch (invErr) {
          console.error("Error crítico al actualizar inventario:", invErr);
        }

        alert(
          `✅ ¡Cobro Exitoso por $${totalAmt.toFixed(2)} [Método: ${selectedMethod.toUpperCase()}]!\nEl dinero ha sido ingresado a la Caja.`,
        );

        // Impresión (completamente aislado)
        try {
          triggerPrint({
            type: "ticket",
            data: {
              realTicketId,
              items: [...activeTicket.items],
              finalTotal: totalAmt,
              paymentMethod: selectedMethod
            }
          });
        } catch (printErr) {
          console.error("Error al disparar la impresion:", printErr);
        }

        // WhatsApp option (Sugerencia 3)
        const sendWpp = confirm("¿Deseas enviar el comprobante de compra digital por WhatsApp al cliente?");
        if (sendWpp) {
          sendWhatsApp("receipt");
        }
        setPaymentReference("");
      }

      // Update local state globalCatalog (Descontar existencias localmente)
      setGlobalCatalog(prevCatalog =>
        prevCatalog.map(invItem => {
           const soldItem = activeTicket.items.find(item => item.name === invItem.name);
           if (soldItem) {
              return { ...invItem, stock: invItem.stock - soldItem.qty };
           }
           return invItem;
        })
      );

      // Proceso de éxito: limpiar tickets y cerrar modal
      setTickets(
        tickets.map((t) =>
          t.id === activeTicketId
            ? { ...t, items: [], discountPct: 0 }
            : t
        )
      );
      setShowCheckoutModal(false);
    } catch (criticalErr: any) {
      console.error("Error crítico inesperado en handleCheckoutSubmit:", criticalErr);
      alert("❌ Error crítico al procesar el pago: " + (criticalErr.message || criticalErr));
    } finally {
      setIsProcessingPayment(false);
    }
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
    const p = getItemFinalPrice(item, wholesaleRules);
    return sum + p * item.qty;
  }, 0);
  
  const totalCost = activeTicket.items.reduce((sum, item) => sum + (item.cost * item.qty), 0);
  
  // Ahorro por productos individual con descuento (Sugerencia 2)
  const itemDiscountsSavings = activeTicket.items.reduce((sum, item) => {
    const pNormal = item.qty >= wholesaleRules.minQty ? item.price * (1 - wholesaleRules.discountPct / 100) : item.price;
    const pDiscounted = getItemFinalPrice(item, wholesaleRules);
    return sum + (pNormal - pDiscounted) * item.qty;
  }, 0);
  
  const discountAmount = rawTotal * (activeTicket.discountPct / 100);
  const subtotalNeto = rawTotal - discountAmount;
  const iva = applyIva ? subtotalNeto * 0.16 : 0;
  const finalTotal = subtotalNeto + iva;
  const subtotal = subtotalNeto;

  const executePrintWindow = (job: any) => {
    // Si la impresora configurada es del sistema, redireccionar al flujo nativo sin popup
    if (printerConnectionType === "system") {
      if (job.type === "ticket") {
        const { realTicketId, items, finalTotal, paymentMethod } = job.data;
        const subtotalVal = items.reduce((sum: number, item: any) => {
           const p = getItemFinalPrice(item, wholesaleRules);
           return sum + (p * item.qty);
        }, 0);
        const discountPct = activeTicket.discountPct || 0;
        const discountAmt = subtotalVal * (discountPct / 100);
        const subtotalNeto = subtotalVal - discountAmt;
        const iva = applyIva ? subtotalNeto * 0.16 : 0;

        setReceiptToPrint({
          type: "ticket",
          ticketId: realTicketId,
          customerName: customers.find(c => c.id === selectedCustomerId)?.name || "",
          items: [...items],
          subtotal: subtotalNeto,
          iva,
          discountPct,
          discountAmount: discountAmt,
          finalTotal: finalTotal,
          invoiceToken: realTicketId,
          paymentMethod
        });
      } else if (job.type === "layaway") {
        const { customer, items, finalTotal, downPayment } = job.data;
        const subtotalVal = items.reduce((sum: number, item: any) => {
           const p = getItemFinalPrice(item, wholesaleRules);
           return sum + (p * item.qty);
        }, 0);
        const discountPct = activeTicket.discountPct || 0;
        const discountAmt = subtotalVal * (discountPct / 100);
        const subtotalNeto = subtotalVal - discountAmt;
        const iva = applyIva ? subtotalNeto * 0.16 : 0;

        setReceiptToPrint({
          type: "layaway",
          customerName: customer?.name || "Desconocido",
          items: [...items],
          subtotal: subtotalNeto,
          iva,
          discountPct,
          discountAmount: discountAmt,
          finalTotal,
          downPayment,
          balance: finalTotal - downPayment
        });
      }
      return;
    }

    const config = businessSettings?.config || {};
    const paperSize = config.printer_paper_size || "80mm";
    const fontSize = config.printer_font_size || "normal";
    const fontFamily = config.printer_font_family || "monospace";
    const fields = config.printer_fields || ["name", "rfc", "phone", "address", "logo", "footer"];
    const footerMsg = config.printer_footer_msg || "¡Gracias por su compra!";
    const marginAlign = config.printer_align || "center";
    const marginPadding = config.printer_padding || "8";

    const widthCss = paperSize === "58mm" ? "58mm" : "80mm";
    const fontSizeCss = fontSize === "small" ? "10px" : fontSize === "large" ? "14px" : "12px";
    let fontFamilyCss = "monospace";
    if (fontFamily === "sans-serif") fontFamilyCss = "sans-serif";
    else if (fontFamily === "serif") fontFamilyCss = "serif";

    const showLogo = fields.includes("logo") && (businessProfile.logo || config.business_logo);
    const showName = fields.includes("name");
    const showRfc = fields.includes("rfc") && (businessProfile.rfc || config.business_rfc);
    const showPhone = fields.includes("phone") && (businessProfile.phone || config.business_phone);
    const showAddress = fields.includes("address") && (businessProfile.address || config.business_address);
    const showBilling = fields.includes("billing");
    const showFooter = fields.includes("footer");
    const showEmail = fields.includes("email") && (businessProfile.email || config.business_email);
    const showPaymentMethod = fields.includes("payment_method");
    const showSeller = fields.includes("seller");
    const showCustomer = fields.includes("customer");
    const showNotes = fields.includes("notes");
    const showWarranty = fields.includes("warranty");

    const printWindow = window.open("", "_blank", `width=${paperSize === "58mm" ? 300 : 400},height=500`);
    if (!printWindow) return;

    if (job.type === "ticket") {
      const { realTicketId, items, finalTotal, paymentMethod } = job.data;
      const itemsHtml = items.map((i: any) => {
        const p = getItemFinalPrice(i, wholesaleRules);
        return `
        <div style="display:flex; justify-content:space-between; margin-bottom: 3px;">
          <span>${i.qty}x ${i.name} ${(i.discountPct || 0) > 0 ? `(-${i.discountPct}%)` : ''}</span>
          <span>$${Math.round(p * i.qty)}</span>
        </div>`;
      }).join("");
      
      const subtotalVal = items.reduce((sum: number, i: any) => {
         const p = getItemFinalPrice(i, wholesaleRules);
         return sum + (p * i.qty);
      }, 0);
      const discountVal = subtotalVal * (activeTicket.discountPct / 100);
      const subtotalNeto = subtotalVal - discountVal;
      const iva = applyIva ? subtotalNeto * 0.16 : 0;

      const html = `
        <html>
          <head>
            <style>
              @page { margin: 0 !important; }
              body { 
                font-family: ${fontFamilyCss}; 
                font-size: ${fontSizeCss}; 
                margin: 0 auto !important; 
                padding: ${marginPadding}mm !important; 
                width: ${widthCss}; 
                color: #000; 
                background: #fff; 
                box-sizing: border-box;
              }
              .center { text-align: center; }
              .bold { font-weight: bold; }
              .divider { border-bottom: 1px dashed #000; margin: 10px 0; }
            </style>
          </head>
          <body>
            <div style="text-align: ${marginAlign}; width: 100%;">
              ${showLogo ? `<div class="center"><img src="${businessProfile.logo || config.business_logo}" style="max-width: 80px; margin-bottom: 10px;" /></div>` : ""}
              ${showName ? `<div class="center bold" style="font-size: 1.2em; margin-bottom: 5px;">${businessProfile.name || config.business_name || "FERRETERÍA ERIKA"}</div>` : ""}
              ${showRfc ? `<div class="center" style="font-size: 0.9em; margin-bottom: 3px;">RFC: ${businessProfile.rfc || config.business_rfc}</div>` : ""}
              ${showAddress ? `<div class="center" style="font-size: 0.9em; margin-bottom: 3px;">${businessProfile.address || config.business_address}</div>` : ""}
              ${showPhone ? `<div class="center" style="font-size: 0.9em; margin-bottom: 3px;">Tel: ${businessProfile.phone || config.business_phone}</div>` : ""}
              ${showEmail ? `<div class="center" style="font-size: 0.9em; margin-bottom: 3px;">Email: ${businessProfile.email || config.business_email}</div>` : ""}
              
              <div class="divider"></div>
              <div class="center bold" style="margin-bottom: 5px;">Ticket: #${realTicketId}</div>
              <div style="font-size: 0.9em; margin-bottom: 5px;">Fecha: ${new Date().toLocaleString()}</div>
              ${showSeller ? `<div style="font-size: 0.9em; margin-bottom: 5px;">Atendido por: ${currentUser?.name || "Venta Mostrador"}</div>` : ""}
              
              ${showCustomer && job.data.customerName ? `
              <div style="font-size: 0.85rem; margin-bottom: 5px;">
                <strong>Cliente:</strong> ${job.data.customerName}
              </div>
              ` : ""}

              ${showPaymentMethod && paymentMethod ? `<div style="font-size: 0.95em; margin-bottom: 5px;">Método de Pago: ${paymentMethod.toUpperCase()}</div>` : ""}
              ${showPaymentMethod && job.data.reference ? `<div style="font-size: 0.9em; margin-bottom: 5px;">Ref/Folio: ${job.data.reference}</div>` : ""}
              ${showPaymentMethod && paymentMethod === "mixto" ? `
              <div style="font-size: 0.85em; margin-left: 10px; margin-bottom: 5px; opacity: 0.8;">
                ${job.data.cashAmount > 0 ? `<span>- Efec: $${Math.round(job.data.cashAmount)}</span><br>` : ""}
                ${job.data.cardAmount > 0 ? `<span>- Tarj: $${Math.round(job.data.cardAmount)}</span><br>` : ""}
                ${job.data.transferAmount > 0 ? `<span>- Trans: $${Math.round(job.data.transferAmount)}</span>` : ""}
              </div>
              ` : ""}

              ${showNotes && job.data.notes ? `
              <div style="font-size: 0.85em; background: #eee; padding: 5px; margin-bottom: 5px; border-radius: 4px; text-align: left;">
                <strong>Nota:</strong> ${job.data.notes}
              </div>
              ` : ""}

              <div class="divider"></div>
              ${itemsHtml}
              <div class="divider"></div>
              ${applyIva ? `
              <div style="display:flex; justify-content:space-between;"><span>Subtotal:</span><span>$${Math.round(subtotalNeto)}</span></div>
              <div style="display:flex; justify-content:space-between;"><span>IVA (16%):</span><span>$${Math.round(iva)}</span></div>
              <div class="divider"></div>` : ''}
              <div style="display:flex; justify-content:space-between; font-size: 1.1em;"><strong>TOTAL:</strong><strong>$${Math.round(finalTotal)}</strong></div>
              
              ${showWarranty ? `
              <div class="center" style="font-size: 0.85em; margin-top: 10px; opacity: 0.8;">
                🛡️ Garantía de 30 días contra defectos de fábrica.
              </div>
              ` : ""}

              <div class="divider"></div>
              ${showBilling ? `
              <div class="center" style="margin-top: 15px; font-size: 0.9em;">
                <strong>Auto-Facturación Express</strong><br>
                <span>Entra a ${window.location.origin}/facturacion/${realTicketId} para facturar.</span>
              </div>
              ` : ""}
              ${showFooter ? `<div class="center bold" style="margin-top: 15px;">${footerMsg}</div>` : ""}
              <div style="height: 25px;"></div>
            </div>
          </body>
        </html>
      `;
      printWindow.document.write(html);
      printWindow.document.close();
      setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
      } else if (job.type === "layaway") {
      const { customer, items, finalTotal, downPayment } = job.data;
      const itemsHtml = items.map((item: any) => {
        const p = getItemFinalPrice(item, wholesaleRules);
        return `
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
          <div style="flex: 2;">${item.qty}x ${item.name}</div>
          <div style="flex: 1; text-align: right;">$${Math.round(p * item.qty)}</div>
        </div>`;
      }).join("");
      
      const ticketHtml = `
        <html>
          <head>
            <style>
              @page { margin: 0 !important; }
              body { 
                font-family: ${fontFamilyCss}; 
                font-size: ${fontSizeCss}; 
                margin: 0 auto !important; 
                padding: ${marginPadding}mm !important; 
                width: ${widthCss}; 
                color: #000; 
                background: #fff; 
                box-sizing: border-box;
              }
              .center { text-align: center; }
              .bold { font-weight: bold; }
              .divider { border-bottom: 1px dashed #000; margin: 10px 0; }
            </style>
          </head>
          <body>
            <div style="text-align: ${marginAlign}; width: 100%;">
              ${showLogo ? `<div class="center"><img src="${businessProfile.logo || config.business_logo}" style="max-width: 80px; margin-bottom: 10px;" /></div>` : ""}
              ${showName ? `<div class="center bold" style="font-size: 1.2em; margin-bottom: 5px;">${businessProfile.name || config.business_name || "FERRETERÍA ERIKA"}</div>` : ""}
              ${showRfc ? `<div class="center" style="font-size: 0.9em; margin-bottom: 3px;">RFC: ${businessProfile.rfc || config.business_rfc}</div>` : ""}
              ${showAddress ? `<div class="center" style="font-size: 0.9em; margin-bottom: 3px;">${businessProfile.address || config.business_address}</div>` : ""}
              ${showPhone ? `<div class="center" style="font-size: 0.9em; margin-bottom: 3px;">Tel: ${businessProfile.phone || config.business_phone}</div>` : ""}
              ${showEmail ? `<div class="center" style="font-size: 0.9em; margin-bottom: 3px;">Email: ${businessProfile.email || config.business_email}</div>` : ""}
              
              <div class="divider"></div>
              <div class="center bold" style="font-size: 1.1em;">Comprobante de Apartado</div>
              <div class="divider"></div>
              <div style="margin-bottom: 5px;">Fecha: ${new Date().toLocaleString()}</div>
              ${showSeller ? `<div style="font-size: 0.9em; margin-bottom: 5px;">Atendido por: ${currentUser?.name || "Venta Mostrador"}</div>` : ""}
              <div style="margin-bottom: 5px;">Cliente: ${customer?.name || "Desconocido"}</div>
              <div class="divider"></div>
              ${itemsHtml}
              <div class="divider"></div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                <div>Total Mercancía:</div>
                <div class="bold">$${Math.round(finalTotal)}</div>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                <div>Enganche Dado:</div>
                <div class="bold">$${Math.round(downPayment)}</div>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                <div>Saldo Pendiente:</div>
                <div class="bold">$${Math.round(finalTotal - downPayment)}</div>
              </div>
              <div class="divider"></div>
              <div class="center bold" style="margin-bottom: 5px; color: red;">¡ATENCIÓN!</div>
              <div class="center">Vence: ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}</div>
              <div class="center" style="margin-top: 5px; font-size: 0.85em;">Pasando esta fecha, la mercancía regresará a piso de ventas.</div>
              ${showFooter ? `<div class="center bold" style="margin-top: 15px;">${footerMsg}</div>` : ""}
            </div>
          </body>
        </html>
      `;
      printWindow.document.write(ticketHtml);
      printWindow.document.close();
      setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
    }
  };

  const triggerPrint = (job: any) => {
    if (!isPrinterConnected) {
      setPendingPrintJob(job);
      return;
    }
    executePrintWindow(job);
  };

  const handleReconnectPrinter = async (type?: string) => {
    setIsReconnecting(true);
    const connType = type || printerConnectionType;
    
    // Simular un retardo para la detección física
    await new Promise((resolve) => setTimeout(resolve, 1500));
    
    try {
      if (connType === "usb" && typeof navigator !== "undefined" && "usb" in navigator) {
        await (navigator.usb as any).requestDevice({ filters: [] });
      } else if (connType === "serial" && typeof navigator !== "undefined" && "serial" in navigator) {
        await (navigator.serial as any).requestPort();
      }
    } catch (e) {
      console.warn("Error o cancelación del usuario al conectar puerto físico:", e);
    }
    
    setIsPrinterConnected(true);
    localStorage.setItem("ERIKA_PRINTER_CONNECTED", "true");
    if (type) {
      setPrinterConnectionType(type);
      localStorage.setItem("ERIKA_PRINTER_TYPE", type);
    }
    setIsReconnecting(false);
    setShowPrinterModal(false);
    
    // Si había un trabajo en cola, se reanuda inmediatamente
    if (pendingPrintJob) {
      const jobToRun = pendingPrintJob;
      setPendingPrintJob(null);
      setTimeout(() => {
        executePrintWindow(jobToRun);
      }, 500);
    }
  };

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
    if (!phone) return;
    
    // Sanitizar telefono (dejar solo digitos)
    let cleanPhone = phone.replace(/\D/g, "");
    if (cleanPhone.length === 10) {
      cleanPhone = "52" + cleanPhone;
    } else if (cleanPhone.length === 12 && cleanPhone.startsWith("52")) {
      // ya tiene prefijo 52 y los 10 digitos
    } else {
      return alert("❌ Número inválido. Por favor ingresa un número de 10 dígitos (ej: 5512345678).");
    }
    
    const bizUpper = (businessProfile.name || "FERRETERÍA ERIKA").toUpperCase();
    const title = type === "quote" ? `*COTIZACIÓN - ${bizUpper}*` : `*RECIBO DE COMPRA - ${bizUpper}*`;
    const itemsText = activeTicket.items.map(i => `▪️ ${i.qty}x ${i.name} - $${(i.price * i.qty).toFixed(2)}`).join("\n");
    const totalText = applyIva 
      ? `*SUBTOTAL: $${subtotalNeto.toFixed(2)}*\n*IVA (16%): $${iva.toFixed(2)}*\n*TOTAL: $${finalTotal.toFixed(2)}*` 
      : `*TOTAL: $${finalTotal.toFixed(2)}*`;
    
    const billingText = type === "receipt" 
      ? `\n\n📄 Auto-Facturación Express:\nEntra a: ${window.location.origin}/facturacion/${invoiceToken} para facturar.` 
      : "";
    
    const rawMsg = `${title}\n\n${itemsText}\n\n${totalText}${billingText}\n\n¡Gracias por su preferencia!`;
    const msg = encodeURIComponent(rawMsg);
    
    window.open(`https://wa.me/${cleanPhone}?text=${msg}`, "_blank");
  };

  // Variables dinámicas para el recibo de impresión (para cotizaciones, ventas directas o apartados)
  const isPrintingJob = receiptToPrint !== null;
  const printType = isPrintingJob ? receiptToPrint.type : "quote";
  const printTitle = printType === "ticket" ? "TICKET DE VENTA" : (printType === "layaway" ? "COMPROBANTE DE APARTADO" : "COTIZACIÓN");
  
  const printItems = isPrintingJob ? receiptToPrint.items : activeTicket.items;
  const printSubtotal = isPrintingJob ? receiptToPrint.subtotal : subtotal;
  const printIva = isPrintingJob ? receiptToPrint.iva : iva;
  const printDiscountPct = isPrintingJob ? receiptToPrint.discountPct : activeTicket.discountPct;
  const printDiscountAmount = isPrintingJob ? receiptToPrint.discountAmount : discountAmount;
  const printFinalTotal = isPrintingJob ? receiptToPrint.finalTotal : finalTotal;
  const printTicketId = isPrintingJob ? receiptToPrint.ticketId : "";
  const printInvoiceToken = isPrintingJob ? receiptToPrint.invoiceToken : invoiceToken;
  const printPaymentMethod = isPrintingJob ? (receiptToPrint.paymentMethod || "") : "";
  const printCashAmount = isPrintingJob ? (receiptToPrint.cashAmount || 0) : 0;
  const printCardAmount = isPrintingJob ? (receiptToPrint.cardAmount || 0) : 0;
  const printTransferAmount = isPrintingJob ? (receiptToPrint.transferAmount || 0) : 0;
  const printReference = isPrintingJob ? (receiptToPrint.reference || "") : "";
  const printNotes = isPrintingJob ? (receiptToPrint.notes || "") : "";
  const printCustomerName = isPrintingJob 
    ? receiptToPrint.customerName 
    : (selectedCustomerId && customers.find(c => c.id === selectedCustomerId) ? customers.find(c => c.id === selectedCustomerId).name : "");
  const printDownPayment = isPrintingJob ? receiptToPrint.downPayment : 0;
  const printBalance = isPrintingJob ? receiptToPrint.balance : 0;

  const previewConfig = businessSettings?.config || {};
  const previewFields = previewConfig.printer_fields || ["name", "rfc", "phone", "address", "logo", "footer"];
  
  const showPreviewLogo = previewFields.includes("logo") && businessProfile.logo;
  const showPreviewName = previewFields.includes("name");
  const showPreviewRfc = previewFields.includes("rfc") && businessProfile.rfc;
  const showPreviewPhone = previewFields.includes("phone") && businessProfile.phone;
  const showPreviewAddress = previewFields.includes("address") && businessProfile.address;
  const showPreviewEmail = previewFields.includes("email") && businessProfile.email;
  const showPreviewBilling = previewFields.includes("billing");
  const showPreviewFooter = previewFields.includes("footer");
  const previewFooterMsg = previewConfig.printer_footer_msg || "¡Gracias por su compra!";

  const showPreviewSeller = previewFields.includes("seller");
  const showPreviewPaymentMethod = previewFields.includes("payment_method");
  const showPreviewCustomer = previewFields.includes("customer");
  const showPreviewNotes = previewFields.includes("notes");
  const showPreviewWarranty = previewFields.includes("warranty");

  const marginAlign = previewConfig.printer_align || "center";
  const marginPadding = previewConfig.printer_padding || "8";

  return (
    <div
      className="animate-fade-in"
      style={{ display: "flex", gap: "20px", height: "100%" }}
    >
      <PosScannerModal
        show={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={(decodedText) => {
          let scanCode = decodedText;
          try {
            const parsed = JSON.parse(decodedText);
            if (parsed.code || parsed.sku) scanCode = parsed.code || parsed.sku;
          } catch(e) {
            if (decodedText.includes("http")) {
               try {
                 const url = new URL(decodedText);
                 scanCode = url.searchParams.get("code") || url.searchParams.get("sku") || url.pathname.split("/").pop() || decodedText;
               } catch(err) {}
            }
          }
          const loc = scanCode.replace("ERIKA-LOC-", "");
          const matched = globalCatalog.find(
            (c) => c.location === loc || c.code === scanCode,
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
            if (matched.stock <= matched.minStock)
              msg += ` Alerta: Quedan pocas unidades en bodega.`;
            speak(msg);
          } else {
            alert(`📷 Código no mapeado (${decodedText}).`);
          }
        }}
      />

      <div
        className="no-print"
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
              <button
                onClick={() => setShowSyncLogModal(true)}
                className="btn-primary"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
              >
                📋 Historial Sync
              </button>
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
                onClick={() => setShowPrinterModal(true)}
                className="btn-primary"
                style={{
                  background: isPrinterConnected ? "rgba(16, 185, 129, 0.15)" : "rgba(244, 63, 94, 0.15)",
                  border: isPrinterConnected ? "1px solid var(--color-secondary)" : "1px solid var(--color-primary)",
                  padding: "6px 12px",
                  fontSize: "0.85rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>{isPrinterConnected ? "🟢" : "🔴"}</span>
                <span>{isPrinterConnected ? `Impresora Lista${silentKiosk ? " (Kiosco ⚡)" : ""}` : "Impresora Off"}</span>
              </button>
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
            onSubmit={(e) => {
              e.preventDefault();
              handleSearchSubmit(e as any);
            }}
            style={{ display: "flex", gap: "10px", marginBottom: "20px" }}
          >
            <div style={{ flex: 1, position: "relative" }}>
                    <input
                      type="text"
                      value={searchInput}
                      onChange={(e) => {
                        setSearchInput(e.target.value);
                        setShowAutocomplete(e.target.value.length > 1);
                        setFocusedIndex(-1);
                      }}
                      onFocus={() => setShowAutocomplete(searchInput.length > 1)}
                      onBlur={() => setTimeout(() => { setShowAutocomplete(false); setFocusedIndex(-1); }, 200)}
                      onKeyDown={handleKeyDown}
                      placeholder="Buscar por Nombre, Código o Pistola Láser..."
                      style={{
                        width: "100%",
                        padding: "12px",
                        borderRadius: "8px",
                        background: "rgba(0,0,0,0.3)",
                        color: "white",
                        border: "1px solid var(--color-primary)",
                      }}
                    />
                    {showAutocomplete && (
                      <>
                        <div style={{
                          position: "fixed",
                          top: 0, left: 0, right: 0, bottom: 0,
                          backgroundColor: "rgba(0,0,0,0.7)",
                          zIndex: 99,
                          backdropFilter: "blur(2px)"
                        }}></div>
                        <div style={{
                          position: "absolute",
                          top: "100%",
                          left: 0,
                          right: 0,
                          marginTop: "5px",
                          background: "#1a1a1a",
                          border: "1px solid var(--color-primary)",
                          borderRadius: "8px",
                          zIndex: 100,
                          maxHeight: "350px",
                          overflowY: "auto",
                          boxShadow: "0 10px 25px rgba(0,0,0,0.8)"
                        }}>
                          {filteredCatalog.map((c, idx) => (
                            <div 
                              key={c.id} 
                              onMouseDown={async (e) => {
                                e.preventDefault(); // Prevents input onBlur
                                if (c.stock <= 0) {
                                  if (window.confirm(`El producto "${c.name}" está AGOTADO. ¿Deseas registrarlo en el Radar de Demanda (Ventas Perdidas)?`)) {
                                    await supabase.from("lost_sales_requests").insert({ term: c.name, type: "AGOTADO" });
                                    await supabase.from("internal_tasks").insert({
                                      title: `Reabastecer urgencia: ${c.name}`,
                                      assigned_to: "Administrador",
                                      status: "pending",
                                      created_by: "Caja"
                                    });
                                    const today = new Date();
                                    today.setHours(0,0,0,0);
                                    const { data: panicData } = await supabase.from("lost_sales_requests").select("id").eq("term", c.name).eq("type", "AGOTADO").gte("created_at", today.toISOString());
                                    if (panicData && panicData.length >= 5) {
                                      alert(`🚨 ¡ALERTA DE PÁNICO! 🚨\nEl producto "${c.name}" se ha negado por falta de stock ${panicData.length} veces solo el día de HOY. ¡Sugiero hacer un pedido de emergencia al proveedor YA!`);
                                    } else {
                                      alert("✅ Registrado en el reporte de inteligencia.");
                                    }
                                  }
                                } else {
                                  addToCart(c.name, c.price, "pz", c.cost, 1, c.image_url);
                                }
                                setSearchInput("");
                                setShowAutocomplete(false);
                                setFocusedIndex(-1);
                              }}
                              onMouseEnter={() => setFocusedIndex(idx)}
                              style={{
                                padding: "10px 15px",
                                borderBottom: "1px solid rgba(255,255,255,0.1)",
                                cursor: "pointer",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                background: focusedIndex === idx ? "rgba(16, 185, 129, 0.3)" : (c.stock <= 0 ? "rgba(239, 68, 68, 0.15)" : "transparent"),
                                opacity: c.stock <= 0 ? 0.7 : 1
                              }}
                            >
                              <div>
                                <div style={{ fontWeight: "bold", color: c.stock <= 0 ? "#ef4444" : "white", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                  {renderHighlightedName(c.name, searchInput)} {c.stock <= 0 ? "(AGOTADO)" : ""}
                                  {c.cost > 0 && ((c.price - c.cost) / c.cost) >= 0.4 && (
                                    <span title="Producto de Alta Rentabilidad" style={{ fontSize: "0.7rem", background: "rgba(234, 179, 8, 0.15)", border: "1px solid rgba(234, 179, 8, 0.3)", color: "#eab308", padding: "2px 6px", borderRadius: "10px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                      ⭐ TOP Ganancia
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: "0.8rem", color: "var(--color-secondary)" }}>Código: {c.code || "N/A"} | Stock: {c.stock}</div>
                              </div>
                              <div style={{ fontWeight: "bold", color: "var(--color-primary)" }}>
                                ${c.price.toFixed(2)}
                              </div>
                            </div>
                          ))}
                          {filteredCatalog.length === 0 && (
                            <div style={{ padding: "15px", textAlign: "center", color: "rgba(255,255,255,0.5)" }}>
                              No se encontraron productos en el inventario.
                              <button 
                                onMouseDown={async (e) => {
                                  e.preventDefault(); // Prevents input onBlur
                                  if (searchInput.trim() !== "") {
                                    await supabase.from("lost_sales_requests").insert({ term: searchInput, type: "NUEVO_PRODUCTO" });
                                    alert(`✅ "${searchInput}" registrado en el reporte de productos solicitados.`);
                                    setSearchInput("");
                                    setShowAutocomplete(false);
                                  }
                                }}
                                className="btn-primary" 
                                style={{ display: "block", width: "100%", marginTop: "10px", background: "transparent", border: "1px dashed var(--color-secondary)" }}
                              >
                                📝 Reportar como Solicitado
                              </button>
                            </div>
                          )}
                        </div>
                      </>
                    )}
            </div>
            <button
              type="submit"
              className="btn-primary"
              style={{ background: "var(--color-secondary)", color: "black", height: "46px" }}
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
        className="glass-panel no-print"
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

        {pendingPrintJob && (
          <div
            onClick={() => setShowPrinterModal(true)}
            className="blink"
            style={{
              background: "rgba(244, 63, 94, 0.2)",
              backdropFilter: "blur(8px)",
              border: "1px solid var(--color-primary)",
              borderRadius: "12px",
              padding: "12px 16px",
              marginBottom: "15px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              boxShadow: "0 4px 15px rgba(244, 63, 94, 0.15)",
              transition: "transform 0.2s ease",
            }}
            onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.01)"}
            onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "1.3rem" }}>⚠️</span>
              <div>
                <strong style={{ color: "var(--color-primary)", fontSize: "0.9rem", display: "block" }}>
                  Impresora Desconectada
                </strong>
                <span style={{ fontSize: "0.75rem", opacity: 0.8 }}>
                  Hay un ticket en espera. Haz clic aquí para reconectar y auto-imprimir.
                </span>
              </div>
            </div>
            <span
              style={{
                background: "var(--color-primary)",
                color: "white",
                padding: "4px 10px",
                borderRadius: "6px",
                fontSize: "0.75rem",
                fontWeight: "bold",
              }}
            >
              Reconectar
            </span>
          </div>
        )}

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
            {activeTicket.items.map((item) => {
              const invItem = globalCatalog.find(i => i.name === item.name);
              const hasInsufficientStock = invItem && item.qty > invItem.stock;
              const isLowStock = invItem && invItem.stock > 0 && invItem.stock <= 5;
              return (
                <li
                  key={item.id}
                  style={{
                    padding: "15px 10px",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                    borderLeft: hasInsufficientStock ? "3px solid #ef4444" : isLowStock ? "3px solid #f59e0b" : "3px solid transparent",
                    background: hasInsufficientStock ? "rgba(239, 68, 68, 0.05)" : isLowStock ? "rgba(245, 158, 11, 0.03)" : "transparent",
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
                      {selectedCustomerId && JSON.parse(localStorage.getItem(`ERIKA_CLIENT_HISTORY_${selectedCustomerId}`) || "{}")[item.name] && (
                        <span style={{ display: "block", fontSize: "0.75rem", color: "#f59e0b" }}>
                          ⭐ Historial cliente: ${JSON.parse(localStorage.getItem(`ERIKA_CLIENT_HISTORY_${selectedCustomerId}`) || "{}")[item.name]}
                        </span>
                      )}
                    </div>
                    <div>
                      <strong
                        style={{
                          color: "var(--color-secondary)",
                          fontSize: "1.1rem",
                        }}
                      >
                        ${(() => {
                          let p = item.price;
                          if (item.qty >= wholesaleRules.minQty) {
                            p = item.price * (1 - wholesaleRules.discountPct/100);
                          }
                          if (item.discountPct) {
                            p = p * (1 - item.discountPct / 100);
                          }
                          return (p * item.qty).toFixed(2);
                        })()}
                      </strong>
                      {(item.discountPct || 0) > 0 && (
                        <span style={{ fontSize: "0.75rem", color: "#ef4444", display: "block", textAlign: "right", marginTop: "2px" }}>
                          Desc. -{item.discountPct}%
                        </span>
                      )}
                    </div>
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
                    {hasInsufficientStock && (
                      <span style={{ color: "#ef4444", fontSize: "0.8rem", fontWeight: "bold", marginLeft: "10px" }}>
                        ⚠️ Excede stock ({invItem.stock})
                      </span>
                    )}
                    {!hasInsufficientStock && isLowStock && (
                      <span style={{ color: "#f59e0b", fontSize: "0.8rem", fontWeight: "bold", marginLeft: "10px" }}>
                        ⚠️ Stock bajo ({invItem.stock} disp.)
                      </span>
                    )}
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
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      style={{
                        background: "transparent",
                        border: "1px solid #10b981",
                        color: "#10b981",
                        cursor: "pointer",
                        padding: "5px 10px",
                        borderRadius: "6px",
                        fontSize: "0.8rem",
                      }}
                      onClick={() => applyItemDiscount(item.id)}
                    >
                      🏷️ Desc.
                    </button>
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
                </div>
              </li>
            );
            })}
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
            <span>${formatPrice(subtotal)}</span>
          </div>
          
          {itemDiscountsSavings > 0 && (
             <div className="flex-between" style={{ marginBottom: "10px", color: "#10b981" }}>
               <span>Ahorro por productos:</span>
               <span>-${formatPrice(itemDiscountsSavings)}</span>
             </div>
          )}

          {activeTicket.discountPct > 0 && (
             <div className="flex-between" style={{ marginBottom: "10px", color: "#10b981" }}>
               <span>Descuento ({activeTicket.discountPct}%):</span>
               <span>-${formatPrice(discountAmount)}</span>
             </div>
          )}

          {applyIva && (
             <div className="flex-between" style={{ marginBottom: "10px", color: "#3b82f6" }}>
               <span>IVA (16%):</span>
               <span>+${formatPrice(iva)}</span>
             </div>
          )}

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
              ${formatPrice(finalTotal)}
            </span>
          </div>

          <div style={{ marginBottom: "15px", position: "relative" }}>
            <div style={{ display: "flex", gap: "8px" }}>
              <div style={{ flex: 1, position: "relative" }}>
                <input
                  type="text"
                  placeholder="🔍 Buscar cliente por nombre o teléfono..."
                  value={customerSearch}
                  onChange={(e) => {
                    setCustomerSearch(e.target.value);
                    setShowCustomerDropdown(true);
                    if (!e.target.value) {
                       setSelectedCustomerId("");
                    }
                  }}
                  onFocus={() => setShowCustomerDropdown(true)}
                  style={{
                    width: "100%",
                    padding: "10px",
                    borderRadius: "8px",
                    background: "white",
                    color: "black",
                    border: "1px solid var(--color-primary)",
                  }}
                />
                
                {showCustomerDropdown && (
                  <div 
                    onClick={() => setShowCustomerDropdown(false)}
                    style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }}
                  />
                )}

                {showCustomerDropdown && (
                  <div style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    background: "white",
                    color: "black",
                    borderRadius: "8px",
                    boxShadow: "0 10px 25px rgba(0,0,0,0.3)",
                    zIndex: 1000,
                    maxHeight: "200px",
                    overflowY: "auto",
                    border: "1px solid var(--glass-border)",
                    marginTop: "5px"
                  }}>
                    <div
                      onClick={() => {
                        setSelectedCustomerId("");
                        setCustomerSearch("");
                        setShowCustomerDropdown(false);
                      }}
                      style={{
                        padding: "10px",
                        cursor: "pointer",
                        borderBottom: "1px solid rgba(0,0,0,0.05)",
                        fontWeight: "bold",
                        background: selectedCustomerId === "" ? "#f3f4f6" : "transparent",
                        textAlign: "left"
                      }}
                    >
                      -- Cliente de Mostrador (Sin Puntos) --
                    </div>
                    {customers
                      .filter(c => 
                        c.name.toLowerCase().includes(customerSearch.toLowerCase()) || 
                        (c.phone && c.phone.includes(customerSearch))
                      )
                      .map((c) => (
                        <div
                          key={c.id}
                          onClick={() => {
                            setSelectedCustomerId(c.id);
                            setCustomerSearch(`${c.name} (Pts: ${c.points || 0})`);
                            setShowCustomerDropdown(false);
                          }}
                          style={{
                            padding: "10px",
                            cursor: "pointer",
                            borderBottom: "1px solid rgba(0,0,0,0.05)",
                            background: selectedCustomerId === c.id ? "#e5e7eb" : "transparent",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center"
                          }}
                        >
                          <span style={{ textAlign: "left" }}>
                            {c.points > 0 ? "⭐ " : ""}{c.name}
                          </span>
                          <strong style={{ fontSize: "0.85rem", color: c.points > 0 ? "#b45309" : "#4b5563" }}>
                            Pts: {c.points || 0}
                          </strong>
                        </div>
                      ))}
                  </div>
                )}
              </div>
              
              <button
                type="button"
                className="btn-primary"
                onClick={() => setShowQuickCustomerModal(true)}
                style={{ padding: "0 15px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem" }}
                title="Registrar nuevo cliente"
              >
                ➕
              </button>
            </div>
          </div>

          {selectedCustomerId && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "-10px", marginBottom: "15px" }}>
              <span style={{ fontSize: "0.85rem", opacity: 0.8 }}>
                Cliente seleccionado
              </span>
              <button
                type="button"
                onClick={() => fetchCustomerHistory(selectedCustomerId)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#3b82f6",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  textDecoration: "underline",
                  padding: 0
                }}
              >
                {isLoadingCustomerHistory ? "⌛ Cargando historial..." : "📅 Ver últimas compras"}
              </button>
            </div>
          )}

          <div style={{ marginBottom: "15px", display: "flex", justifyContent: "flex-end" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "0.9rem", color: applyIva ? "#3b82f6" : "var(--color-secondary)" }}>
              <input type="checkbox" checked={applyIva} onChange={(e) => setApplyIva(e.target.checked)} style={{ width: "16px", height: "16px", accentColor: "#3b82f6" }} />
              Cobrar IVA (16%)
            </label>
          </div>

          <div>
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
                   let { data: custData, error: custError } = await supabase.from("customers").select("*").not("deleted", "eq", true);
                   if (custError) {
                     console.warn("Fallo el filtro de base de datos 'deleted' al recargar clientes (puntos), usando fallback local:", custError.message);
                     const fallback = await supabase.from("customers").select("*");
                     if (fallback.error) {
                       console.error("Error al recargar clientes (fallback):", fallback.error);
                       LoggerService.logError("POSModule_reloadCustomers_Points_fallback", fallback.error);
                     } else if (fallback.data) {
                       custData = fallback.data.filter((c: any) => c.deleted !== true);
                       custError = null;
                     }
                   }
                   if (!custError && custData) {
                     setCustomers(custData);
                   }
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
                background: "linear-gradient(135deg, var(--color-primary), #059669)",
                border: "none",
                fontWeight: "bold",
                color: "white"
              }}
              onClick={() => {
                if (activeTicket.items.length === 0) return alert("El ticket está vacío.");
                setPaymentMethod("efectivo");
                setCashPayAmount(finalTotal.toFixed(2));
                setCardPayAmount("");
                setTransferPayAmount("");
                setShowCheckoutModal(true);
              }}
            >
              💰 Cobrar / Pagar
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
          <button
            className="btn-primary"
            style={{
              width: "100%",
              marginTop: "10px",
              padding: "10px",
              background: "transparent",
              border: "1px solid #ef4444",
              color: "#ef4444",
            }}
            onClick={async () => {
              if (currentUser?.role !== "admin") {
                 const pass = window.prompt("🔒 DEVOLUCIÓN - Requiere contraseña de Administrador:");
                 const { data: admin } = await supabase.from("users").select("*").eq("pin", pass).eq("role", "admin").single();
                 if (!admin) return alert("❌ Contraseña incorrecta o sin privilegios.");
              }

              const amountStr = window.prompt("¿Monto a reembolsar/devolver de la Caja? (Ej: 150.00)");
              const amount = parseFloat(amountStr || "");
              if (isNaN(amount) || amount <= 0) return alert("Monto inválido.");

              const reason = window.prompt("Motivo de la devolución:");
              if (!reason) return alert("Debe especificar un motivo.");

              if (!isOffline) {
                 const { data: rawSession } = await supabase
                    .from("cash_sessions")
                    .select("*")
                    .eq("status", "open")
                    .order("opened_at", { ascending: false })
                    .limit(1)
                    .single();
                 
                 let session = null;
                 if (rawSession) {
                    const result = CashSessionSchema.safeParse(rawSession);
                    if (!result.success) {
                       console.error("Error validando sesion de caja con Zod en devolucion:", result.error);
                       session = rawSession;
                    } else {
                       session = result.data;
                    }
                 }
                 if (!session) return alert("La caja está cerrada.");
                 
                 const { error } = await supabase.from("cash_transactions").insert({
                    session_id: session.id,
                    type: "withdrawal",
                    amount: -amount,
                    description: `Devolución: ${reason}`
                 });
                 if (error) return alert("Error al registrar devolución: " + error.message);
                 alert(`✅ Devolución exitosa. Se retiraron $${amount.toFixed(2)} de la caja.`);
              } else {
                 alert("❌ Las devoluciones solo se pueden hacer en modo en línea.");
              }
            }}
          >
            ↩️ Devolución / Reembolso
          </button>
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
                  customer_id: selectedCustomerId || null,
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
            <button
              className="btn-primary"
              style={{
                flex: 1,
                padding: "10px",
                background: "transparent",
                border: "1px solid #6b7280",
                color: "white",
              }}
              onClick={() => {
                if (activeTicket.items.length === 0) return alert("El ticket está vacío.");
                window.print();
              }}
            >
              🖨️ Imprimir PDF
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
                  try {
                     const { error: rpcErr } = await supabase.rpc("reduce_inventory_stock", {
                        items: activeTicket.items.map(item => {
                           const invItem = globalCatalog.find(i => i.name === item.name);
                           return { id: invItem ? invItem.id : null, qty: item.qty };
                        }).filter(item => item.id !== null),
                        ref_id: `LAY-${Date.now()}`,
                        user_name: currentUser?.name || "Venta Mostrador",
                        move_type: "layaway"
                     });

                     if (rpcErr) {
                        console.warn("Falla al llamar RPC reduce_inventory_stock en layaway, reintentando con fallback manual...", rpcErr);
                        for (const item of activeTicket.items) {
                           const invItem = globalCatalog.find(i => i.name === item.name);
                           if (invItem) {
                              await supabase.from("inventory").update({ stock: invItem.stock - item.qty }).eq("id", invItem.id);
                           }
                        }
                     }
                  } catch (invErr) {
                     console.error("Error crítico al actualizar inventario en layaway:", invErr);
                  }

                 // Update local state globalCatalog
                 setGlobalCatalog(prevCatalog =>
                    prevCatalog.map(invItem => {
                       const soldItem = activeTicket.items.find(item => item.name === invItem.name);
                       if (soldItem) {
                          return { ...invItem, stock: invItem.stock - soldItem.qty };
                       }
                       return invItem;
                    })
                 );

                 // Print Thermal Ticket for Layaway
                  triggerPrint({
                    type: "layaway",
                    data: {
                      customer,
                      items: [...activeTicket.items],
                      finalTotal,
                      downPayment
                    }
                  });

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
      
      {/* Printable Receipt Area */}
      <div 
        id="printable-receipt" 
        style={{ 
          padding: `${marginPadding}mm`, 
          fontFamily: "monospace", 
          maxWidth: (previewConfig.printer_paper_size || "80mm") === "58mm" ? "58mm" : "80mm", 
          margin: "0 auto",
          textAlign: marginAlign as any,
          boxSizing: "border-box"
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: marginAlign === "center" ? "center" : "flex-start", borderBottom: "1px dashed #000", paddingBottom: "10px", marginBottom: "15px", textAlign: marginAlign as any }}>
          {showPreviewLogo && <img src={businessProfile.logo} alt="Logo" style={{ maxHeight: "60px", marginBottom: "10px" }} />}
          {showPreviewName && <h2 style={{ margin: "5px 0", fontSize: "18px", fontWeight: "bold" }}>{businessProfile.name || "FERRETERÍA ERIKA"}</h2>}
          {showPreviewRfc && <p style={{ margin: "2px 0", fontSize: "12px" }}>RFC: {businessProfile.rfc}</p>}
          {showPreviewAddress && <p style={{ margin: "2px 0", fontSize: "12px", whiteSpace: "pre-line" }}>{businessProfile.address}</p>}
          {showPreviewPhone && <p style={{ margin: "2px 0", fontSize: "12px" }}>Tel: {businessProfile.phone}</p>}
          {showPreviewEmail && <p style={{ margin: "2px 0", fontSize: "12px" }}>Email: {businessProfile.email}</p>}
        </div>
        
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px", fontSize: "14px", textAlign: "left" }}>
          <div>
            <h3 style={{ margin: 0, fontWeight: "bold", fontSize: "16px" }}>{printTitle}</h3>
            {printTicketId && <p style={{ margin: "2px 0", fontWeight: "bold" }}>Ticket: #{printTicketId}</p>}
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: "2px 0" }}>{new Date().toLocaleDateString()}</p>
            <p style={{ margin: "2px 0" }}>{new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
            {showPreviewSeller && <p style={{ margin: "2px 0", fontSize: "11px", opacity: 0.8 }}>Vend: {currentUser?.name || "Venta Mostrador"}</p>}
          </div>
        </div>

        {showPreviewPaymentMethod && printPaymentMethod && (
          <div style={{ marginBottom: "10px", fontSize: "12px", textAlign: marginAlign as any }}>
            <strong>Método de Pago:</strong> {printPaymentMethod.toUpperCase()}
            {printReference && (
              <div style={{ marginTop: "2px", opacity: 0.9 }}>
                <strong>Ref/Folio:</strong> {printReference}
              </div>
            )}
            {printPaymentMethod === "mixto" && (
              <div style={{ marginTop: "3px", fontSize: "11px", color: "#666", paddingLeft: "10px" }}>
                {printCashAmount > 0 && <div>• Efec: ${Math.round(printCashAmount)}</div>}
                {printCardAmount > 0 && <div>• Tarj: ${Math.round(printCardAmount)}</div>}
                {printTransferAmount > 0 && <div>• Trans: ${Math.round(printTransferAmount)}</div>}
              </div>
            )}
          </div>
        )}

        {showPreviewNotes && printNotes && (
          <div style={{ marginBottom: "10px", padding: "8px", background: "#f3f4f6", borderRadius: "4px", fontSize: "11px", border: "1px solid #e5e7eb", color: "#000", textAlign: "left" }}>
            <strong>Nota:</strong> {printNotes}
          </div>
        )}

        {showPreviewCustomer && printCustomerName && (
          <div style={{ marginBottom: "15px", padding: "8px", background: "#f3f4f6", borderRadius: "4px", fontSize: "12px", border: "1px solid #e5e7eb", textAlign: "left" }}>
            <strong>Cliente:</strong> {printCustomerName}
          </div>
        )}

        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "15px", fontSize: "13px" }}>
          <thead>
            <tr style={{ borderBottom: "1px dashed #000" }}>
              <th style={{ padding: "5px 0", textAlign: "left" }}>Cant</th>
              <th style={{ padding: "5px 0", textAlign: "left" }}>Concepto</th>
              <th style={{ padding: "5px 0", textAlign: "right" }}>P. Unit</th>
              <th style={{ padding: "5px 0", textAlign: "right" }}>Importe</th>
            </tr>
          </thead>
          <tbody>
            {printItems.map((item: any) => {
               const p = getItemFinalPrice(item, wholesaleRules);
               return (
                  <tr key={item.id} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "5px 0", verticalAlign: "top" }}>{item.qty} {item.unit}</td>
                    <td style={{ padding: "5px 0", verticalAlign: "top" }}>
                      {item.name}
                      {(item.discountPct || 0) > 0 && (
                        <div style={{ fontSize: "10px", color: "#666" }}>
                          Desc. -{item.discountPct}%
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "5px 0", verticalAlign: "top", textAlign: "right" }}>${Math.round(p)}</td>
                    <td style={{ padding: "5px 0", verticalAlign: "top", textAlign: "right" }}>${Math.round(p * item.qty)}</td>
                  </tr>
               );
            })}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "flex-end", fontSize: "13px" }}>
          <div style={{ width: "180px" }}>
             <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
               <span>Subtotal:</span>
               <span>${Math.round(printSubtotal)}</span>
             </div>
             <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
               <span>IVA (16%):</span>
               <span>${Math.round(printIva)}</span>
             </div>
             {printDiscountPct > 0 && (
               <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px", color: "red" }}>
                 <span>Desc ({printDiscountPct}%):</span>
                 <span>-${Math.round(printDiscountAmount)}</span>
               </div>
             )}
             <div style={{ display: "flex", justifyContent: "space-between", marginTop: "5px", borderTop: "1px dashed #000", paddingTop: "5px", fontWeight: "bold", fontSize: "16px" }}>
               <span>TOTAL:</span>
               <span>${Math.round(printFinalTotal)}</span>
             </div>
             
             {printType === "layaway" && (
               <div style={{ marginTop: "10px", borderTop: "1px dashed #000", paddingTop: "5px", fontSize: "12px" }}>
                 <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                   <span>Enganche:</span>
                   <span>${Math.round(printDownPayment)}</span>
                 </div>
                 <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px", fontWeight: "bold" }}>
                   <span>Saldo Pend:</span>
                   <span>${Math.round(printBalance)}</span>
                 </div>
                 <div style={{ color: "red", fontWeight: "bold", textAlign: "center", marginTop: "5px" }}>
                   Vence: {new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}
                 </div>
               </div>
             )}
          </div>
        </div>
        
        <div style={{ borderTop: "1px dashed #000", marginTop: "15px", paddingBottom: "25px" }}>
          {showPreviewWarranty && (
            <div style={{ marginTop: "10px", textAlign: "center", color: "#000", fontSize: "11px", opacity: 0.8 }}>
              <p>🛡️ Garantía de 30 días contra defectos de fábrica.</p>
            </div>
          )}
          {showPreviewBilling && (
            <div style={{ marginTop: "15px", textAlign: "center", color: "#000", fontSize: "11px" }}>
              <p style={{ fontWeight: "bold", margin: "0 0 5px 0" }}>Auto-Facturación Express</p>
              <p style={{ margin: "5px 0" }}>Entra a: erika-app.vercel.app/facturacion para facturar</p>
            </div>
          )}
          {showPreviewFooter && (
            <div style={{ marginTop: "15px", textAlign: "center", color: "#000", fontSize: "11px", fontWeight: "bold" }}>
              <p>{previewFooterMsg}</p>
            </div>
          )}
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
          const { data: custData, error: custError } = await supabase
            .from("customers")
            .select("*");
          if (custError) {
            console.error("Error al recargar clientes:", custError);
            LoggerService.logError("POSModule_reloadCustomers_CreditModal", custError);
          } else if (custData) {
            setCustomers(custData);
          }
        }}
      />

      {showCheckoutModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.85)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(5px)"
          }}
        >
          <div className="glass-panel animate-fade-in" style={{ width: "450px", padding: "30px", border: "1px solid var(--color-primary)", position: "relative" }}>
            <button
              onClick={() => setShowCheckoutModal(false)}
              style={{ position: "absolute", top: "15px", right: "15px", background: "transparent", color: "white", border: "none", cursor: "pointer", fontSize: "1.2rem" }}
            >
              ✖
            </button>

            <h3 style={{ color: "var(--color-primary)", marginBottom: "15px", textAlign: "center" }}>
              💵 Registrar Pago de Venta
            </h3>
            
            <div style={{ background: "rgba(255,255,255,0.05)", padding: "15px", borderRadius: "8px", marginBottom: "20px", textAlign: "center" }}>
              <span style={{ fontSize: "0.9rem", opacity: 0.7 }}>TOTAL A COBRAR</span>
              <h1 style={{ color: "var(--color-secondary)", margin: "5px 0 0 0", fontSize: "2.5rem" }}>
                ${formatPrice(finalTotal)}
              </h1>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", marginBottom: "8px", fontSize: "0.9rem", color: "var(--color-secondary)" }}>
                Método de Pago:
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                {[
                  { id: "efectivo", label: "💵 Efectivo" },
                  { id: "tarjeta", label: "💳 Tarjeta" },
                  { id: "transferencia", label: "📟 Transfer" },
                  { id: "mixto", label: "🔀 Mixto" }
                ].map(m => (
                  <button
                    key={m.id}
                    onClick={() => {
                      setPaymentMethod(m.id as any);
                      if (m.id === "efectivo") {
                        setCashPayAmount(formatPrice(finalTotal));
                        setCardPayAmount("");
                        setTransferPayAmount("");
                      } else if (m.id === "tarjeta") {
                        setCashPayAmount("");
                        setCardPayAmount(formatPrice(finalTotal));
                        setTransferPayAmount("");
                      } else if (m.id === "transferencia") {
                        setCashPayAmount("");
                        setCardPayAmount("");
                        setTransferPayAmount(formatPrice(finalTotal));
                      } else {
                        setCashPayAmount("");
                        setCardPayAmount("");
                        setTransferPayAmount("");
                      }
                    }}
                    className="btn-primary"
                    style={{
                      background: paymentMethod === m.id ? "var(--color-primary)" : "rgba(255,255,255,0.05)",
                      border: paymentMethod === m.id ? "1px solid var(--color-primary)" : "1px solid rgba(255,255,255,0.1)",
                      color: "white",
                      padding: "10px",
                      fontSize: "0.9rem"
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {paymentMethod === "efectivo" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", background: "rgba(0,0,0,0.3)", padding: "15px", borderRadius: "8px", marginBottom: "20px" }}>
                <label style={{ display: "block", marginBottom: "4px", fontSize: "0.85rem", color: "var(--color-secondary)" }}>💵 Efectivo Recibido (Calculadora de Cambio):</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                  <button onClick={() => setCashPayAmount(formatPrice(finalTotal))} className="btn-primary" style={{ background: "rgba(16, 185, 129, 0.1)", border: "1px solid #10b981", color: "#10b981", padding: "6px" }}>Exacto</button>
                  <button onClick={() => setCashPayAmount("50")} className="btn-primary" style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", padding: "6px" }}>$50</button>
                  <button onClick={() => setCashPayAmount("100")} className="btn-primary" style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", padding: "6px" }}>$100</button>
                  <button onClick={() => setCashPayAmount("200")} className="btn-primary" style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", padding: "6px" }}>$200</button>
                  <button onClick={() => setCashPayAmount("500")} className="btn-primary" style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", padding: "6px" }}>$500</button>
                  <button onClick={() => setCashPayAmount("1000")} className="btn-primary" style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", padding: "6px" }}>$1000</button>
                </div>
                <input
                  type="number"
                  value={cashPayAmount}
                  onChange={e => setCashPayAmount(e.target.value)}
                  placeholder="Monto recibido..."
                  style={{ width: "100%", padding: "12px", borderRadius: "6px", background: "rgba(0,0,0,0.5)", color: "white", border: "1px solid var(--color-primary)", fontSize: "1.2rem", textAlign: "center" }}
                />
                {parseFloat(cashPayAmount) > finalTotal && (
                  <div style={{ marginTop: "5px", padding: "10px", background: "rgba(16, 185, 129, 0.15)", borderRadius: "6px", textAlign: "center" }}>
                    <span style={{ color: "#10b981", fontWeight: "bold", fontSize: "1.1rem" }}>
                      CAMBIO A ENTREGAR: ${formatPrice(parseFloat(cashPayAmount) - finalTotal)}
                    </span>
                  </div>
                )}
                {parseFloat(cashPayAmount) < finalTotal && cashPayAmount !== "" && (
                  <div style={{ marginTop: "5px", padding: "10px", background: "rgba(239, 68, 68, 0.15)", borderRadius: "6px", textAlign: "center" }}>
                    <span style={{ color: "#ef4444", fontWeight: "bold", fontSize: "0.9rem" }}>
                      Faltan: ${formatPrice(finalTotal - parseFloat(cashPayAmount))}
                    </span>
                  </div>
                )}
              </div>
            )}

            {paymentMethod === "mixto" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", background: "rgba(0,0,0,0.3)", padding: "15px", borderRadius: "8px", marginBottom: "20px" }}>
                <div>
                  <label style={{ display: "block", marginBottom: "4px", fontSize: "0.85rem" }}>💵 Monto Efectivo:</label>
                  <input
                    type="number"
                    value={cashPayAmount}
                    onChange={e => setCashPayAmount(e.target.value)}
                    placeholder="0.00"
                    style={{ width: "100%", padding: "8px", borderRadius: "6px", background: "rgba(0,0,0,0.3)", color: "white", border: "1px solid var(--glass-border)" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "4px", fontSize: "0.85rem" }}>💳 Monto Tarjeta:</label>
                  <input
                    type="number"
                    value={cardPayAmount}
                    onChange={e => setCardPayAmount(e.target.value)}
                    placeholder="0.00"
                    style={{ width: "100%", padding: "8px", borderRadius: "6px", background: "rgba(0,0,0,0.3)", color: "white", border: "1px solid var(--glass-border)" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "4px", fontSize: "0.85rem" }}>📟 Monto Transferencia:</label>
                  <input
                    type="number"
                    value={transferPayAmount}
                    onChange={e => setTransferPayAmount(e.target.value)}
                    placeholder="0.00"
                    style={{ width: "100%", padding: "8px", borderRadius: "6px", background: "rgba(0,0,0,0.3)", color: "white", border: "1px solid var(--glass-border)" }}
                  />
                </div>
                
                {(() => {
                  const totalPaid = (parseFloat(cashPayAmount) || 0) + (parseFloat(cardPayAmount) || 0) + (parseFloat(transferPayAmount) || 0);
                  const diff = finalTotal - totalPaid;
                  return (
                    <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "10px", fontSize: "0.85rem" }}>
                      <span>Suma: ${totalPaid.toFixed(2)}</span>
                      <span style={{ color: Math.abs(diff) < 0.01 ? "#10b981" : "#ef4444", fontWeight: "bold" }}>
                        {Math.abs(diff) < 0.01 ? "✓ Cuadrado" : `Resta: $${diff.toFixed(2)}`}
                      </span>
                    </div>
                  );
                })()}
              </div>
            )}

            {paymentMethod !== "efectivo" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", background: "rgba(0,0,0,0.3)", padding: "15px", borderRadius: "8px", marginBottom: "20px" }}>
                <label style={{ display: "block", marginBottom: "4px", fontSize: "0.85rem", color: "var(--color-secondary)", textAlign: "left" }}>
                  📝 Referencia / Folio de Operación (Opcional):
                </label>
                <input
                  type="text"
                  placeholder="Ej. Últimos 4 dígitos o folio bancario..."
                  value={paymentReference}
                  onChange={e => setPaymentReference(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", background: "rgba(0,0,0,0.5)", color: "white", border: "1px solid var(--glass-border)", fontSize: "0.95rem" }}
                />
              </div>
            )}

            <button
              className="btn-primary"
              disabled={isProcessingPayment}
              onClick={() => {
                const cash = parseFloat(cashPayAmount) || 0;
                const card = parseFloat(cardPayAmount) || 0;
                const transfer = parseFloat(transferPayAmount) || 0;
                
                if (paymentMethod === "mixto") {
                  const totalPaid = cash + card + transfer;
                  if (Math.abs(finalTotal - totalPaid) >= 0.01) {
                    return alert("❌ La suma de los montos no coincide con el total de la venta.");
                  }
                }
                
                handleCheckoutSubmit(paymentMethod === "mixto" ? "mixto" : paymentMethod as any, cash, card, transfer, paymentReference);
              }}
              style={{
                width: "100%",
                padding: "12px",
                background: isProcessingPayment ? "#4b5563" : "var(--color-primary)",
                cursor: isProcessingPayment ? "not-allowed" : "pointer",
                border: "none",
                fontWeight: "bold",
                fontSize: "1.1rem",
                opacity: isProcessingPayment ? 0.7 : 1
              }}
            >
              {isProcessingPayment ? "Procesando Pago..." : "Confirmar Pago"}
            </button>
          </div>
        </div>
      )}

      {showPrinterModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
            animation: "fadeIn 0.3s ease",
          }}
        >
          <div
            className="glass-panel"
            style={{
              width: "450px",
              background: "rgba(22, 22, 34, 0.95)",
              border: "1px solid var(--glass-border)",
              boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
              padding: "30px",
              textAlign: "center",
            }}
          >
            <h3 style={{ fontSize: "1.5rem", marginBottom: "15px", color: "var(--color-primary)" }}>
              🔌 Asistente de Reconexión Rápida
            </h3>
            
            <p style={{ opacity: 0.8, fontSize: "0.9rem", marginBottom: "25px" }}>
              Reconecta la impresora térmica para imprimir tus tickets de inmediato.
            </p>

            {isReconnecting ? (
              <div style={{ margin: "30px 0" }}>
                <div
                  style={{
                    width: "50px",
                    height: "50px",
                    border: "4px solid rgba(255,255,255,0.1)",
                    borderTop: "4px solid var(--color-primary)",
                    borderRadius: "50%",
                    margin: "0 auto 15px auto",
                    animation: "spin 1s linear infinite",
                  }}
                />
                <style>{`
                  @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                  }
                `}</style>
                <p style={{ fontWeight: "bold", color: "var(--color-primary)", fontSize: "0.95rem" }}>
                  Buscando y reconectando impresora...
                </p>
                <p style={{ fontSize: "0.8rem", opacity: 0.6, marginTop: "5px" }}>
                  Por favor, confirma en el diálogo del navegador si es necesario.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "15px", marginBottom: "30px" }}>
                <button
                  onClick={() => handleReconnectPrinter("usb")}
                  className="btn-primary"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
                >
                  🔌 Conectar vía USB (WebUSB)
                </button>
                
                <button
                  onClick={() => handleReconnectPrinter("serial")}
                  className="btn-primary"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
                >
                  📟 Conectar vía Puerto Serie / COM
                </button>

                <button
                  onClick={() => handleReconnectPrinter("system")}
                  className="btn-primary"
                  style={{ background: "rgba(16, 185, 129, 0.2)", border: "1px solid var(--color-secondary)", color: "white" }}
                >
                  🖥️ Impresora del Sistema (Navegador)
                </button>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "20px", paddingTop: "20px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
              <button
                onClick={() => {
                  const newStatus = !isPrinterConnected;
                  setIsPrinterConnected(newStatus);
                  localStorage.setItem("ERIKA_PRINTER_CONNECTED", String(newStatus));
                }}
                className="btn-primary"
                style={{
                  background: isPrinterConnected ? "rgba(239, 68, 68, 0.15)" : "rgba(16, 185, 129, 0.15)",
                  border: isPrinterConnected ? "1px solid rgba(239, 68, 68, 0.3)" : "1px solid rgba(16, 185, 129, 0.3)",
                  fontSize: "0.8rem",
                  padding: "6px 12px",
                }}
              >
                {isPrinterConnected ? "🔌 Simular Desconexión" : "🔌 Simular Conexión"}
              </button>

              <button
                onClick={() => setShowPrinterModal(false)}
                className="btn-primary"
                style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", fontSize: "0.8rem", padding: "6px 12px" }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {showPinModal && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.75)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          backdropFilter: "blur(5px)"
        }}>
          <div className="glass-panel" style={{
            padding: "25px",
            width: "350px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: "15px",
            background: "rgba(22, 22, 34, 0.95)",
            border: "1px solid var(--glass-border)",
            boxShadow: "0 20px 50px rgba(0,0,0,0.5)"
          }}>
            <h3 style={{ color: "var(--color-primary)", margin: 0 }}>{pinModalTitle}</h3>
            <p style={{ fontSize: "0.85rem", opacity: 0.9, whiteSpace: "pre-line" }}>{pinModalMessage}</p>
            <input
              type="password"
              placeholder="PIN de 4 dígitos"
              maxLength={6}
              value={pinValue}
              onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ""))}
              style={{
                width: "100%",
                padding: "12px",
                textAlign: "center",
                fontSize: "1.2rem",
                borderRadius: "6px",
                border: "1px solid var(--glass-border)",
                background: "rgba(0,0,0,0.3)",
                color: "white",
                letterSpacing: "4px"
              }}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (pinModalCallback) pinModalCallback(pinValue);
                  setShowPinModal(false);
                }
              }}
            />
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                className="btn-primary inactive"
                style={{ flex: 1, padding: "10px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
                onClick={() => {
                  setShowPinModal(false);
                  if (pinModalCallback) pinModalCallback("");
                }}
              >
                Cancelar
              </button>
              <button
                className="btn-primary"
                style={{ flex: 1, padding: "10px" }}
                onClick={() => {
                  if (pinModalCallback) pinModalCallback(pinValue);
                  setShowPinModal(false);
                }}
              >
                Autorizar
              </button>
            </div>
          </div>
        </div>
      )}

      {showSyncLogModal && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.75)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          backdropFilter: "blur(5px)"
        }}>
          <div className="glass-panel" style={{
            padding: "25px",
            width: "550px",
            background: "rgba(22, 22, 34, 0.95)",
            border: "1px solid var(--glass-border)",
            boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
            display: "flex",
            flexDirection: "column",
            gap: "15px"
          }}>
            <div className="flex-between">
              <h3 style={{ color: "var(--color-primary)", margin: 0 }}>📋 Bitácora de Sincronización Offline</h3>
              <button
                onClick={() => setShowSyncLogModal(false)}
                style={{ background: "transparent", border: "none", color: "white", fontSize: "1.2rem", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>
            
            <p style={{ fontSize: "0.85rem", opacity: 0.8 }}>
              Listado de las últimas 10 ventas/reclamos que fueron cobradas en modo offline y sincronizadas exitosamente en la nube.
            </p>

            <div style={{ maxHeight: "300px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px" }}>
              {(() => {
                if (typeof window === "undefined") return null;
                const logs = JSON.parse(localStorage.getItem("ERIKA_OFFLINE_SYNC_LOG") || "[]");
                if (logs.length === 0) {
                  return (
                    <div style={{ padding: "20px", textAlign: "center", opacity: 0.5, fontSize: "0.9rem" }}>
                      No hay registros de sincronización recientes.
                    </div>
                  );
                }
                return logs.map((log: any, idx: number) => (
                  <div key={idx} style={{
                    padding: "10px 15px",
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.05)",
                    borderRadius: "6px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "10px"
                  }}>
                    <div style={{ flex: 1, textAlign: "left" }}>
                      <strong style={{ fontSize: "0.9rem", color: "var(--color-secondary)" }}>{log.description}</strong>
                      <span style={{ display: "block", fontSize: "0.75rem", opacity: 0.6, marginTop: "2px" }}>
                        Sincronizado: {new Date(log.synced_at).toLocaleString()}
                      </span>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <strong style={{ fontSize: "0.95rem" }}>${parseFloat(log.amount).toFixed(2)}</strong>
                      <span style={{ display: "block", color: "#10b981", fontSize: "0.75rem", fontWeight: "bold", marginTop: "2px" }}>
                        ✓ {log.status.toUpperCase()}
                      </span>
                    </div>
                  </div>
                ));
              })()}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
              <button
                className="btn-primary"
                style={{ padding: "8px 20px" }}
                onClick={() => setShowSyncLogModal(false)}
              >
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}

      {showQuickCustomerModal && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.75)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          backdropFilter: "blur(5px)"
        }}>
          <div className="glass-panel" style={{
            padding: "25px",
            width: "350px",
            background: "rgba(22, 22, 34, 0.95)",
            border: "1px solid var(--glass-border)",
            boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
            display: "flex",
            flexDirection: "column",
            gap: "15px"
          }}>
            <h3 style={{ color: "var(--color-primary)", margin: 0, textAlign: "center" }}>➕ Registro Rápido de Cliente</h3>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
              <label style={{ fontSize: "0.85rem", opacity: 0.9, textAlign: "left" }}>Nombre Completo:</label>
              <input
                type="text"
                placeholder="Nombre del cliente"
                value={quickCustomerName}
                onChange={(e) => setQuickCustomerName(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "6px",
                  border: "1px solid var(--glass-border)",
                  background: "rgba(0,0,0,0.3)",
                  color: "white"
                }}
                autoFocus
              />
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
              <label style={{ fontSize: "0.85rem", opacity: 0.9, textAlign: "left" }}>Teléfono (Opcional):</label>
              <input
                type="text"
                placeholder="10 dígitos"
                maxLength={10}
                value={quickCustomerPhone}
                onChange={(e) => setQuickCustomerPhone(e.target.value.replace(/\D/g, ""))}
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "6px",
                  border: "1px solid var(--glass-border)",
                  background: "rgba(0,0,0,0.3)",
                  color: "white"
                }}
              />
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
              <button
                className="btn-primary inactive"
                style={{ flex: 1, padding: "10px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
                onClick={() => {
                  setShowQuickCustomerModal(false);
                  setQuickCustomerName("");
                  setQuickCustomerPhone("");
                }}
                disabled={isSavingQuickCustomer}
              >
                Cancelar
              </button>
              <button
                className="btn-primary"
                style={{ flex: 1, padding: "10px" }}
                onClick={handleSaveQuickCustomer}
                disabled={isSavingQuickCustomer}
              >
                {isSavingQuickCustomer ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCustomerHistoryModal && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.75)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          backdropFilter: "blur(5px)"
        }}>
          <div className="glass-panel" style={{
            padding: "25px",
            width: "500px",
            maxWidth: "90%",
            maxHeight: "85vh",
            overflowY: "auto",
            background: "rgba(22, 22, 34, 0.95)",
            border: "1px solid var(--glass-border)",
            boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
            display: "flex",
            flexDirection: "column",
            gap: "20px"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ color: "var(--color-primary)", margin: 0 }}>
                📅 Historial de Compras
              </h3>
              <button
                onClick={() => setShowCustomerHistoryModal(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#ef4444",
                  fontSize: "1.2rem",
                  cursor: "pointer"
                }}
              >
                ✕
              </button>
            </div>
            
            <p style={{ margin: 0, fontSize: "0.9rem", opacity: 0.8, textAlign: "left" }}>
              Últimas 5 compras de <strong>{customers.find(c => c.id === selectedCustomerId)?.name}</strong>:
            </p>

            <input
              type="text"
              placeholder="🔍 Filtrar por nombre de producto..."
              value={historySearchTerm}
              onChange={e => setHistorySearchTerm(e.target.value)}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "6px",
                border: "1px solid var(--glass-border)",
                background: "rgba(0,0,0,0.3)",
                color: "white",
                marginBottom: "5px"
              }}
            />

            <div style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
              {(() => {
                const filtered = customerHistoryTickets.filter(ticket => {
                  if (!historySearchTerm) return true;
                  let ticketItems = [];
                  if (typeof ticket.items === "string") {
                    try { ticketItems = JSON.parse(ticket.items); } catch { ticketItems = []; }
                  } else {
                    ticketItems = Array.isArray(ticket.items) ? ticket.items : [];
                  }
                  return ticketItems.some((item: any) => 
                    item.name.toLowerCase().includes(historySearchTerm.toLowerCase())
                  );
                });
                
                if (filtered.length === 0) {
                  return (
                    <div style={{ textAlign: "center", padding: "20px", opacity: 0.6 }}>
                      No se encontraron compras que coincidan con la búsqueda.
                    </div>
                  );
                }

                return filtered.map((ticket) => {
                  let ticketItems = [];
                  if (typeof ticket.items === "string") {
                    try { ticketItems = JSON.parse(ticket.items); } catch { ticketItems = []; }
                  } else {
                    ticketItems = Array.isArray(ticket.items) ? ticket.items : [];
                  }

                  const purchaseDate = new Date(ticket.created_at);
                  const diffDays = Math.ceil((Date.now() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24));
                  const remainingDays = 30 - diffDays;
                  const hasWarranty = remainingDays >= 0;

                  return (
                    <div 
                      key={ticket.id} 
                      style={{
                        padding: "15px",
                        borderRadius: "8px",
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", opacity: 0.9 }}>
                        <span><strong>Ticket:</strong> #{ticket.id}</span>
                        <span>{new Date(ticket.created_at).toLocaleDateString()} {new Date(ticket.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                      </div>
                      
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.8rem", color: hasWarranty ? "#10b981" : "#ef4444" }}>
                        <span>🛡️ {hasWarranty ? `Garantía activa (${remainingDays} días rest.)` : "Garantía vencida"}</span>
                      </div>

                      {ticket.notes && (
                        <div style={{ fontSize: "0.8rem", background: "rgba(245,158,11,0.1)", borderLeft: "3px solid #f59e0b", padding: "5px 10px", borderRadius: "4px", color: "#f59e0b", textAlign: "left" }}>
                          <strong>Nota:</strong> {ticket.notes}
                        </div>
                      )}
                      
                      <div style={{ display: "flex", flexDirection: "column", gap: "5px", fontSize: "0.85rem", paddingLeft: "10px", borderLeft: "2px solid var(--color-primary)" }}>
                        {ticketItems.map((item: any, idx: number) => (
                          <div key={idx} style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ textAlign: "left" }}>{item.qty} {item.unit || "PZA"} x {item.name}</span>
                            <span>${((item.price || 0) * (item.qty || 1)).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px dashed rgba(255,255,255,0.1)", paddingTop: "8px", gap: "8px" }}>
                        <div style={{ display: "flex", gap: "5px" }}>
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={() => cloneTicketItems(ticket.items)}
                            style={{ padding: "5px 10px", fontSize: "0.8rem", background: "transparent", border: "1px solid var(--color-primary)", color: "var(--color-primary)" }}
                          >
                            🔄 Clonar
                          </button>
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={() => handleReprintHistoryTicket(ticket)}
                            style={{ padding: "5px 10px", fontSize: "0.8rem", background: "transparent", border: "1px solid #10b981", color: "#10b981" }}
                          >
                            🖨️ Imprimir
                          </button>
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={() => handleSaveTicketNote(ticket.id, ticket.notes)}
                            style={{ padding: "5px 10px", fontSize: "0.8rem", background: "transparent", border: "1px solid #f59e0b", color: "#f59e0b" }}
                          >
                            📝 Nota
                          </button>
                        </div>
                        <span style={{ fontWeight: "bold", fontSize: "0.95rem", color: "var(--color-secondary)" }}>Total: ${ticket.total.toFixed(2)}</span>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            <button
              className="btn-primary"
              style={{ width: "100%", padding: "10px", marginTop: "10px" }}
              onClick={() => setShowCustomerHistoryModal(false)}
            >
              Cerrar Historial
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
