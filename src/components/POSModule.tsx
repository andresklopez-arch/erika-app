"use client";
import { useState, useEffect, useRef } from "react";
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
import IntelligenceNotifications from "./IntelligenceNotifications";
import PosScannerModal from "./PosScannerModal";
import PosCreditModal from "./PosCreditModal";
import ReprintButton from "./ReprintButton";
import { useAuth, useBusinessProfile } from "./AuthProvider";
import { CustomerSchema, CashSessionSchema } from "../lib/schemas";
import { getOrReconnectBlePrinter, sendBleBytes, startBleKeepAlive, getBleStatus, BleStatusType, sanitizeForThermal } from "../utils/bluetoothPrinter";
import { insertCashTransaction } from "../lib/cashTransactionClient";
import { saveCustomer, adjustCustomerPoints, fetchActiveCustomers } from "../lib/customersClient";
import { createLayaway } from "../lib/layawaysClient";
import { reduceInventoryStock } from "../lib/inventoryClient";
import { saveQuote } from "../lib/quotesClient";
import { cleanMexicanPhone, openWhatsAppChat } from "../lib/whatsapp";
import { matchesProduct } from "../lib/posItemMatch";
import { getSmartVolumeDiscount, getNextSmartVolumeTier } from "../lib/smartVolumeDiscount";
import { normalizeText } from "../utils/levenshtein";
import { Z_INDEX } from "../lib/zIndex";
import { usePinPrompt } from "../hooks/usePinPrompt";

// Único valor de método de pago que dispara lógica especial de crédito
// (segunda copia, etiqueta "VENTA A CRÉDITO", validaciones). Se compara
// contra `job.data?.paymentMethod` que llega tipado como `any`, así que
// TypeScript no detectaría un typo si se repitiera el literal a mano.
const PAYMENT_METHOD_CREDITO = "credito" as const;

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
  customerId?: string;
  // id de la cotización de la que se restauró este carrito (si aplica).
  // Se usa para marcar la cotización como "converted" (vendida) solo
  // cuando el cobro realmente se completa aquí, no antes.
  quoteId?: string;
}

// Snapshot ya calculado (subtotal/iva/descuento/total) de un ticket o
// apartado, listo para renderizar en el recibo imprimible. Se arma una vez
// en executePrintWindow y se guarda aquí en vez de recalcularlo en el JSX.
interface ReceiptToPrint {
  type: "ticket" | "layaway";
  ticketId?: number | string;
  customerName: string;
  items: POSItem[];
  subtotal: number;
  iva: number;
  discountPct: number;
  discountAmount: number;
  finalTotal: number;
  invoiceToken?: number | string;
  paymentMethod?: string;
  downPayment?: number;
  balance?: number;
  cashAmount?: number;
  cardAmount?: number;
  transferAmount?: number;
  reference?: string;
  notes?: string;
  // Cuántas veces debe llamarse window.print() en serie (copia doble en
  // impresora "system") — ver el useEffect que consume receiptToPrint.
  _printCopies?: number;
  isCancelled?: boolean;
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

const FOLIO_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

// 🎟️ Generador y Formateador de Folio Alfanumérico de 6 Dígitos con separadores -,+,*
// Convierte cualquier ID numérico/UUID en un folio legible de 6 caracteres (ej. 8B-2K*9M)
export const formatTicketFolio = (rawId: any): string => {
  if (!rawId) return "TK-00*00";
  const rawStr = String(rawId).trim();

  if (/^[A-Z0-9]{2}[-+*][A-Z0-9]{2}[-+*][A-Z0-9]{2}$/i.test(rawStr)) {
    return rawStr.toUpperCase();
  }

  const clean = rawStr.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (clean.length === 6) {
    return `${clean.slice(0, 2)}-${clean.slice(2, 4)}*${clean.slice(4, 6)}`;
  }

  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = ((hash << 5) - hash) + clean.charCodeAt(i);
    hash |= 0;
  }
  let num = Math.abs(hash);
  let res = "";
  for (let i = 0; i < 6; i++) {
    res += FOLIO_CHARS.charAt(num % FOLIO_CHARS.length);
    num = Math.floor(num / FOLIO_CHARS.length) + (clean.charCodeAt(i % clean.length) || 7);
  }
  return `${res.slice(0, 2)}-${res.slice(2, 4)}*${res.slice(4, 6)}`;
};

// Se re-exporta getSmartVolumeDiscount aqui (ver import arriba) para no
// romper el import existente en QuotesModule.tsx (`from "./POSModule"`).
export { getSmartVolumeDiscount, getNextSmartVolumeTier };

// El "Mayoreo Automático" (descuento fijo global a partir de N piezas,
// configurado en Configuración) se retiró: era redundante con el Descuento
// Inteligente (que ya cubre el mismo caso con una regla targetType:"all")
// y, al combinarse con Math.max, podía "ganarle" a la regla inteligente y
// quedarse aplicado a un producto que no debía llevar ese descuento en
// particular -- el "se queda fijado aunque se cambie de producto" que se
// reportó. _wholesaleRules se deja en la firma (sin usarse) para no tener
// que tocar sus ~20 sitios de llamada en este archivo; ya no influye en el
// precio final.
const getItemFinalPrice = (item: any, _wholesaleRules: any, smartVolumeRules?: any[]): number => {
  const productDiscountPct = item.discountPct || 0;
  const smartDisc = smartVolumeRules ? getSmartVolumeDiscount(item, smartVolumeRules).discountPct : 0;
  const maxDiscountPct = Math.max(productDiscountPct, smartDisc);
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

const COMPANION_RULES: { keywords: string[]; complements: string[] }[] = [
  {
    keywords: ["pintura", "esmalte", "vinilica", "aerosol", "impermeabilizante", "barniz", "sellador", "tinte", "laca", "thinner", "aguarras", "esmalack", "comex", "sayer"],
    complements: ["brocha", "rodillo", "charola", "thinner", "cinta masking", "masking", "lija", "espatula", "plastico"]
  },
  {
    keywords: ["repisa", "madera", "tabla", "triplay", "soporte", "mensula", "escuadra", "mueble", "closet"],
    complements: ["pija", "taquete", "tornillo", "broca", "mensula", "desarmador", "nivel", "pegamento", "lija"]
  },
  {
    keywords: ["silicon", "silicona", "sellador", "no mas clavos", "adhesivo", "cemento de contacto", "resistol"],
    complements: ["pistola", "espatula", "cinta", "cutter", "exacto", "estopa", "alcohol"]
  },
  {
    keywords: ["tubo", "tuberia", "pvc", "cpvc", "cobre", "manguera", "llave", "mezcladora", "regadera", "cespol", "flotador", "tinaco", "valvula", "codo", "cople", "conector", "sanitario", "wc", "tarja"],
    complements: ["teflon", "cinta teflon", "pegamento", "soldadura", "pasta", "perico", "stilson", "abrazadera", "empaque"]
  },
  {
    keywords: ["cable", "alambre", "foco", "lampara", "led", "apagador", "contacto", "clavija", "socket", "breaker", "canaleta", "conduit", "placa"],
    complements: ["cinta de aislar", "aislar", "guia", "pinza", "desarmador", "probador", "taquetes", "pijas"]
  },
  {
    keywords: ["tornillo", "pija", "perno", "tuerca", "arandela", "clavo", "taquete", "remache"],
    complements: ["desarmador", "broca", "taquete", "pinzas", "martillo", "rondana", "taladro"]
  },
  {
    keywords: ["cerradura", "chapa", "candado", "bisagra", "cerrojo", "manija", "pomo"],
    complements: ["tornillos", "pijas", "wd40", "lubricante", "broca", "desarmador"]
  },
  {
    keywords: ["cemento", "yeso", "pegalulejo", "mortero", "cal", "arena"],
    complements: ["cuchara", "llana", "espatula", "boti", "nivel", "guantes"]
  },
  {
    keywords: ["disco", "corte", "sierra", "segueta", "arco", "esmeriladora", "pulidora"],
    complements: ["lentes", "careta", "guantes", "disco", "desbaste"]
  },
  {
    keywords: ["manguera", "aspersor", "pistola", "pala", "rastrillo", "tijera"],
    complements: ["abrazadera", "conexion", "copla", "teflon", "guantes"]
  }
];

export default function POSModule() {
  const { currentUser, businessSettings, bleCharacteristic, setBleCharacteristic } = useAuth();
  const businessProfile = useBusinessProfile();
  const [globalCatalog, setGlobalCatalog] = useState<any[]>([]);
  const [topSellingProducts, setTopSellingProducts] = useState<any[]>([]);
  const [learnedPairsMap, setLearnedPairsMap] = useState<Record<string, Record<string, number>>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(localStorage.getItem("ERIKA_LEARNED_PAIRS") || "{}");
    } catch {
      return {};
    }
  });
  const [offlinePendingCount, setOfflinePendingCount] = useState(0);
  const [bleStatus, setBleStatus] = useState<BleStatusType>("disconnected");

  useEffect(() => {
    const pType = businessSettings?.config?.printer_type || localStorage.getItem("ERIKA_PRINTER_TYPE") || "system";
    if (pType === "bluetooth") {
      setBleStatus(getBleStatus(bleCharacteristic));
      const stopKeepAlive = startBleKeepAlive(
        () => bleCharacteristic,
        (newStatus, newChar) => {
          setBleStatus(newStatus);
          if (newChar && newChar !== bleCharacteristic) {
            setBleCharacteristic(newChar);
          }
        },
        20000
      );
      return () => stopKeepAlive();
    }
  }, [businessSettings?.config?.printer_type, bleCharacteristic]);

  const [loyaltyRates, setLoyaltyRates] = useState({
    earnRate: 100, // $100 -> 1 pt
    earnPoints: 1,
    redeemRate: 10, // 10 pts -> $1 discount
  });
  
  const [wholesaleRules, setWholesaleRules] = useState({
    minQty: 10,
    discountPct: 10,
  });

  const [smartVolumeRules, setSmartVolumeRules] = useState<any[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = localStorage.getItem("ERIKA_SMART_VOLUME_RULES");
      if (saved) return JSON.parse(saved);
      return [
        {
          id: "rule-pijas-default",
          name: "Pijas por Volumen",
          targetType: "keyword",
          targetValue: "pija",
          tiers: [
            { minQty: 20, discountPct: 5 },
            { minQty: 30, discountPct: 30 }
          ],
          active: true,
          createdAt: new Date().toISOString()
        }
      ];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    const loadSmartRules = () => {
      try {
        const saved = localStorage.getItem("ERIKA_SMART_VOLUME_RULES");
        if (saved) setSmartVolumeRules(JSON.parse(saved));
      } catch (e) {}
    };

    window.addEventListener("erika_smart_rules_updated", loadSmartRules);
    window.addEventListener("storage", loadSmartRules);
    return () => {
      window.removeEventListener("erika_smart_rules_updated", loadSmartRules);
      window.removeEventListener("storage", loadSmartRules);
    };
  }, []);

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

    const savedPending = localStorage.getItem("ERIKA_PENDING_PRINT_JOB");
    if (savedPending) {
      try {
        setPendingPrintJob(JSON.parse(savedPending));
      } catch (e) {}
    }

    const savedLast = localStorage.getItem("ERIKA_LAST_PRINT_JOB");
    if (savedLast) {
      try {
        setLastPrintJob(JSON.parse(savedLast));
      } catch (e) {}
    }
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
  const [selectedCustomerIdState, setSelectedCustomerIdState] = useState("");
  const selectedCustomerId = selectedCustomerIdState;
  const setSelectedCustomerId = (id: string) => {
    setSelectedCustomerIdState(id);
    setTickets((prev) =>
      prev.map((t) => (t.id === activeTicketId ? { ...t, customerId: id } : t))
    );
  };

  useEffect(() => {
    const activeT = tickets.find((t) => t.id === activeTicketId);
    setSelectedCustomerIdState(activeT?.customerId || "");
  }, [activeTicketId, tickets]);
  const [customerActiveStats, setCustomerActiveStats] = useState<{ layawaysCount: number; quotesCount: number } | null>(null);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"efectivo" | "tarjeta" | "transferencia" | "mixto" | "credito">("efectivo");
  const [cashPayAmount, setCashPayAmount] = useState("");
  const [cardPayAmount, setCardPayAmount] = useState("");
  const [transferPayAmount, setTransferPayAmount] = useState("");
  const [applyIva, setApplyIva] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [paymentReference, setPaymentReference] = useState("");
  const [receiptToPrint, setReceiptToPrint] = useState<ReceiptToPrint | null>(null);
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [isCreatingLayaway, setIsCreatingLayaway] = useState(false);
  // Token de idempotencia por intento de cobro: se genera UNA vez al abrir
  // el modal de pago y se reutiliza en cada reintento (ej. si la respuesta
  // se pierde por una desconexión momentánea y el cajero reintenta con el
  // mismo ticket). Antes un reintento así podía duplicar la venta completa
  // (doble ingreso en caja y doble descuento de inventario) porque no
  // existía forma de saber que ya se había intentado antes.
  const checkoutTokenRef = useRef<string | null>(null);

  // Modal del PIN, compartido con QuotesModule vía usePinPrompt()
  const { getPinAsync, PinModal } = usePinPrompt();

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

  // Id del item del carrito cuyo selector de "otras presentaciones" está
  // abierto (ver switchCartItemVariant) -- surge del bug del 2026-08-25:
  // agregar la presentación equivocada (mismo nombre, código distinto) no
  // creaba error, solo colapsaba mal en el carrito. Esto le da al cajero
  // una forma explícita de corregirlo sin borrar la línea y buscar de nuevo.
  const [showVariantsFor, setShowVariantsFor] = useState<string | null>(null);

  // Estados para Modal de Consulta y Reimpresión de Tickets Anteriores (Buscar Tickets)
  const [showTicketsHistoryModal, setShowTicketsHistoryModal] = useState(false);
  const [ticketsHistoryList, setTicketsHistoryList] = useState<any[]>([]);
  const [isLoadingTicketsHistory, setIsLoadingTicketsHistory] = useState(false);
  const [ticketSearchQuery, setTicketSearchQuery] = useState("");
  const [ticketDateFilter, setTicketDateFilter] = useState("");
  const [selectedHistoryTicket, setSelectedHistoryTicket] = useState<any | null>(null);

  // Estados para Modal de Cancelación de Tickets (Autorizado con Clave de Administrador)
  const [showCancelTicketModal, setShowCancelTicketModal] = useState(false);
  const [cancelTicketsList, setCancelTicketsList] = useState<any[]>([]);
  const [isLoadingCancelTickets, setIsLoadingCancelTickets] = useState(false);
  const [cancelTicketSearchQuery, setCancelTicketSearchQuery] = useState("");
  const [selectedCancelTicket, setSelectedCancelTicket] = useState<any | null>(null);
  const [isCancellingTicket, setIsCancellingTicket] = useState(false);

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

  useEffect(() => {
    if (!selectedCustomerId) {
      setCustomerActiveStats(null);
      return;
    }

    const fetchStats = async () => {
      const { count: layawaysCount } = await supabase
        .from("layaways")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", selectedCustomerId)
        .eq("status", "pending");

      const { count: quotesCount } = await supabase
        .from("quotes")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", selectedCustomerId)
        .eq("status", "pending");

      setCustomerActiveStats({
        layawaysCount: layawaysCount || 0,
        quotesCount: quotesCount || 0
      });
    };

    fetchStats();
  }, [selectedCustomerId]);

  const handleSaveQuickCustomer = async () => {
    if (!quickCustomerName.trim()) return alert("El nombre del cliente es obligatorio.");
    setIsSavingQuickCustomer(true);
    try {
      const { data, error } = await saveCustomer({
        name: quickCustomerName.trim().toUpperCase(),
        phone: quickCustomerPhone.trim() || null,
      });

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
        const invItem = globalCatalog.find(i => matchesProduct(item, i));
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
        isReprint: true,
        data: {
           realTicketId: ticket.id,
           quoteUuid: ticket.id,
           items: ticketItems,
           finalTotal: Number(ticket.total) || 0,
           discountPct: ticket.discount_pct || 0,
           applyIva: ticket.apply_iva || false,
           paymentMethod: ticket.notes ? (ticket.notes.toLowerCase().includes("efectivo") ? "efectivo" : ticket.notes.toLowerCase().includes("tarjeta") ? "tarjeta" : ticket.notes.toLowerCase().includes("transferencia") ? "transferencia" : "mixto") : "efectivo",
           customerName: ticket.customer_name && ticket.customer_name !== "Venta Mostrador" ? ticket.customer_name : "",
           // Un ticket cancelado se puede seguir reimprimiendo (el cliente a
           // veces lo pide como comprobante de la anulación), pero nunca sin
           // que quede claro en el papel que ya no es una venta vigente --
           // antes salía idéntico a un ticket cobrado de verdad, sin ningún
           // aviso (reporte de Ferretería Erika).
           isCancelled: ticket.status === "cancelled"
        }
     });

     // Registrar log silencioso de auditoría para trazabilidad de reimpresiones
     LoggerService.logError(
       "Ticket_Reimpresion",
       JSON.stringify({
         ticket_id: ticket.id,
         total: ticket.total,
         items_count: ticketItems.length,
         cliente: ticket.customer_name || "Mostrador",
         reimpreso_en: new Date().toISOString()
       }),
       currentUser?.name || currentUser?.role || "Cajero"
     );

     // Se muestra el folio formateado (ej. XU-XQ*ZW), no el id crudo de la
     // base -- es lo que el cajero ve en pantalla y en el ticket impreso.
     toast.success(`🖨️ Reenviando Copia Reimpresa Ticket #${formatTicketFolio(ticket.id)}`);
  };

  const handleSaveTicketNote = async (ticketId: number, currentNotes: string) => {
     const newNotes = window.prompt("Escribe una nota para este ticket:", currentNotes || "");
     if (newNotes === null) return;

     const { error } = await saveQuote({ id: ticketId, fields: { notes: newNotes.trim() } });

     if (error) {
       console.warn("Falla al guardar nota en quotes, reintentando con description...");
       const { error: fallbackError } = await saveQuote({ id: ticketId, fields: { description: newNotes.trim() } });

       if (fallbackError) {
         return alert("❌ Error al guardar nota: " + fallbackError.message);
       }
     }
     
     setCustomerHistoryTickets(prev => 
       prev.map(t => t.id === ticketId ? { ...t, notes: newNotes.trim() } : t)
     );
     toast.success("✅ Nota de ticket actualizada.");
  };

  const fetchTicketsHistory = async () => {
    setIsLoadingTicketsHistory(true);
    try {
      // 1. Cargar transacciones offline locales primero si existen
      let localOfflineList: any[] = [];
      try {
        const off = await getOfflineTransactions();
        if (off && off.length > 0) {
          localOfflineList = off.map((tx: any) => ({
            id: tx.id || `OFF-${tx.offlineId || 1}`,
            created_at: tx.timestamp || new Date().toISOString(),
            total: Number(tx.data?.finalTotal || tx.total || 0),
            items: tx.data?.items || tx.items || [],
            notes: tx.data?.paymentMethod ? `Pago: ${String(tx.data.paymentMethod).toUpperCase()}` : "Offline",
            customer_name: tx.data?.customerName || tx.customer_name || "Venta Mostrador",
            status: "offline"
          }));
        }
      } catch (e) {
        console.warn("No se pudieron leer ventas offline:", e);
      }

      // 2. Consulta a Supabase con protección de timeout de 6 segundos
      const fetchPromise = supabase
        .from("quotes")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      const timeoutPromise = new Promise<{ data: null; error: any }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: new Error("Tiempo de espera agotado") }), 6000)
      );

      const res = await Promise.race([fetchPromise, timeoutPromise]);
      const data = res?.data;

      if (data && Array.isArray(data)) {
        // Unir datos de la nube con transacciones offline locales si las hay
        setTicketsHistoryList([...localOfflineList, ...data]);
      } else if (localOfflineList.length > 0) {
        setTicketsHistoryList(localOfflineList);
      } else {
        setTicketsHistoryList([]);
      }
    } catch (err: any) {
      console.error("Error fetching tickets history:", err);
      toast.error("Error al cargar historial: " + (err.message || err));
      setTicketsHistoryList([]);
    } finally {
      setIsLoadingTicketsHistory(false);
    }
  };

  const openTicketsHistoryModal = () => {
    setTicketSearchQuery("");
    setTicketDateFilter("");
    setSelectedHistoryTicket(null);
    setShowTicketsHistoryModal(true);
    fetchTicketsHistory();
  };

  const openCancelTicketModal = async () => {
    setCancelTicketSearchQuery("");
    setSelectedCancelTicket(null);
    setShowCancelTicketModal(true);
    setIsLoadingCancelTickets(true);

    try {
      let localOfflineList: any[] = [];
      try {
        const off = await getOfflineTransactions();
        if (off && off.length > 0) {
          localOfflineList = off.map((tx: any) => ({
            id: tx.id || `OFF-${tx.offlineId || 1}`,
            created_at: tx.timestamp || new Date().toISOString(),
            total: Number(tx.data?.finalTotal || tx.total || 0),
            items: tx.data?.items || tx.items || [],
            notes: tx.data?.paymentMethod ? `Pago: ${String(tx.data.paymentMethod).toUpperCase()}` : "Offline",
            customer_name: tx.data?.customerName || tx.customer_name || "Venta Mostrador",
            status: "offline"
          }));
        }
      } catch {}

      const { data, error } = await supabase
        .from("quotes")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(35);

      if (error) {
        console.error("Error al cargar tickets:", error);
      }
      const combined = [...localOfflineList, ...(data || [])];
      setCancelTicketsList(combined);
      if (combined.length > 0) {
        setSelectedCancelTicket(combined[0]);
      }
    } catch (e) {
      console.error("Error al abrir modal de cancelación:", e);
    } finally {
      setIsLoadingCancelTickets(false);
    }
  };

  const handleExecuteCancelTicket = async (ticket: any) => {
    if (!ticket) return;
    if (ticket.status === "cancelled") {
      return alert("⚠️ Este ticket ya se encuentra cancelado.");
    }

    const folioFormatted = formatTicketFolio(ticket.id);
    const pin = await getPinAsync(
      "🔒 AUTORIZACIÓN DE CANCELACIÓN",
      `¿Deseas cancelar el Ticket #${folioFormatted} por un total de $${Number(ticket.total || 0).toFixed(2)}?\n\nIngresa la clave/PIN de Administrador para autorizar:`
    );
    if (!pin) return;
    const isValidAdmin = await verifyAdminPinRemote(pin);
    if (!isValidAdmin) {
      return alert("❌ PIN incorrecto o sin privilegios de Administrador. Cancelación rechazada.");
    }

    const shouldReturnStock = window.confirm(
      `¿Deseas regresar los artículos del Ticket #${folioFormatted} al inventario físico?`
    );

    setIsCancellingTicket(true);
    try {
      let itemsArr: any[] = [];
      if (typeof ticket.items === "string") {
        try { itemsArr = JSON.parse(ticket.items); } catch { itemsArr = []; }
      } else if (Array.isArray(ticket.items)) {
        itemsArr = ticket.items;
      }

      const cancelNote = `CANCELADO por Administrador el ${new Date().toLocaleString()}`;
      const newNotes = ticket.notes ? `${ticket.notes} | ${cancelNote}` : cancelNote;

      // El guardado en `quotes` va PRIMERO, antes de tocar inventario/caja --
      // antes iba al final, así que un fallo aquí (ej. el bug del
      // 2026-08-24: quotes_status_check nunca permitió 'cancelled') dejaba
      // el stock YA regresado al inventario físico mientras el ticket
      // seguía "vigente" en la base, una inconsistencia real que solo se
      // podía corregir a mano. Con este orden, si el guardado falla no se
      // mueve nada más: no hay nada que verificar ni deshacer.
      const { error: updErr } = await saveQuote({
        id: ticket.id,
        fields: { status: "cancelled", notes: newNotes },
      });

      if (updErr) {
        console.error("Falla al actualizar status de ticket:", updErr);
        // Se registra en error_logs con el mismo prefijo "Cancelacion_" que
        // usa la auditoría de éxito -- SettingsModule.tsx cuenta estas
        // fallas (24h) en el panel de Salud del Catálogo, mismo patrón que
        // el contador de "fallas de impresión" (módulo "Print_%").
        LoggerService.logError(
          "Cancelacion_Ticket_Fallida",
          `Ticket #${folioFormatted} (ID: ${ticket.id}): ${updErr.message}`,
          currentUser?.name
        );
        alert(`❌ No se pudo guardar la cancelación del Ticket #${folioFormatted} en la base de datos: ${updErr.message}\n\nNo se movió inventario ni caja -- puedes reintentar sin riesgo de duplicar nada.`);
        return;
      }

      // Reincorporar existencias en el inventario físico
      if (shouldReturnStock && itemsArr.length > 0) {
        const stockFailures: string[] = [];
        for (const item of itemsArr) {
          if (item.price > 0 && item.name) {
            const invMatch = globalCatalog.find(c => c.name.toLowerCase() === item.name.toLowerCase());
            if (invMatch) {
              const qty = Number(item.qty || 1);
              const { error: stockErr } = await reduceInventoryStock(
                [{ id: invMatch.id, qty: -qty }],
                "cancellation",
                `TICKET-CANCEL-${ticket.id}`
              );
              if (stockErr) {
                stockFailures.push(item.name);
                console.warn(`Falla al restituir stock de "${item.name}":`, stockErr);
              } else {
                const newStock = (invMatch.stock || 0) + qty;
                setGlobalCatalog(prev => prev.map(p => p.id === invMatch.id ? { ...p, stock: newStock } : p));
              }
            }
          }
        }
        if (stockFailures.length > 0) {
          toast.error(`⚠️ No se pudo restituir stock de: ${stockFailures.join(", ")}. Verifica el inventario manualmente.`);
        }
      }

      // Registrar retiro en caja por la porción en EFECTIVO de la venta anulada
      // (solo el efectivo afecta el total físico esperado del corte; tarjeta y
      // transferencia no salen del cajón, así que no se tocan). El monto exacto
      // en efectivo no se guarda en el ticket (`quotes`) — se busca en la
      // transacción de venta original, que sí lo desglosa.
      try {
        const { data: origSaleTx } = await supabase
          .from("cash_transactions")
          .select("cash_amount, description")
          .eq("type", "sale")
          .ilike("description", `%Venta Ticket #${ticket.id}%`)
          .limit(1)
          .maybeSingle();

        let cashPortion = Number(origSaleTx?.cash_amount ?? 0);
        if (!cashPortion && origSaleTx?.description) {
          const m = origSaleTx.description.match(/\[CASH:([\d.]+)\]/);
          if (m) cashPortion = parseFloat(m[1]);
        }

        if (cashPortion > 0) {
          const { error: txErr } = await insertCashTransaction({
            type: "withdrawal",
            amount: cashPortion,
            description: `🚫 Cancelación de Ticket #${folioFormatted} (${ticket.customer_name || "Mostrador"})`,
          }, cashPortion > 2000 ? pin : undefined);
          if (txErr) {
            console.warn("Falla al registrar retiro de caja por anulación:", txErr.message);
            toast.error(`⚠️ El ticket se canceló, pero el retiro de $${cashPortion.toFixed(2)} en caja no se pudo registrar: ${txErr.message}. Ajusta el corte manualmente.`, { duration: 8000 });
          }
        }
      } catch (txErr: any) {
        console.warn("Falla al registrar transacción de anulación:", txErr);
        toast.error(`⚠️ El ticket se canceló, pero el retiro en caja no se pudo registrar: ${txErr?.message || txErr}. Ajusta el corte manualmente.`, { duration: 8000 });
      }

      // Auditoría en error_logs
      await LoggerService.logError(
        "Cancelacion_Ticket",
        `Ticket #${folioFormatted} (ID: ${ticket.id}) cancelado por $${Number(ticket.total || 0).toFixed(2)}. Reingreso Stock: ${shouldReturnStock ? "SÍ" : "NO"}. Items: ${JSON.stringify(itemsArr)}`,
        currentUser?.name
      );

      toast.success(`✅ Ticket #${folioFormatted} CANCELADO exitosamente.`);
      
      // Actualizar estado en la lista local
      setCancelTicketsList(prev => prev.map(t => t.id === ticket.id ? { ...t, status: "cancelled", notes: newNotes } : t));
      if (selectedCancelTicket?.id === ticket.id) {
        setSelectedCancelTicket({ ...selectedCancelTicket, status: "cancelled", notes: newNotes });
      }
    } catch (err: any) {
      console.error("Error al cancelar ticket:", err);
      alert("Error al cancelar ticket: " + (err.message || err));
    } finally {
      setIsCancellingTicket(false);
    }
  };

  const handleCloseTicket = (e: React.MouseEvent, ticketId: number) => {
    e.stopPropagation();
    if (tickets.length <= 1) {
      toast("Debe haber al menos 1 nota abierta.");
      return;
    }
    const ticketToClose = tickets.find((t) => t.id === ticketId);
    if (ticketToClose && ticketToClose.items.length > 0) {
      if (!confirm(`El Cliente ${ticketId} tiene ${ticketToClose.items.length} producto(s) en su nota. ¿Deseas descartar y cerrar esta nota?`)) {
        return;
      }
    }
    const newTickets = tickets.filter((t) => t.id !== ticketId);
    setTickets(newTickets);
    if (activeTicketId === ticketId) {
      setActiveTicketId(newTickets[0].id);
    }
    toast.success(`Nota Cliente ${ticketId} cerrada.`);
  };

  // Verifica un PIN de administrador del lado del servidor. Antes cada
  // pantalla de autorización comparaba el PIN directamente contra `users`
  // desde el navegador con la llave pública — ahora todas pasan por
  // /api/auth/verify-pin (Service Role Key, nunca expuesta al cliente).
  const verifyAdminPinRemote = async (pin: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/auth/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, requireRole: "admin" }),
      });
      const json = await res.json();
      return res.ok && json.valid === true;
    } catch (e) {
      console.error("Error al verificar PIN de administrador:", e);
      return false;
    }
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
  const [lastPrintJob, setLastPrintJob] = useState<any>(null);
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

  const normalizeString = normalizeText;

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
    const autoConnectBle = async () => {
      if (printerConnectionType === "bluetooth" && typeof window !== "undefined" && (navigator as any).bluetooth?.getDevices) {
        try {
          const devices = await (navigator as any).bluetooth.getDevices();
          if (devices.length > 0) {
            const device = devices[0];
            console.log("Auto-conectando a impresora vinculada:", device.name);
            const server = await device.gatt?.connect();
            if (server) {
              const services = await server.getPrimaryServices();
              let allCharacteristics: any[] = [];
              for (const service of services) {
                try {
                  const characteristics = await service.getCharacteristics();
                  allCharacteristics.push(...characteristics);
                } catch (e) {
                  console.warn("Error al leer características:", e);
                }
              }
              const writeChars = allCharacteristics.filter(c => c.properties.write || c.properties.writeWithoutResponse);
              const KNOWN_PATTERNS = ["e7e2", "ae01", "ae02", "18f1", "2af1", "4954"];
              let char = writeChars.find(c => {
                const uuidLower = c.uuid.toLowerCase();
                return KNOWN_PATTERNS.some(pat => uuidLower.includes(pat));
              });
              if (!char) char = writeChars.find(c => c.properties.writeWithoutResponse);
              if (!char) char = writeChars[0];

              if (char) {
                setBleCharacteristic(char);
                console.log("Auto-conexión Bluetooth exitosa con característica:", char.uuid);
              }
            }
          }
        } catch (err) {
          console.warn("Fallo en auto-conexión Bluetooth:", err);
        }
      }
    };
    autoConnectBle();
  }, [printerConnectionType]);

  useEffect(() => {
    if (businessSettings?.config) {
      setPrinterConnectionType(businessSettings.config.printer_type || "system");
      setIsPrinterConnected(businessSettings.config.printer_connected !== false);
    }
  }, [businessSettings]);

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
        fetchTopSellingProducts(allData);
      }

      const { data: custData, error: custError } = await fetchActiveCustomers({
        warn: businessSettings?.config?.customer_list_warn_threshold,
        danger: businessSettings?.config?.customer_list_danger_threshold,
      });
      if (custError) {
        console.error("Error al cargar clientes:", custError);
        LoggerService.logError("POSModule_fetchCustomers_fallback", custError);
        toast.error(`Error al cargar lista de clientes: ${custError.message}`);
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
                // Se conserva el id de la cotización de origen: la
                // cotización se marca "vendida" (converted) solo cuando el
                // cobro se complete de verdad en handleCheckoutSubmit, no
                // antes (antes se marcaba "converted" al solo enviarla a
                // caja, aunque el cajero cancelara o nunca cobrara).
                const savedQuoteId = localStorage.getItem("ERIKA_RESTORE_QUOTE_ID");
                const savedQuoteNumber = localStorage.getItem("ERIKA_RESTORE_QUOTE_NUMBER");
                localStorage.removeItem("ERIKA_RESTORE_QUOTE_NUMBER");
                // Restaurar tambien el % de descuento/aumento y el IVA con
                // los que se guardo la cotizacion -- antes discountPct se
                // ponia en 0 a fuerza y el IVA se dejaba como estuviera en
                // la sesion actual, sin importar como se habia cotizado
                // originalmente. Bug real: cotizacion por $46.80 (con 4%
                // de aumento aplicado), venta resultante por $45.00 (sin el
                // aumento) porque se perdia al mandarla a caja.
                const restoredDiscountPct = Number(localStorage.getItem("ERIKA_RESTORE_QUOTE_DISCOUNT_PCT")) || 0;
                const restoredApplyIva = localStorage.getItem("ERIKA_RESTORE_QUOTE_APPLY_IVA") === "true";
                localStorage.removeItem("ERIKA_RESTORE_QUOTE_DISCOUNT_PCT");
                localStorage.removeItem("ERIKA_RESTORE_QUOTE_APPLY_IVA");
                setTickets([{ id: 1, items, discountPct: restoredDiscountPct, quoteId: savedQuoteId || undefined }]);
                setActiveTicketId(1);
                setApplyIva(restoredApplyIva);

                // Restablecer cliente si existe
                const savedCustId = localStorage.getItem("ERIKA_RESTORE_CUSTOMER_ID");
                if (savedCustId) {
                   setSelectedCustomerId(savedCustId);
                   localStorage.removeItem("ERIKA_RESTORE_CUSTOMER_ID");
                }

                localStorage.removeItem("ERIKA_RESTORE_QUOTE");
                localStorage.removeItem("ERIKA_RESTORE_QUOTE_ID");

                const autoCheckout = localStorage.getItem("ERIKA_AUTO_OPEN_CHECKOUT");
                const quoteLabel = savedQuoteNumber ? `Cotización #${savedQuoteNumber}` : "Cotización";
                if (autoCheckout === "true") {
                   localStorage.removeItem("ERIKA_AUTO_OPEN_CHECKOUT");
                   setIsPrinterConnected(true);
                   localStorage.setItem("ERIKA_PRINTER_CONNECTED", "true");
                   toast.success(`${quoteLabel} cargada. Completa el cobro para cerrarla.`);
                   setTimeout(() => {
                      setShowCheckoutModal(true);
                   }, 300);
                } else {
                   toast.success(`${quoteLabel} cargada en Punto de Venta.`);
                }
             }
          } catch(e) {}
       }
    };

    // Abre "Consulta de Tickets Anteriores" con la búsqueda ya rellena
    // cuando se llega aquí desde el botón "Ver Ticket Original" (Cuentas
    // por Cobrar → Historial de Movimientos). Mismo patrón de bandera en
    // localStorage que ERIKA_RESTORE_QUOTE.
    const openTicketSearchFromUrl = () => {
      const ticketRef = localStorage.getItem("ERIKA_OPEN_TICKET_SEARCH");
      if (ticketRef) {
        localStorage.removeItem("ERIKA_OPEN_TICKET_SEARCH");
        openTicketsHistoryModal();
        setTicketSearchQuery(ticketRef);
      }
    };

    fetchInventoryAndCustomers();
    restoreQuote();
    openTicketSearchFromUrl();
  }, []);

  // Sincronización de inventario en tiempo real entre cajas/terminales.
  // Antes globalCatalog se cargaba UNA sola vez al montar el componente y
  // solo se actualizaba localmente tras cada venta de ESTE terminal — con
  // dos cajas abiertas simultáneamente, una podía vender las últimas
  // unidades de un producto y la otra seguía viendo el stock viejo,
  // permitiendo sobreventa silenciosa hasta que alguien recargara la
  // página. Se usa un debounce corto porque una venta puede disparar
  // varios UPDATE seguidos (uno por artículo).
  useEffect(() => {
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      refreshTimeout = setTimeout(async () => {
        let allData: any[] = [];
        let from = 0;
        const limit = 1000;
        let hasMore = true;
        while (hasMore) {
          const { data, error } = await supabase
            .from("inventory")
            .select("*")
            .range(from, from + limit - 1);
          if (error || !data) {
            hasMore = false;
            break;
          }
          allData = [...allData, ...data];
          if (data.length < limit) {
            hasMore = false;
          } else {
            from += limit;
          }
        }
        if (allData.length > 0) setGlobalCatalog(allData);
      }, 600);
    };

    const channel = supabase
      .channel("pos-inventory-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory" }, scheduleRefresh)
      .subscribe();

    return () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      supabase.removeChannel(channel);
    };
  }, []);

  // Lector Láser Interceptor
  useEffect(() => {
    let barcodeBuffer = "";
    let barcodeTimeout: any = null;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F10") {
        e.preventDefault();
        handleReconnectPrinter();
        return;
      }
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
          addProductToCart(matched);
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
  // Imprime `_printCopies` copias en serie cuando la config de copia doble está activa.
  useEffect(() => {
    if (receiptToPrint) {
      const totalCopies = receiptToPrint._printCopies || 1;
      let printedCount = 0;
      let timer: ReturnType<typeof setTimeout>;

      const printNextCopy = () => {
        window.print();
        printedCount += 1;
        if (printedCount < totalCopies) {
          timer = setTimeout(printNextCopy, 800);
        } else {
          setReceiptToPrint(null);
        }
      };

      timer = setTimeout(printNextCopy, 350);
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
        addProductToCart(c);
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
    code: string = "",
  ) => {
    // Check stock warning when adding product (Sugerencia 1)
    // Se empareja por código (no por nombre): varios productos de esta
    // tienda comparten nombre a propósito (distintas presentaciones, ej.
    // "X-TRONG BLANCO DIRECTO BRILLANTE" en 4 códigos con precio y stock
    // distintos) -- por nombre, esto agarraba cualquiera de las 4 casi al
    // azar. Ver src/lib/posItemMatch.ts para el detalle del bug real que
    // esto causaba (2026-08-25).
    const invItem = globalCatalog.find(i => matchesProduct({ name: productName, code }, i));
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
          const existing = t.items.find((i) => matchesProduct({ name: productName, code }, i));
          if (existing)
            return {
              ...t,
              items: t.items.map((i) =>
                matchesProduct({ name: productName, code }, i) ? { ...i, qty: i.qty + addedQty } : i,
              ),
            };
          return {
            ...t,
            items: [
              ...t.items,
              {
                id: Date.now().toString(),
                code,
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

  const SALE_UNIT_SHORT: Record<string, string> = { pieza: "pz", kg: "kg", g: "g", m: "m", l: "L" };

  // Punto único donde se agrega un producto del catálogo al carrito. Antes
  // cada lugar de la UI (búsqueda, escáner, sugerencias) llamaba a addToCart
  // con "pz" y cantidad=1 fijos sin importar el producto, así que no había
  // forma de vender por peso/longitud/volumen ni de capturar una cantidad
  // fraccionaria (ej. 0.25 kg, 1.5 m) — la única forma de "agregar más" era
  // el stepper +/-1 del carrito, que tampoco acepta decimales.
  const addProductToCart = (product: any) => {
    const saleUnit = product.sale_unit || "pieza";
    if (saleUnit === "pieza") {
      addToCart(product.name, product.price, "pz", product.cost, 1, product.image_url, product.code);
      return;
    }
    const unitLabel = SALE_UNIT_SHORT[saleUnit] || saleUnit;
    const input = window.prompt(`Cantidad en ${unitLabel} para "${product.name}":`, "1");
    if (input === null) return;
    const qty = parseFloat(input.replace(",", "."));
    if (!qty || qty <= 0) {
      alert("⚠️ Cantidad inválida.");
      return;
    }
    addToCart(product.name, product.price, unitLabel, product.cost, qty, product.image_url, product.code);
  };

  const updateItemQty = (itemId: string, newQty: number) => {
    if (newQty <= 0) return;

    // Check if increasing qty exceeds stock to show toast warning (Sugerencia 1)
    const currentTicket = tickets.find(t => t.id === activeTicketId);
    if (currentTicket) {
      const item = currentTicket.items.find(i => i.id === itemId);
      if (item) {
        const invItem = globalCatalog.find(i => matchesProduct(item, i));
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

  // Cambia la línea del carrito a otra presentación del mismo producto (ej.
  // pasar de EX-0200.30 a EX-0200.20 sin borrar la línea y buscar de nuevo).
  // Si esa otra presentación YA está en el carrito como otra línea, se
  // fusionan las cantidades en vez de dejar dos líneas -- mismo criterio de
  // matchesProduct() que usa addToCart.
  const switchCartItemVariant = (itemId: string, newVariant: any) => {
    setTickets(
      tickets.map((t) => {
        if (t.id !== activeTicketId) return t;
        const current = t.items.find((i) => i.id === itemId);
        if (!current) return t;

        const otherMatch = t.items.find((i) => i.id !== itemId && matchesProduct({ name: newVariant.name, code: newVariant.code }, i));
        if (otherMatch) {
          return {
            ...t,
            items: t.items
              .filter((i) => i.id !== itemId)
              .map((i) => (i.id === otherMatch.id ? { ...i, qty: i.qty + current.qty } : i)),
          };
        }

        return {
          ...t,
          items: t.items.map((i) =>
            i.id === itemId
              ? {
                  ...i,
                  code: newVariant.code || "",
                  price: newVariant.price,
                  cost: newVariant.cost,
                  image_url: newVariant.image_url || i.image_url,
                  discountPct: getActiveDiscount(newVariant),
                }
              : i,
          ),
        };
      }),
    );
    setShowVariantsFor(null);
    toast.success(`✅ Cambiado a la presentación ${newVariant.code || newVariant.name} ($${newVariant.price}).`);
  };

  const removeItem = async (itemId: string) => {
    if (currentUser?.role !== "admin") {
       const pass = window.prompt("🔒 ACCESO RESTRINGIDO: Contraseña de Administrador requerida:");
       if (!pass || !(await verifyAdminPinRemote(pass))) return alert("❌ PIN incorrecto o sin privilegios.");
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
        const logOk = await LoggerService.logCancellation(itemToRemove.name, itemToRemove.qty, currentUser?.name);
        if (logOk) {
          alert("⚠️ Registrado como Pérdida/Merma Financiera en el Historial.");
        } else {
          alert("❌ No se pudo registrar la Pérdida/Merma en el Historial (sin conexión o error de base de datos). El artículo se quitó del ticket, pero avisa a un administrador para registrarlo manualmente.");
        }
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
     
     const proposedPrice = getItemFinalPrice({ ...item, discountPct: pct }, wholesaleRules);
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
          if (!(await verifyAdminPinRemote(pin))) return alert("❌ PIN incorrecto o sin privilegios de administrador. Descuento denegado.");
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
      const p = getItemFinalPrice(item, wholesaleRules);
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
      const option = window.prompt(
        "Elige la opción:\n\n1. DESCUENTO\n2. AUMENTO\n\nIngresa el número (deja vacío o cancela para salir):",
        "1"
      );
      if (option === null || option.trim() === "") return;
      const cleanOption = option.trim();
      if (cleanOption !== "1" && cleanOption !== "2") {
        return alert("Opción no válida");
      }

      if (cleanOption === "1") {
        const maxPct = ((1 - safeMinimum / currentRawTotal) * 100);
        const pctStr = window.prompt(
          `Máx. Descuento Permitido: ${maxPct > 0 ? maxPct.toFixed(1) : 0}%\n\nIngresa el porcentaje de descuento (%):`,
          ""
        );
        if (pctStr === null) return;
        const pct = parseFloat(pctStr) || 0;
        if (isNaN(pct) || pct < 0 || pct > 100) return alert("Porcentaje no válido");
        proposedTotal = currentRawTotal * (1 - pct / 100);
        finalPct = pct;
      } else {
        const pctStr = window.prompt(
          `Ingresa el porcentaje de aumento (%):`,
          ""
        );
        if (pctStr === null) return;
        const pct = parseFloat(pctStr) || 0;
        if (isNaN(pct) || pct < 0) return alert("Porcentaje no válido");
        proposedTotal = currentRawTotal * (1 + pct / 100);
        finalPct = -pct;
      }
    } else {
      const fixedAmountStr = window.prompt(
        `Mínimo seguro con utilidad (5%): $${safeMinimum.toFixed(2)}\nTotal actual: $${currentRawTotal.toFixed(2)}\n\nIngresa el Total Deseado ($):`,
        ""
      );
      if (fixedAmountStr === null) return;
      const fixedAmount = parseFloat(fixedAmountStr) || 0;
      if (isNaN(fixedAmount) || fixedAmount <= 0) return alert("Monto no válido");
      proposedTotal = fixedAmount;
      finalPct = ((currentRawTotal - fixedAmount) / currentRawTotal) * 100;
    }

    if (proposedTotal < safeMinimum) {
      return alert(
        `⚠️ SEGURO DE UTILIDAD\nEl descuento excede el límite mínimo permitido de $${safeMinimum.toFixed(2)} (Costo + 5% de utilidad).`
      );
    }

    if (finalPct > 5) {
      if (currentUser?.role !== "admin") {
         const pin = await getPinAsync(
           "⚠️ AUTORIZACIÓN REQUERIDA",
           `El descuento solicitado (${finalPct.toFixed(1)}%) supera el 5% permitido.\n\nIngresa el PIN de Administrador para autorizar:`
         );
         if (!pin) return;
         if (!(await verifyAdminPinRemote(pin))) return alert("❌ PIN incorrecto o sin privilegios de administrador. Descuento denegado.");
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

  const ensureBleConnection = async (): Promise<boolean> => {
    if (printerConnectionType !== "bluetooth") return true;
    try {
      const result = await getOrReconnectBlePrinter(bleCharacteristic, false);
      if (result.success && result.char) {
        setBleCharacteristic(result.char);
        return true;
      }
      return false;
    } catch (err) {
      console.warn("ensureBleConnection falló:", err);
      return false;
    }
  };

  // Guarda el ticket en `quotes` (historial/reimpresión/facturación) +
  // invoice_claims. Extraído del checkout de efectivo/tarjeta para que la
  // venta a crédito también lo use -- antes una venta a crédito NUNCA
  // quedaba en `quotes`: no aparecía en "Consulta de Tickets Anteriores",
  // no se podía reimprimir, y la nota del cargo en Cuentas por Cobrar
  // ("Venta a Crédito Ticket #N") en realidad citaba el id interno de la
  // pestaña del carrito (casi siempre "1"), no un folio real y buscable.
  const saveTicketToQuotes = async (params: {
    customerName: string;
    customerId: string | null;
    items: any[];
    total: number;
    discountPct: number;
    applyIva: boolean;
    notes: string;
  }): Promise<{ realTicketId: number; quoteNumber: number | null; quoteUuid: string | null }> => {
    let realTicketId = Date.now();
    // uuid real de la fila en `quotes` (a diferencia de realTicketId, que
    // para un guardado exitoso es Number(uuid) = NaN -- ver comentario
    // abajo). Es el mismo valor que la pantalla de Cancelar Ticket usa como
    // `ticket.id` para buscarlo, así que es lo único que sirve para que la
    // transacción de caja de esta venta pueda encontrarse después al cancelar.
    let quoteUuid: string | null = null;
    // quote_number es el folio entero real y buscable en "Consulta de
    // Tickets Anteriores" -- a diferencia de `id` (uuid: Number(uuid) da
    // NaN, así que realTicketId nunca sirvió para nada que necesitara un
    // número real más allá de formatTicketFolio, que hashea cualquier
    // string igual).
    let quoteNumber: number | null = null;
    try {
      const insertObj: any = {
        customer_name: params.customerName,
        customer_id: params.customerId,
        items: params.items,
        total: params.total,
        status: "ticket",
        discount_pct: params.discountPct,
        apply_iva: params.applyIva,
        notes: params.notes,
      };
      const { data: quoteData, error: quoteErr } = await saveQuote({ fields: insertObj });
      let finalQuoteData = quoteData;

      if (quoteErr) {
        console.warn("Falla al insertar quotes con columnas de descuento, reintentando con fallback...");
        delete insertObj.discount_pct;
        delete insertObj.apply_iva;
        delete insertObj.notes;
        const fallback = await saveQuote({ fields: insertObj });
        if (fallback.data) {
          realTicketId = Number(fallback.data.id);
          finalQuoteData = fallback.data;
        } else if (fallback.error) {
          console.error("También falló el fallback de guardado de ticket en quotes:", fallback.error);
          // Antes solo avisaba si el error era específicamente de
          // SCHEMA_DRIFT -- cualquier otro motivo (red caída, RLS, etc.)
          // fallaba en el mismo silencio que el bug de cancelación de
          // tickets (ver commit del 2026-08-26): la venta ya se había
          // cobrado, pero el cajero nunca se enteraba de que el ticket no
          // quedó en el historial ni sería reimprimible/cancelable.
          const isSchemaDrift = quoteErr.code === "SCHEMA_DRIFT" || fallback.error.code === "SCHEMA_DRIFT";
          toast.error(
            isSchemaDrift
              ? "⚠️ La venta se cobró bien, pero el ticket no se pudo guardar en el historial (desfase de esquema en la base de datos). Avisa a soporte."
              : `⚠️ La venta se cobró bien, pero el ticket no se pudo guardar en el historial: ${fallback.error.message}. No podrás reimprimirlo ni cancelarlo desde el historial.`,
            { duration: 12000 },
          );
        }
      } else if (quoteData) {
        realTicketId = Number(quoteData.id);
      }

      if (finalQuoteData) {
        realTicketId = Number(finalQuoteData.id);
        quoteNumber = typeof (finalQuoteData as any).quote_number === "number" ? (finalQuoteData as any).quote_number : null;

        // invoice_claims.ticket_id debe ser el uuid REAL de quotes.id --
        // /facturacion/[id] lo usa después para buscar `.eq("id",
        // claim.ticket_id)`. Antes se guardaba realTicketId (Number(uuid)
        // = NaN), así que ese lookup nunca podía encontrar nada aunque la
        // tabla hubiera existido.
        quoteUuid = String(finalQuoteData.id);

        try {
          const { error: insertErr } = await supabase.from("invoice_claims").insert({
            ticket_id: quoteUuid,
            token: invoiceToken,
            claimed: false,
          });
          if (insertErr) {
            console.warn("Error insertando claim en la nube, guardando offline:", insertErr);
            saveInvoiceClaimOffline({ ticket_id: quoteUuid, token: invoiceToken, claimed: false }).catch((idbErr) =>
              console.error("Fallo al guardar reclamo offline en IndexedDB:", idbErr),
            );
          }
        } catch (err) {
          console.warn("No se pudo registrar token de facturacion en invoice_claims, guardando offline:", err);
          saveInvoiceClaimOffline({ ticket_id: quoteUuid, token: invoiceToken, claimed: false }).catch((idbErr) =>
            console.error("Fallo al guardar reclamo offline en IndexedDB:", idbErr),
          );
        }
      }
    } catch (quoteErr) {
      console.error("Error al registrar el ticket en quotes:", quoteErr);
    }
    return { realTicketId, quoteNumber, quoteUuid };
  };

  const handleCheckoutSubmit = async (selectedMethod: "efectivo" | "tarjeta" | "transferencia" | "mixto", cashAmt: number, cardAmt: number, transferAmt: number, reference: string) => {
    if (activeTicket.items.length === 0)
      return alert("El ticket está vacío.");

    // Al confirmar cobro, la venta se guarda inmediatamente y el ticket se envía a la impresora en segundo plano
    const shouldPrint = true;

    const totalAmt = finalTotal;
    setIsProcessingPayment(true);

    // 3. Validación de Stock Estricta
    // Los renglones sintéticos (ej. "Descuento por Puntos ERIKA", price
    // negativo) nunca existen en el catálogo de inventario por diseño —
    // antes esto los marcaba SIEMPRE como "sin stock", forzando pedir PIN
    // de administrador en cualquier venta donde el cliente canjeara puntos,
    // aunque el resto del carrito tuviera stock de sobra.
    if (!isOffline) {
      const itemsExceedingStock = activeTicket.items.filter(item => {
         if (item.price < 0) return false;
         const invItem = globalCatalog.find(i => matchesProduct(item, i));
         return !invItem || item.qty > invItem.stock;
      });

      if (itemsExceedingStock.length > 0) {
         const itemNames = itemsExceedingStock.map(i => `• ${i.name} (Venta: ${i.qty}, Stock: ${globalCatalog.find(cat => matchesProduct(i, cat))?.stock ?? 0})`).join("\n");
         
         const pin = await getPinAsync(
           "⚠️ STOCK INSUFICIENTE",
           `Los siguientes artículos superan las existencias físicas en inventario:\n${itemNames}\n\nIngresa el PIN de Administrador para autorizar:`
         );
         if (!pin) {
            setIsProcessingPayment(false);
            return;
         }
         
         if (!(await verifyAdminPinRemote(pin))) {
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
             const invItem = globalCatalog.find(i => matchesProduct(item, i));
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

        const idempotencyToken = checkoutTokenRef.current;

        // Si la respuesta de un intento anterior se perdió por una
        // desconexión momentánea, el cajero reintenta con el mismo botón
        // — como el token de idempotencia se generó una sola vez al abrir
        // el modal (no se regenera en cada intento), esta búsqueda
        // detecta si ESE intento ya se registró en el servidor y evita
        // duplicar la venta completa (doble cobro, doble descuento de
        // inventario).
        if (idempotencyToken) {
          const { data: existingTx } = await supabase
            .from("cash_transactions")
            .select("id")
            .ilike("description", `%[IDEMP:${idempotencyToken}]%`)
            .limit(1)
            .maybeSingle();
          if (existingTx) {
            toast.success("✅ Esta venta ya se había registrado (reintento detectado); no se duplicó.", { duration: 5000 });
            checkoutTokenRef.current = null;
            setTickets(tickets.map((t) => t.id === activeTicketId ? { ...t, items: [], discountPct: 0, quoteId: undefined } : t));
            setSelectedCustomerId("");
            setShowCheckoutModal(false);
            setIsProcessingPayment(false);
            return;
          }
        }

        // El ticket se guarda en `quotes` ANTES de registrar la venta en
        // caja (y no después, como antes) para poder referenciar su id REAL
        // y buscable (quoteUuid) en descriptionText -- con el orden viejo,
        // descriptionText usaba activeTicket.id (el id local de la pestaña
        // del carrito en el POS, casi siempre "1", sin relación con la fila
        // real en `quotes`). Como "Cancelar Ticket" busca la venta original
        // por ese mismo uuid real, con el id local la búsqueda nunca
        // encontraba nada: cancelar un ticket jamás generaba el retiro
        // compensatorio en Arqueo de Caja, y la venta anulada seguía
        // contando de más en el corte.
        const { realTicketId, quoteUuid } = await saveTicketToQuotes({
          customerName: selectedCustomerId ? (customers.find(c => c.id === selectedCustomerId)?.name || "Venta Registrada") : "Venta Mostrador",
          customerId: selectedCustomerId || null,
          items: activeTicket.items,
          total: totalAmt,
          discountPct: activeTicket.discountPct || 0,
          applyIva: applyIva,
          notes: `Pago: ${selectedMethod.toUpperCase()}${reference ? ` (Ref: ${reference})` : ""}`,
        });

        const descriptionText = `Venta Ticket #${quoteUuid || activeTicket.id}${selectedCustomerId ? ` (Cliente ID: ${selectedCustomerId})` : ""} [METODO:${selectedMethod}] [CASH:${cashAmt}] [CARD:${cardAmt}] [TRANS:${transferAmt}] [COSTO:${totalCost.toFixed(2)}]${reference ? ` [REF:${reference}]` : ""}${idempotencyToken ? ` [IDEMP:${idempotencyToken}]` : ""}`;

        const { error } = await insertCashTransaction({
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
          const { error: fallbackError } = await insertCashTransaction({
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

        // Puntos de lealtad (completamente aislado)
        let puntosGanados = 0;
        if (selectedCustomerId) {
           try {
              const customer = customers.find(c => c.id === selectedCustomerId);
              if (customer) {
                 puntosGanados = Math.floor(totalAmt / loyaltyRates.earnRate) * loyaltyRates.earnPoints;
                 if (puntosGanados > 0) {
                    // Incremento atómico en el servidor (evita perder puntos
                    // si dos ventas casi simultáneas al mismo cliente parten
                    // del mismo valor de "points" cacheado en memoria).
                    const { error: pointsErr } = await adjustCustomerPoints(selectedCustomerId, puntosGanados);
                    if (pointsErr) {
                       console.error("Error al otorgar puntos:", pointsErr.message);
                    } else {
                       alert(`⭐ El cliente ganó ${puntosGanados} Erika Puntos.`);
                    }
                 }
              }
           } catch (ptsErr) {
              console.error("Error al actualizar puntos de cliente:", ptsErr);
           }
        }

        // Reduce Inventory (Descontar existencias vía /api/inventory/reduce-stock)
        try {
          const { error: invStockErr } = await reduceInventoryStock(
            activeTicket.items.map(item => {
              const invItem = globalCatalog.find(i => matchesProduct(item, i));
              return { id: invItem ? invItem.id : null, qty: item.qty };
            }).filter((item): item is { id: string; qty: number } => item.id !== null),
            "sale",
            realTicketId.toString(),
          );
          if (invStockErr) {
            console.warn("Falla al ajustar inventario en checkout:", invStockErr.message);
            toast.error(`⚠️ El cobro se realizó, pero el inventario no se pudo ajustar: ${invStockErr.message}. Revisa el stock manualmente.`, { duration: 8000 });
          }
        } catch (invErr) {
          console.error("Error crítico al actualizar inventario:", invErr);
          toast.error(
            "⚠️ El cobro se realizó, pero el inventario NO se pudo actualizar. Revisa y ajusta el stock manualmente.",
            { duration: 8000 },
          );
        }

        // Impresión inmediata en segundo plano previa a cualquier notificación
        if (shouldPrint) {
          try {
            triggerPrint({
              type: "ticket",
              data: {
                realTicketId,
                quoteUuid,
                invoiceToken,
                items: [...activeTicket.items],
                finalTotal: totalAmt,
                paymentMethod: selectedMethod,
                discountPct: activeTicket.discountPct || 0,
                applyIva: applyIva,
                // Antes esto nunca se mandaba, así que ninguna impresora
                // Bluetooth/ESC-POS ni el popup HTML imprimía los datos del
                // cliente aunque la venta sí tuviera uno asociado (solo la
                // impresora "system" funcionaba, porque ese camino
                // recalculaba el nombre por separado en vez de leer esto).
                customerName: selectedCustomerId ? (customers.find(c => c.id === selectedCustomerId)?.name || "") : ""
              }
            });
          } catch (printErr) {
            console.error("Error al disparar la impresion:", printErr);
          }
        }

        toast.success(
          `✅ ¡Cobro Exitoso por $${totalAmt.toFixed(2)} [Método: ${selectedMethod.toUpperCase()}]! Ticket impreso en EC-MP-300.`,
          { duration: 4000 }
        );

        setPaymentReference("");
      }

      // Update local state globalCatalog (Descontar existencias localmente)
      setGlobalCatalog(prevCatalog =>
        prevCatalog.map(invItem => {
           const soldItem = activeTicket.items.find(item => matchesProduct(item, invItem));
           if (soldItem) {
              return { ...invItem, stock: invItem.stock - soldItem.qty };
           }
           return invItem;
        })
      );

      // Si este carrito vino de una cotización, ahora sí se marca como
      // vendida — recién aquí hubo un cobro real (antes QuotesModule la
      // marcaba "converted" solo por enviarla a caja, sin esperar a que
      // el cajero de verdad completara el cobro).
      if (activeTicket.quoteId) {
        saveQuote({ id: activeTicket.quoteId, fields: { status: "converted" } }).then(({ error: quoteUpdateError }) => {
          if (quoteUpdateError) {
            console.error("No se pudo marcar la cotización como vendida:", quoteUpdateError);
          }
        });
      }

      // Aprendizaje dinámico en tiempo real: Registrar combinaciones vendidas en este ticket
      if (activeTicket.items.length >= 2) {
        setLearnedPairsMap((prev) => {
          const updated = { ...prev };
          for (let i = 0; i < activeTicket.items.length; i++) {
            const nameA = (activeTicket.items[i].name || "").trim().toLowerCase();
            if (!nameA) continue;
            if (!updated[nameA]) updated[nameA] = {};
            for (let j = 0; j < activeTicket.items.length; j++) {
              if (i === j) continue;
              const nameB = (activeTicket.items[j].name || "").trim().toLowerCase();
              if (!nameB) continue;
              updated[nameA][nameB] = (updated[nameA][nameB] || 0) + 1;
            }
          }
          try { localStorage.setItem("ERIKA_LEARNED_PAIRS", JSON.stringify(updated)); } catch {}
          return updated;
        });
      }

      // Proceso de éxito: limpiar tickets y cerrar modal
      checkoutTokenRef.current = null;
      setTickets(
        tickets.map((t) =>
          t.id === activeTicketId
            ? { ...t, items: [], discountPct: 0, quoteId: undefined }
            : t
        )
      );
      setSelectedCustomerId("");
      setShowCheckoutModal(false);
    } catch (criticalErr: any) {
      console.error("Error crítico inesperado en handleCheckoutSubmit:", criticalErr);
      alert("❌ Error crítico al procesar el pago: " + (criticalErr.message || criticalErr));
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const fetchTopSellingProducts = async (catalog: any[]) => {
    if (!catalog || catalog.length === 0) return;
    try {
      const { data: quotesData } = await supabase
        .from("quotes")
        .select("items")
        .order("created_at", { ascending: false })
        .limit(300);

      const salesTally: Record<string, number> = {};
      const newPairsMap: Record<string, Record<string, number>> = {};

      if (quotesData && quotesData.length > 0) {
        quotesData.forEach((q: any) => {
          let items: any[] = [];
          if (typeof q.items === "string") {
            try { items = JSON.parse(q.items); } catch {}
          } else if (Array.isArray(q.items)) {
            items = q.items;
          }

          // Conteo de frecuencia
          items.forEach((it: any) => {
            const name = (it.name || "").trim().toLowerCase();
            if (name) {
              salesTally[name] = (salesTally[name] || 0) + (Number(it.qty) || 1);
            }
          });

          // Aprendizaje de pares de productos comprados juntos
          if (items.length >= 2) {
            for (let i = 0; i < items.length; i++) {
              const nameA = (items[i].name || "").trim().toLowerCase();
              if (!nameA) continue;
              if (!newPairsMap[nameA]) newPairsMap[nameA] = {};

              for (let j = 0; j < items.length; j++) {
                if (i === j) continue;
                const nameB = (items[j].name || "").trim().toLowerCase();
                if (!nameB) continue;
                newPairsMap[nameA][nameB] = (newPairsMap[nameA][nameB] || 0) + 1;
              }
            }
          }
        });
      }

      setLearnedPairsMap(newPairsMap);
      try {
        localStorage.setItem("ERIKA_LEARNED_PAIRS", JSON.stringify(newPairsMap));
      } catch {}

      const sorted = [...catalog].sort((a, b) => {
        const countA = salesTally[a.name.trim().toLowerCase()] || 0;
        const countB = salesTally[b.name.trim().toLowerCase()] || 0;
        if (countB !== countA) return countB - countA;
        return (b.stock || 0) - (a.stock || 0);
      });

      setTopSellingProducts(sorted.slice(0, 12));
    } catch (e) {
      console.warn("Falla al calcular top 12 productos y pares aprendidos:", e);
      setTopSellingProducts(catalog.slice(0, 12));
    }
  };

  const getCrossSellSuggestions = () => {
    if (globalCatalog.length === 0) return [];
    
    // Nombres de artículos en el carrito actual para no sugerir lo que ya se agregó
    const cartItemNames = new Set(activeTicket.items.map((i) => i.name.trim().toLowerCase()));
    
    const suggestedProducts: any[] = [];
    const addedIds = new Set<string>();

    // 1. NIVEL 1: Productos aprendidos por Inteligencia (comprados juntos con artículos de la nota)
    if (activeTicket.items.length > 0) {
      const companionScores: Record<string, number> = {};

      activeTicket.items.forEach((item) => {
        const itemNameLower = item.name.trim().toLowerCase();
        const paired = learnedPairsMap[itemNameLower];
        if (paired) {
          Object.entries(paired).forEach(([companionName, score]) => {
            if (!cartItemNames.has(companionName)) {
              companionScores[companionName] = (companionScores[companionName] || 0) + score;
            }
          });
        }
      });

      const learnedMatches = globalCatalog
        .filter((p) => {
          const pNameLower = p.name.trim().toLowerCase();
          return !cartItemNames.has(pNameLower) && companionScores[pNameLower] > 0;
        })
        .sort((a, b) => {
          const scoreA = companionScores[a.name.trim().toLowerCase()] || 0;
          const scoreB = companionScores[b.name.trim().toLowerCase()] || 0;
          return scoreB - scoreA;
        });

      learnedMatches.forEach((prod) => {
        if (suggestedProducts.length < 8 && !addedIds.has(prod.id)) {
          suggestedProducts.push(prod);
          addedIds.add(prod.id);
        }
      });
    }

    // 2. NIVEL 2: Reglas de asociación por palabras clave de ferretería (COMPANION_RULES)
    if (activeTicket.items.length > 0 && suggestedProducts.length < 8) {
      const activeTicketWords = activeTicket.items.map((i) => i.name.toLowerCase()).join(" ");

      const complementKeywords = new Set<string>();
      COMPANION_RULES.forEach((rule) => {
        const matchesKeyword = rule.keywords.some((kw) => activeTicketWords.includes(kw));
        if (matchesKeyword) {
          rule.complements.forEach((comp) => complementKeywords.add(comp));
        }
      });

      if (complementKeywords.size > 0) {
        for (const prod of globalCatalog) {
          if (suggestedProducts.length >= 8) break;
          const prodNameLower = prod.name.toLowerCase();
          if (cartItemNames.has(prodNameLower)) continue;
          if (addedIds.has(prod.id)) continue;

          for (const compKw of complementKeywords) {
            if (prodNameLower.includes(compKw)) {
              suggestedProducts.push(prod);
              addedIds.add(prod.id);
              break;
            }
          }
        }
      }
    }

    // 3. NIVEL 3: Rellenar con productos de alta rotación (Top ventas / rotación)
    if (suggestedProducts.length < 8) {
      const fallbackList = topSellingProducts.length > 0 ? topSellingProducts : globalCatalog;
      for (const prod of fallbackList) {
        if (suggestedProducts.length >= 8) break;
        const prodNameLower = prod.name.toLowerCase();
        if (cartItemNames.has(prodNameLower)) continue;
        if (addedIds.has(prod.id)) continue;

        suggestedProducts.push(prod);
        addedIds.add(prod.id);
      }
    }

    return suggestedProducts.slice(0, 8);
  };

  const increaseFactor = activeTicket.discountPct < 0 ? (1 + Math.abs(activeTicket.discountPct) / 100) : 1;

  const rawTotal = activeTicket.items.reduce((sum, item) => {
    const p = (getItemFinalPrice(item, wholesaleRules, smartVolumeRules) * increaseFactor);
    return sum + p * item.qty;
  }, 0);
  
  const totalCost = activeTicket.items.reduce((sum, item) => sum + (item.cost * item.qty), 0);
  
  // Ahorro por productos individual con descuento o volumen inteligente (Sugerencia 2)
  // pNormal es el precio de lista, sin ningún descuento -- antes calculaba
  // mal aquí mismo un descuento de Mayoreo (ya retirado) como si fuera el
  // precio "normal", lo que habría restado mal el ahorro real en cuanto ese
  // ajuste tuviera un valor distinto de cero.
  const itemDiscountsSavings = activeTicket.items.reduce((sum, item) => {
    const pNormal = item.price;
    const pDiscounted = getItemFinalPrice(item, wholesaleRules, smartVolumeRules);
    return sum + (pNormal - pDiscounted) * item.qty;
  }, 0);
  
  const discountAmount = activeTicket.discountPct < 0 ? 0 : rawTotal * (activeTicket.discountPct / 100);
  const subtotalNeto = rawTotal - discountAmount;
  const iva = applyIva ? subtotalNeto * (businessSettings?.config?.iva_rate ?? 0.16) : 0;
  const finalTotal = Math.round(subtotalNeto + iva);
  const subtotal = subtotalNeto;

  const generateEscPosBytes = (job: any, config: any) => {
    const generateSingleTicket = (currentJob: any) => {
      const chunks: Uint8Array[] = [];
      const encoder = new TextEncoder();

      const write = (bytes: number[]) => {
        chunks.push(new Uint8Array(bytes));
      };
      const writeText = (text: string) => {
        chunks.push(encoder.encode(sanitizeForThermal(text)));
      };
      
      const invertPrint = config.printer_invert_180 !== undefined
        ? config.printer_invert_180
        : (typeof window !== "undefined" && localStorage.getItem("ERIKA_PRINTER_INVERT_180") !== null
            ? localStorage.getItem("ERIKA_PRINTER_INVERT_180") === "true"
            : true);
      const topLines = config.printer_margin_top_lines || 0;
      const bottomLines = config.printer_margin_bottom_lines !== undefined ? config.printer_margin_bottom_lines : 1;

      // Comandos ESC/POS estándar limpios
      write([0x1b, 0x40]); // Reset ESC @
      write([0x1b, 0x7b, invertPrint ? 0x01 : 0x00]); // ESC { orientation (0 = Normal, 1 = 180° Invertido)
      write([0x1b, 0x74, 0x00]); // Code page 437
      write([0x1b, 0x32]); // Line spacing default

      // Líneas ANTES de imprimir (Encabezado)
      if (topLines > 0) {
        write([0x1b, 0x64, topLines]);
      }
      
      const setAlign = (align: number) => {
        write([0x1b, 0x61, align]);
      };
      
      const setBold = (on: boolean) => {
        write([0x1b, 0x45, on ? 0x01 : 0x00]);
      };
      
      const setDoubleSize = (on: boolean) => {
        write([0x1d, 0x21, on ? 0x11 : 0x00]);
      };
      
      const paperSize = config.printer_paper_size || "80mm";
      const maxCols = paperSize === "58mm" ? 30 : 42;
      const divider = "-".repeat(maxCols) + "\n";
      
      if (currentJob.isReprint) {
        const nowStr = new Date().toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
        setAlign(1);
        setBold(true);
        writeText(`*** COPIA REIMPRESA - ${nowStr} ***\n`);
        setBold(false);
        writeText(divider);
      } else if (currentJob.isCopy) {
        setAlign(1);
        setBold(true);
        writeText("*** COPIA PARA EL NEGOCIO ***\n");
        setBold(false);
        writeText(divider);
      }
      
      const fields = config.printer_fields || ["name", "rfc", "phone", "address", "logo", "footer"];
      const showName = fields.includes("name");
      const showRfc = fields.includes("rfc") && businessProfile.rfc;
      const showPhone = fields.includes("phone") && businessProfile.phone;
      const showAddress = fields.includes("address") && businessProfile.address;
      const showBilling = fields.includes("billing");
      const showFooter = fields.includes("footer");
      const showEmail = fields.includes("email") && businessProfile.email;
      const showPaymentMethod = fields.includes("payment_method");
      const showSeller = fields.includes("seller");
      const showCustomer = fields.includes("customer");
      const showNotes = fields.includes("notes");
      const showWarranty = fields.includes("warranty");

      setAlign(1);
      if (showName) {
        setDoubleSize(true);
        setBold(true);
        writeText(businessProfile.name + "\n");
        setDoubleSize(false);
      }

      setBold(false);
      if (showRfc) writeText(`RFC: ${businessProfile.rfc}\n`);
      if (showPhone) writeText(`Tel: ${businessProfile.phone}\n`);
      if (showAddress) writeText(`${businessProfile.address}\n`);
      if (showEmail) writeText(`Email: ${businessProfile.email}\n`);
      
      writeText(divider);
      
      if (currentJob.type === "ticket") {
        const { realTicketId, quoteUuid, invoiceToken: jobInvoiceToken, items, finalTotal, paymentMethod, discountPct = 0, applyIva = false, isCancelled } = currentJob.data;
        // El folio impreso y el link de auto-facturación deben usar el uuid
        // real de `quotes.id` (quoteUuid) y el token de reclamo real
        // (jobInvoiceToken) -- realTicketId es Number(uuid) = NaN en toda
        // venta guardada con éxito, así que usarlo aquí imprimía el mismo
        // folio falso "TK-00*00" en cada ticket y un link roto
        // (/facturacion/NaN) que nunca podía facturarse.
        const printFolioId = quoteUuid || realTicketId;
        const printInvoiceUrlToken = jobInvoiceToken || quoteUuid || realTicketId;
        const increaseFactor = discountPct < 0 ? (1 + Math.abs(discountPct) / 100) : 1;
        const printDiscountPct = discountPct < 0 ? 0 : discountPct;

        if (isCancelled) {
          setAlign(1);
          setBold(true);
          writeText("*** TICKET CANCELADO ***\n");
          writeText("*** NO VALIDO COMO COMPROBANTE DE VENTA ***\n");
          setBold(false);
          writeText(divider);
        }

        if (paymentMethod === PAYMENT_METHOD_CREDITO) {
          setAlign(1);
          setBold(true);
          writeText("*** VENTA A CREDITO ***\n");
          setBold(false);
          writeText(divider);
        }

        setAlign(1);
        setBold(true);
        writeText(`Ticket: #${formatTicketFolio(printFolioId)}\n`);
        setBold(false);
        writeText(`Fecha: ${new Date().toLocaleString()}\n`);
        
        setAlign(0);
        if (showPaymentMethod && paymentMethod) {
          writeText(`Metodo: ${paymentMethod.toUpperCase()}\n`);
        }
        if (showPaymentMethod && currentJob.data.reference) {
          writeText(`Ref/Folio: ${currentJob.data.reference}\n`);
        }
        if (showSeller) {
          writeText(`Atendido por: ${currentUser?.name || "Venta Mostrador"}\n`);
        }
        if (showCustomer && currentJob.data.customerName) {
          writeText(`Cliente: ${currentJob.data.customerName}\n`);
        }
        if (showNotes && currentJob.data.notes) {
          writeText(`Nota: ${currentJob.data.notes}\n`);
        }
        
        writeText(divider);
        
        items.forEach((item: any) => {
          const smartDisc = getSmartVolumeDiscount(item, smartVolumeRules);
          const effectiveDiscPct = Math.max(item.discountPct || 0, smartDisc.discountPct || 0);
          const p = (getItemFinalPrice(item, wholesaleRules, smartVolumeRules) * increaseFactor);
          const itemTotal = "$" + Math.round(p * item.qty);
          const prefix = item.unit && item.unit !== "pz" ? `${item.qty} ${item.unit} ` : `${item.qty}x `;
          const disc = effectiveDiscPct > 0 ? `(-${effectiveDiscPct}%)` : '';
          const fullName = prefix + item.name + (disc ? " " + disc : "");
          
          const maxNameLen = maxCols - itemTotal.length - 1;
          const words = fullName.split(" ");
          let currentLine = "";
          const wrappedLines: string[] = [];
          
          words.forEach(word => {
            if ((currentLine + " " + word).trim().length <= maxNameLen) {
              currentLine = (currentLine + " " + word).trim();
            } else {
              if (currentLine) wrappedLines.push(currentLine);
              currentLine = word;
            }
          });
          if (currentLine) wrappedLines.push(currentLine);
          
          for (let idx = 0; idx < wrappedLines.length - 1; idx++) {
            writeText(wrappedLines[idx] + "\n");
          }
          
          const lastLine = wrappedLines[wrappedLines.length - 1] || "";
          const spacesNeeded = maxCols - lastLine.length - itemTotal.length;
          if (spacesNeeded > 0) {
            writeText(lastLine + " ".repeat(spacesNeeded) + itemTotal + "\n");
          } else {
            writeText(lastLine + "\n");
            setAlign(2);
            writeText(itemTotal + "\n");
            setAlign(0);
          }

          if (item.unit && item.unit !== "pz") {
            writeText(`  ($${p.toFixed(2)}/${item.unit})\n`);
          }
        });

        writeText(divider);
        
        const subtotalVal = items.reduce((sum: number, i: any) => {
           const p = (getItemFinalPrice(i, wholesaleRules) * increaseFactor);
           return sum + (p * i.qty);
        }, 0);
        const discountVal = subtotalVal * (printDiscountPct / 100);
        const subtotalNeto = subtotalVal - discountVal;
        const iva = applyIva ? subtotalNeto * (businessSettings?.config?.iva_rate ?? 0.16) : 0;
        
        setAlign(2);
        writeText(`Subtotal: ${Math.round(subtotalVal)}\n`);
        if (printDiscountPct > 0) {
          writeText(`Desc. (${printDiscountPct}%): -${Math.round(discountVal)}\n`);
        }
        if (applyIva) writeText(`IVA (16%): ${Math.round(iva)}\n`);
        
        setBold(true);
        writeText(`TOTAL: $${Math.round(finalTotal)}\n`);
        setBold(false);
        setAlign(0);

        if (showWarranty) {
          setAlign(1);
          writeText("\nGarantia de 30 dias contra defectos de fabrica.\n");
          setAlign(0);
        }
        
        if (showBilling) {
          setAlign(1);
          writeText("\nAuto-Facturacion Express:\n");
          writeText(`${typeof window !== "undefined" ? window.location.origin : ""}/facturacion/${printInvoiceUrlToken}\n`);
          setAlign(0);
        }
      } else if (currentJob.type === "layaway") {
        const { customer, items, finalTotal, downPayment, discountPct = 0, applyIva = false } = currentJob.data;
        const increaseFactor = discountPct < 0 ? (1 + Math.abs(discountPct) / 100) : 1;
        const printDiscountPct = discountPct < 0 ? 0 : discountPct;
        
        setAlign(1);
        setBold(true);
        writeText("COMPROBANTE DE APARTADO\n");
        setBold(false);
        writeText(`Fecha: ${new Date().toLocaleString()}\n`);
        if (customer?.name) writeText(`Cliente: ${customer.name}\n`);
        if (showSeller) writeText(`Atendido por: ${currentUser?.name || "Venta Mostrador"}\n`);

        setAlign(0);
        writeText(divider);

        items.forEach((item: any) => {
          const p = (getItemFinalPrice(item, wholesaleRules) * increaseFactor);
          const itemTotal = "$" + Math.round(p * item.qty);
          const prefix = item.unit && item.unit !== "pz" ? `${item.qty} ${item.unit} ` : `${item.qty}x `;
          const fullName = prefix + item.name;
          
          const maxNameLen = maxCols - itemTotal.length - 1;
          const words = fullName.split(" ");
          let currentLine = "";
          const wrappedLines: string[] = [];
          
          words.forEach(word => {
            if ((currentLine + " " + word).trim().length <= maxNameLen) {
              currentLine = (currentLine + " " + word).trim();
            } else {
              if (currentLine) wrappedLines.push(currentLine);
              currentLine = word;
            }
          });
          if (currentLine) wrappedLines.push(currentLine);
          
          for (let idx = 0; idx < wrappedLines.length - 1; idx++) {
            writeText(wrappedLines[idx] + "\n");
          }
          
          const lastLine = wrappedLines[wrappedLines.length - 1] || "";
          const spacesNeeded = maxCols - lastLine.length - itemTotal.length;
          if (spacesNeeded > 0) {
            writeText(lastLine + " ".repeat(spacesNeeded) + itemTotal + "\n");
          } else {
            writeText(lastLine + "\n");
            setAlign(2);
            writeText(itemTotal + "\n");
            setAlign(0);
          }

          if (item.unit && item.unit !== "pz") {
            writeText(`  ($${p.toFixed(2)}/${item.unit})\n`);
          }
        });

        writeText(divider);
        
        const subtotalVal = items.reduce((sum: number, i: any) => {
           const p = (getItemFinalPrice(i, wholesaleRules) * increaseFactor);
           return sum + (p * i.qty);
        }, 0);
        const discountVal = subtotalVal * (printDiscountPct / 100);
        const subtotalNeto = subtotalVal - discountVal;
        const iva = applyIva ? subtotalNeto * (businessSettings?.config?.iva_rate ?? 0.16) : 0;
        
        setAlign(2);
        writeText(`Subtotal: ${Math.round(subtotalVal)}\n`);
        if (printDiscountPct > 0) {
          writeText(`Desc. (${printDiscountPct}%): -${Math.round(discountVal)}\n`);
        }
        if (applyIva) writeText(`IVA (16%): ${Math.round(iva)}\n`);
        
        setBold(true);
        writeText(`TOTAL: $${Math.round(finalTotal)}\n`);
        writeText(`Enganche: $${Math.round(downPayment)}\n`);
        writeText(`Saldo: $${Math.round(finalTotal - downPayment)}\n`);
        setBold(false);
        setAlign(0);
      }
      
      writeText("\n");
      if (showFooter) {
        setAlign(1);
        writeText((config.printer_footer_msg || "Gracias por su compra!") + "\n");
      }

      // Líneas DESPUÉS de imprimir (Pie / Avance configurable por usuario)
      if (bottomLines > 0) {
        write([0x1b, 0x64, bottomLines]);
      }
      if (config.printer_enable_autocut !== false) {
        try {
          write([0x1d, 0x56, 0x01]); // GS V 1 corte seguro
        } catch (e) {}
      }

      return chunks;
    };

    const doubleCopyEnabled = 
      (config as any).printer_double_copy || 
      config.printer_double_copy_layaway_credit || 
      (typeof window !== "undefined" && (localStorage.getItem("ERIKA_PRINTER_DOUBLE_COPY") === "true" || localStorage.getItem("ERIKA_DOUBLE_TICKET") === "true")) || 
      false;

    let allChunks: Uint8Array[] = [];
    allChunks.push(...generateSingleTicket(job));

    // Si doble ticket está activado y no es ya una copia o reimpresión, agregar la segunda copia al mismo flujo
    if (doubleCopyEnabled && !job.isReprint && !job.isCopy) {
      allChunks.push(...generateSingleTicket({ ...job, isCopy: true }));
    }

    const totalLength = allChunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    allChunks.forEach(chunk => {
      result.set(chunk, offset);
      offset += chunk.length;
    });

    return result;
  };

  const executePrintWindow = (job: any) => {
    const config = businessSettings?.config || {};

    if (printerConnectionType === "bluetooth") {
      const printDirectBle = async () => {
        try {
          if (typeof window === "undefined" || !(navigator as any).bluetooth) {
            alert("Su navegador no soporta Web Bluetooth. Asegúrese de usar Google Chrome.");
            return;
          }

          let result = await getOrReconnectBlePrinter(bleCharacteristic, false);

          if (!result.success || !result.char) {
            // Reintentar reconexión con permisos previamente concedidos
            result = await getOrReconnectBlePrinter(bleCharacteristic, true);
          }

          if (!result.success || !result.char) {
            console.warn("[POS BLE] No se pudo reconectar automáticamente la impresora Bluetooth.");
            toast((t) => (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span><b>⚠️ Impresora Bluetooth Desconectada</b></span>
                <span style={{ fontSize: "0.85rem" }}>Verifique que la impresora esté encendida.</span>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    onClick={async () => {
                      toast.dismiss(t.id);
                      const res = await getOrReconnectBlePrinter(bleCharacteristic, true);
                      if (res.success && res.char) {
                        setBleCharacteristic(res.char);
                        const bytes = generateEscPosBytes(job, config);
                        try {
                          await sendBleBytes(res.char, bytes, config.printer_ble_chunk_size || 20, 20);
                          toast.success("✅ Ticket impreso con éxito");
                        } catch (printErr: any) {
                          console.error("Error al reintentar impresión Bluetooth:", printErr);
                          toast.error("❌ Falló la impresión: " + (printErr?.message || printErr));
                        }
                      } else if (res.error) {
                        toast.error("Error al reconectar: " + res.error);
                      }
                    }}
                    style={{
                      background: "#3b82f6",
                      color: "#fff",
                      border: "none",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontWeight: "bold",
                      fontSize: "0.85rem"
                    }}
                  >
                    👆 Reconectar e Imprimir
                  </button>
                  <button
                    onClick={() => {
                      toast.dismiss(t.id);
                      window.print();
                    }}
                    style={{
                      background: "#4b5563",
                      color: "#fff",
                      border: "none",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontSize: "0.85rem"
                    }}
                  >
                    🖨️ Sistema
                  </button>
                </div>
              </div>
            ), { duration: 12000 });
            return;
          }

          const char = result.char;
          setBleCharacteristic(char);
          const bytes = generateEscPosBytes(job, config);
          await sendBleBytes(char, bytes, config.printer_ble_chunk_size || 20, 35, result.allVendorChars);
          console.log("✅ Impresión Bluetooth directa completada.");
        } catch (err: any) {
          console.error("Error al imprimir por Bluetooth:", err);
          if (err.name !== "NotFoundError") {
            alert("Fallo al imprimir por Bluetooth: " + err.message);
          }
        }
      };

      printDirectBle();
      return;
    }

    // Si la impresora configurada es del sistema, redireccionar al flujo nativo sin popup
    if (printerConnectionType === "system") {
      const doubleCopyEnabled =
        (config as any).printer_double_copy ||
        config.printer_double_copy_layaway_credit ||
        (typeof window !== "undefined" && (localStorage.getItem("ERIKA_PRINTER_DOUBLE_COPY") === "true" || localStorage.getItem("ERIKA_DOUBLE_TICKET") === "true")) ||
        false;
      const printCopies = (doubleCopyEnabled && !job.isReprint) ? 2 : 1;

      if (job.type === "ticket") {
        const { realTicketId, quoteUuid, invoiceToken: jobInvoiceToken, items, finalTotal, paymentMethod, discountPct = 0, applyIva = false, isCancelled } = job.data;
        const increaseFactor = discountPct < 0 ? (1 + Math.abs(discountPct) / 100) : 1;
        const printDiscountPct = discountPct < 0 ? 0 : discountPct;
        const subtotalVal = items.reduce((sum: number, item: any) => {
           const p = (getItemFinalPrice(item, wholesaleRules) * increaseFactor);
           return sum + (p * item.qty);
        }, 0);
        const discountAmt = subtotalVal * (printDiscountPct / 100);
        const subtotalNeto = subtotalVal - discountAmt;
        const iva = applyIva ? subtotalNeto * (businessSettings?.config?.iva_rate ?? 0.16) : 0;

        setReceiptToPrint({
          type: "ticket",
          // realTicketId es Number(uuid) = NaN en toda venta guardada con
          // éxito (ver comentario en la rama de impresión Bluetooth) --
          // ticketId se usa para mostrar el folio en pantalla/recibo, así
          // que debe llevar el folio ya formateado a partir del uuid real.
          ticketId: formatTicketFolio(quoteUuid || realTicketId),
          customerName: customers.find(c => c.id === selectedCustomerId)?.name || "",
          items: items.map((i: any) => ({
             ...i,
             price: (getItemFinalPrice(i, wholesaleRules) * increaseFactor),
             discountPct: 0
          })),
          subtotal: subtotalVal,
          iva,
          discountPct: printDiscountPct,
          discountAmount: discountAmt,
          finalTotal: finalTotal,
          invoiceToken: jobInvoiceToken || quoteUuid || realTicketId,
          paymentMethod,
          _printCopies: printCopies,
          isCancelled
        });
      } else if (job.type === "layaway") {
        const { customer, items, finalTotal, downPayment, discountPct = 0, applyIva = false } = job.data;
        const increaseFactor = discountPct < 0 ? (1 + Math.abs(discountPct) / 100) : 1;
        const printDiscountPct = discountPct < 0 ? 0 : discountPct;
        const subtotalVal = items.reduce((sum: number, item: any) => {
           const p = (getItemFinalPrice(item, wholesaleRules) * increaseFactor);
           return sum + (p * item.qty);
        }, 0);
        const discountAmt = subtotalVal * (printDiscountPct / 100);
        const subtotalNeto = subtotalVal - discountAmt;
        const iva = applyIva ? subtotalNeto * (businessSettings?.config?.iva_rate ?? 0.16) : 0;

        setReceiptToPrint({
          type: "layaway",
          customerName: customer?.name || "Desconocido",
          items: items.map((i: any) => ({
             ...i,
             price: (getItemFinalPrice(i, wholesaleRules) * increaseFactor),
             discountPct: 0
          })),
          subtotal: subtotalVal,
          iva,
          discountPct: printDiscountPct,
          discountAmount: discountAmt,
          finalTotal,
          downPayment,
          balance: finalTotal - downPayment,
          _printCopies: printCopies
        });
      }
      return;
    }

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

    const showLogo = fields.includes("logo") && businessProfile.logo;
    const showName = fields.includes("name");
    const showRfc = fields.includes("rfc") && businessProfile.rfc;
    const showPhone = fields.includes("phone") && businessProfile.phone;
    const showAddress = fields.includes("address") && businessProfile.address;
    const showBilling = fields.includes("billing");
    const showFooter = fields.includes("footer");
    const showEmail = fields.includes("email") && businessProfile.email;
    const showPaymentMethod = fields.includes("payment_method");
    const showSeller = fields.includes("seller");
    const showCustomer = fields.includes("customer");
    const showNotes = fields.includes("notes");
    const showWarranty = fields.includes("warranty");

    const printWindow = window.open("", "_blank", `width=${paperSize === "58mm" ? 300 : 400},height=500`);
    if (!printWindow) {
      toast.error(
        (t) => (
          <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span>
              ⚠️ El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes para este sitio.
            </span>
            <button
              onClick={() => {
                toast.dismiss(t.id);
                executePrintWindow(job);
              }}
              style={{
                background: "#fff",
                color: "#b91c1c",
                border: "none",
                borderRadius: "6px",
                padding: "4px 10px",
                fontWeight: "bold",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Reintentar
            </button>
          </span>
        ),
        { duration: 10000 },
      );
      return;
    }

    const nowStr = new Date().toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
    const doubleCopyEnabled = 
      (config as any).printer_double_copy || 
      config.printer_double_copy_layaway_credit || 
      (typeof window !== "undefined" && (localStorage.getItem("ERIKA_PRINTER_DOUBLE_COPY") === "true" || localStorage.getItem("ERIKA_DOUBLE_TICKET") === "true")) || 
      false;

    if (job.type === "ticket") {
      const { realTicketId, quoteUuid, invoiceToken: jobInvoiceToken, items, finalTotal, paymentMethod, discountPct = 0, applyIva = false, isCancelled } = job.data;
      // Ver el comentario equivalente en la rama de impresión Bluetooth
      // directa: realTicketId es Number(uuid) = NaN en toda venta guardada
      // con éxito, así que el folio y el link de facturación deben usar el
      // uuid/token reales en vez de ese valor roto.
      const printFolioId = quoteUuid || realTicketId;
      const printInvoiceUrlToken = jobInvoiceToken || quoteUuid || realTicketId;
      const increaseFactor = discountPct < 0 ? (1 + Math.abs(discountPct) / 100) : 1;
      const printDiscountPct = discountPct < 0 ? 0 : discountPct;
      const creditLabelHtml = paymentMethod === PAYMENT_METHOD_CREDITO
        ? `<div style="text-align:center; font-weight:bold; border: 2px solid #b91c1c; color: #b91c1c; padding: 6px; margin-bottom: 12px; font-size: 0.9em;">*** VENTA A CRÉDITO ***</div>`
        : "";
      const cancelledLabelHtml = isCancelled
        ? `<div style="text-align:center; font-weight:bold; border: 2px solid #ef4444; color: #ef4444; padding: 8px; margin-bottom: 12px; font-size: 1em;">🚫 TICKET CANCELADO<br><span style="font-weight:normal; font-size:0.8em;">No válido como comprobante de venta</span></div>`
        : "";

      const itemsHtml = items.map((i: any) => {
        const smartDisc = getSmartVolumeDiscount(i, smartVolumeRules);
        const effectiveDiscPct = Math.max(i.discountPct || 0, smartDisc.discountPct || 0);
        const p = (getItemFinalPrice(i, wholesaleRules, smartVolumeRules) * increaseFactor);
        return `
        <div style="display:flex; justify-content:space-between; margin-bottom: 3px;">
          <span>${i.unit && i.unit !== "pz" ? `${i.qty} ${i.unit}` : `${i.qty}x`} ${i.name} ${effectiveDiscPct > 0 ? `(-${effectiveDiscPct}%)` : ''}${i.unit && i.unit !== "pz" ? `<div style="font-size: 0.8em; opacity: 0.7;">($${p.toFixed(2)}/${i.unit})</div>` : ''}</span>
          <span>${Math.round(p * i.qty)}</span>
        </div>`;
      }).join("");
      
      const subtotalVal = items.reduce((sum: number, i: any) => {
         const p = (getItemFinalPrice(i, wholesaleRules, smartVolumeRules) * increaseFactor);
         return sum + (p * i.qty);
      }, 0);
      const discountVal = subtotalVal * (printDiscountPct / 100);
      const subtotalNeto = subtotalVal - discountVal;
      const iva = applyIva ? subtotalNeto * (businessSettings?.config?.iva_rate ?? 0.16) : 0;

      const renderTicketBody = (isCopyFlag: boolean) => {
        const copyLabelHtml = job.isReprint
          ? `<div style="text-align:center; font-weight:bold; border: 2px dashed #000; padding: 6px; margin-bottom: 12px; font-size: 0.85em; background: #eee;">*** COPIA REIMPRESA - ${nowStr} ***</div>`
          : isCopyFlag 
          ? `<div style="text-align:center; font-weight:bold; border: 2px dashed #000; padding: 6px; margin-bottom: 12px; font-size: 0.9em; background: #eee;">*** COPIA PARA EL NEGOCIO ***</div>`
          : "";

        return `
          <div style="text-align: ${marginAlign}; width: 100%;">
            ${copyLabelHtml}
            ${cancelledLabelHtml}
            ${creditLabelHtml}
            ${showLogo ? `<div class="center"><img src="${businessProfile.logo}" style="max-width: 80px; margin-bottom: 10px;" /></div>` : ""}
            ${showName ? `<div class="center bold" style="font-size: 1.2em; margin-bottom: 5px;">${businessProfile.name}</div>` : ""}
            ${showRfc ? `<div class="center" style="font-size: 0.9em; margin-bottom: 3px;">RFC: ${businessProfile.rfc}</div>` : ""}
            ${showPhone ? `<div class="center" style="font-size: 0.9em; margin-bottom: 3px;">Tel: ${businessProfile.phone}</div>` : ""}
            ${showAddress ? `<div class="center" style="font-size: 0.9em; margin-bottom: 3px;">${businessProfile.address}</div>` : ""}
            ${showEmail ? `<div class="center" style="font-size: 0.9em; margin-bottom: 3px;">Email: ${businessProfile.email}</div>` : ""}

            <div class="divider"></div>
            <div class="center bold" style="margin-bottom: 5px;">Ticket: #${formatTicketFolio(printFolioId)}</div>
            <div style="font-size: 0.9em; margin-bottom: 5px;">Fecha: ${new Date().toLocaleString()}</div>

            ${showPaymentMethod && paymentMethod ? `<div style="font-size: 0.95em; margin-bottom: 5px;">Método de Pago: ${paymentMethod.toUpperCase()}</div>` : ""}
            ${showPaymentMethod && job.data.reference ? `<div style="font-size: 0.9em; margin-bottom: 5px;">Ref/Folio: ${job.data.reference}</div>` : ""}
            ${showPaymentMethod && paymentMethod === "mixto" ? `
            <div style="font-size: 0.85em; margin-left: 10px; margin-bottom: 5px; opacity: 0.8;">
              ${job.data.cashAmount > 0 ? `<span>- Efec: $${Math.round(job.data.cashAmount)}</span><br>` : ""}
              ${job.data.cardAmount > 0 ? `<span>- Tarj: $${Math.round(job.data.cardAmount)}</span><br>` : ""}
              ${job.data.transferAmount > 0 ? `<span>- Trans: $${Math.round(job.data.transferAmount)}</span>` : ""}
            </div>
            ` : ""}

            ${showSeller ? `<div style="font-size: 0.9em; margin-bottom: 5px;">Atendido por: ${currentUser?.name || "Venta Mostrador"}</div>` : ""}

            ${showCustomer && job.data.customerName ? `
            <div style="font-size: 0.85rem; margin-bottom: 5px;">
              <strong>Cliente:</strong> ${job.data.customerName}
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
            <div style="display:flex; justify-content:space-between;"><span>Subtotal:</span><span>$${Math.round(subtotalVal)}</span></div>
            ${printDiscountPct > 0 ? `
            <div style="display:flex; justify-content:space-between; color: red;"><span>Desc. (${printDiscountPct}%):</span><span>-${Math.round(discountVal)}</span></div>
            ` : ""}
            ${applyIva ? `
            <div style="display:flex; justify-content:space-between;"><span>IVA (16%):</span><span>$${Math.round(iva)}</span></div>
            ` : ""}
            <div class="divider"></div>
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
              <span>Entra a ${window.location.origin}/facturacion/${printInvoiceUrlToken} para facturar.</span>
            </div>
            ` : ""}
            ${showFooter ? `<div class="center bold" style="margin-top: 15px;">${footerMsg}</div>` : ""}
            <div style="height: 25px;"></div>
          </div>
        `;
      };

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
            ${doubleCopyEnabled && !job.isReprint && !job.isCopy
              ? `${renderTicketBody(false)}<div style="page-break-after: always; border-bottom: 2px dashed #000; margin: 25px 0; padding-bottom: 10px;"></div>${renderTicketBody(true)}`
              : renderTicketBody(job.isCopy)}
          </body>
        </html>
      `;
      printWindow.document.write(html);
      printWindow.document.close();
      setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
    } else if (job.type === "layaway") {
      const { customer, items, finalTotal, downPayment, discountPct = 0, applyIva = false } = job.data;
      const increaseFactor = discountPct < 0 ? (1 + Math.abs(discountPct) / 100) : 1;
      const printDiscountPct = discountPct < 0 ? 0 : discountPct;
      
      const itemsHtml = items.map((item: any) => {
        const p = (getItemFinalPrice(item, wholesaleRules) * increaseFactor);
        return `
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
          <div style="flex: 2;">${item.unit && item.unit !== "pz" ? `${item.qty} ${item.unit}` : `${item.qty}x`} ${item.name}${item.unit && item.unit !== "pz" ? `<div style="font-size: 0.8em; opacity: 0.7;">($${p.toFixed(2)}/${item.unit})</div>` : ''}</div>
          <div style="flex: 1; text-align: right;">${Math.round(p * item.qty)}</div>
        </div>`;
      }).join("");
      
      const subtotalVal = items.reduce((sum: number, item: any) => {
         const p = (getItemFinalPrice(item, wholesaleRules) * increaseFactor);
         return sum + (p * item.qty);
      }, 0);
      const discountVal = subtotalVal * (printDiscountPct / 100);
      const subtotalNeto = subtotalVal - discountVal;
      const iva = applyIva ? subtotalNeto * (businessSettings?.config?.iva_rate ?? 0.16) : 0;
      
      const renderLayawayBody = (isCopyFlag: boolean) => {
        const copyLabelHtml = job.isReprint
          ? `<div style="text-align:center; font-weight:bold; border: 2px dashed #000; padding: 6px; margin-bottom: 12px; font-size: 0.85em; background: #eee;">*** COPIA REIMPRESA - ${nowStr} ***</div>`
          : isCopyFlag 
          ? `<div style="text-align:center; font-weight:bold; border: 2px dashed #000; padding: 6px; margin-bottom: 12px; font-size: 0.9em; background: #eee;">*** COPIA PARA EL NEGOCIO ***</div>`
          : "";

        return `
          <div style="text-align: ${marginAlign}; width: 100%;">
            ${copyLabelHtml}
            ${showLogo ? `<div class="center"><img src="${businessProfile.logo}" style="max-width: 80px; margin-bottom: 10px;" /></div>` : ""}
            ${showName ? `<div class="center bold" style="font-size: 1.2em; margin-bottom: 5px;">${businessProfile.name}</div>` : ""}
            ${showRfc ? `<div class="center" style="font-size: 0.9em; margin-bottom: 3px;">RFC: ${businessProfile.rfc}</div>` : ""}
            ${showAddress ? `<div class="center" style="font-size: 0.9em; margin-bottom: 3px;">${businessProfile.address}</div>` : ""}
            ${showPhone ? `<div class="center" style="font-size: 0.9em; margin-bottom: 3px;">Tel: ${businessProfile.phone}</div>` : ""}
            ${showEmail ? `<div class="center" style="font-size: 0.9em; margin-bottom: 3px;">Email: ${businessProfile.email}</div>` : ""}
            
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
              <div>Subtotal:</div>
              <div>$${Math.round(subtotalVal)}</div>
            </div>
            ${printDiscountPct > 0 ? `
            <div style="display: flex; justify-content: space-between; margin-bottom: 5px; color: red;">
              <div>Desc. (${printDiscountPct}%):</div>
              <div>-${Math.round(discountVal)}</div>
            </div>
            ` : ""}
            ${applyIva ? `
            <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
              <div>IVA (16%):</div>
              <div>$${Math.round(iva)}</div>
            </div>
            ` : ""}
            <div class="divider"></div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 1.1em;">
              <strong>TOTAL:</strong>
              <strong class="bold">$${Math.round(finalTotal)}</strong>
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
        `;
      };

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
            ${doubleCopyEnabled && !job.isReprint && !job.isCopy
              ? `${renderLayawayBody(false)}<div style="page-break-after: always; border-bottom: 2px dashed #000; margin: 25px 0; padding-bottom: 10px;"></div>${renderLayawayBody(true)}`
              : renderLayawayBody(job.isCopy)}
          </body>
        </html>
      `;
      printWindow.document.write(ticketHtml);
      printWindow.document.close();
      setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
    }
  };

  const triggerPrint = (job: any) => {
    setLastPrintJob(job);
    try { localStorage.setItem("ERIKA_LAST_PRINT_JOB", JSON.stringify(job)); } catch (e) {}

    if (!isPrinterConnected) {
      setPendingPrintJob(job);
      try { localStorage.setItem("ERIKA_PENDING_PRINT_JOB", JSON.stringify(job)); } catch(e){}
      return;
    }
    
    executePrintWindow({ ...job, isCopy: false });
  };

  const handleReconnectPrinter = async (type?: string) => {
    setIsReconnecting(true);
    const connType = type || printerConnectionType;

    try {
      if (connType === "usb" && typeof navigator !== "undefined" && "usb" in navigator) {
        await (navigator.usb as any).requestDevice({ filters: [] });
      } else if (connType === "serial" && typeof navigator !== "undefined" && "serial" in navigator) {
        await (navigator.serial as any).requestPort();
      } else if (connType === "bluetooth" && typeof navigator !== "undefined" && "bluetooth" in navigator) {
        const result = await getOrReconnectBlePrinter(bleCharacteristic, true);
        if (result.success && result.char) {
          setBleCharacteristic(result.char);
          toast.success("✅ Impresora Bluetooth vinculada con éxito");
        } else if (result.error && !result.error.includes("cancelada")) {
          toast.error("Error de conexión: " + result.error);
        }
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
    
    if (pendingPrintJob) {
      const jobToRun = pendingPrintJob;
      setPendingPrintJob(null);
      try { localStorage.removeItem("ERIKA_PENDING_PRINT_JOB"); } catch(e){}
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

    const cleanPhone = cleanMexicanPhone(phone);
    if (!cleanPhone) {
      return alert("❌ Número inválido. Por favor ingresa un número de 10 dígitos (ej: 5512345678).");
    }

    const bizUpper = businessProfile.name.toUpperCase();
    const title = type === "quote" ? `*COTIZACIÓN - ${bizUpper}*` : `*RECIBO DE COMPRA - ${bizUpper}*`;
    const discountPct = activeTicket.discountPct || 0;
    const increaseFactor = discountPct < 0 ? (1 + Math.abs(discountPct) / 100) : 1;
    const itemsText = activeTicket.items.map(i => {
      const p = (getItemFinalPrice(i, wholesaleRules) * increaseFactor);
      return `▪️ ${i.qty}x ${i.name} - ${Math.round(p * i.qty)}`;
    }).join("\n");
    const totalText = applyIva 
      ? `*SUBTOTAL: ${Math.round(subtotalNeto)}*\n*IVA (16%): ${Math.round(iva)}*\n*TOTAL: ${Math.round(finalTotal)}*` 
      : `*TOTAL: ${Math.round(finalTotal)}*`;
    
    const billingText = type === "receipt" 
      ? `\n\n📄 Auto-Facturación Express:\nEntra a: ${window.location.origin}/facturacion/${invoiceToken} para facturar.` 
      : "";
    
    const rawMsg = `${title}\n\n${itemsText}\n\n${totalText}${billingText}\n\n¡Gracias por su preferencia!`;

    openWhatsAppChat(cleanPhone, rawMsg);
  };

  // Variables dinámicas para el recibo de impresión (para cotizaciones, ventas directas o apartados)
  const isPrintingJob = receiptToPrint !== null;
  const printType = isPrintingJob ? receiptToPrint.type : "quote";
  const printTitle = printType === "ticket" ? "TICKET DE VENTA" : (printType === "layaway" ? "COMPROBANTE DE APARTADO" : "COTIZACIÓN");
  const printIsCancelled = isPrintingJob ? !!receiptToPrint.isCancelled : false;
  
  const rawPrintDiscountPct = isPrintingJob ? receiptToPrint.discountPct : activeTicket.discountPct;
  const printIncreaseFactor = rawPrintDiscountPct < 0 ? (1 + Math.abs(rawPrintDiscountPct) / 100) : 1;
  const printDiscountPct = rawPrintDiscountPct < 0 ? 0 : rawPrintDiscountPct;
  const printDiscountAmount = rawPrintDiscountPct < 0 ? 0 : (isPrintingJob ? receiptToPrint.discountAmount : discountAmount);

  const printItems = (isPrintingJob ? receiptToPrint.items : activeTicket.items).map((item: any) => {
    if (rawPrintDiscountPct < 0) {
      return {
        ...item,
        price: (getItemFinalPrice(item, wholesaleRules) * printIncreaseFactor),
        discountPct: 0
      };
    }
    return item;
  });
  const printSubtotal = isPrintingJob ? receiptToPrint.subtotal : subtotal;
  const printIva = isPrintingJob ? receiptToPrint.iva : iva;
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
  const printDownPayment = isPrintingJob ? (receiptToPrint?.downPayment ?? 0) : 0;
  const printBalance = isPrintingJob ? (receiptToPrint?.balance ?? 0) : 0;

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
            addProductToCart(matched);
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
          gap: "8px",
        }}
      >
        <div
          className="glass-panel"
          style={{
            position: "relative",
            padding: "10px 14px",
            border: isOffline
              ? "2px solid #ef4444"
              : "1px solid rgba(255,255,255,0.1)",
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSearchSubmit(e as any);
            }}
            style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" }}
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
                        padding: "6px 12px",
                        height: "36px",
                        borderRadius: "8px",
                        background: "rgba(0,0,0,0.3)",
                        color: "white",
                        border: "1px solid var(--color-primary)",
                        fontSize: "0.85rem"
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
                          boxShadow: "0 10px 25px rgba(0,0,0,0.5)"
                        }}>
                          {filteredCatalog.map((c, idx) => (
                            <div 
                              key={c.id} 
                              onMouseDown={async (e) => {
                                e.preventDefault();
                                if (c.stock <= 0) {
                                  if (window.confirm(`El producto "${c.name}" está AGOTADO. ¿Deseas registrarlo en el Radar de Demanda (Ventas Perdidas)?`)) {
                                    const panicData = JSON.parse(localStorage.getItem("PANIC_DEMAND_RADAR") || "[]");
                                    panicData.push({ term: c.name, date: new Date().toISOString() });
                                    localStorage.setItem("PANIC_DEMAND_RADAR", JSON.stringify(panicData));
                                    await supabase.from("lost_sales_requests").insert({ term: c.name, type: "STOCK_AGOTADO" });
                                    
                                    if (panicData && panicData.length >= 5) {
                                      alert(`🚨 ¡ALERTA DE PÁNICO! 🚨\nEl producto "${c.name}" se ha negado por falta de stock ${panicData.length} veces solo el día de HOY. ¡Sugiero hacer un pedido de emergencia al proveedor YA!`);
                                    } else {
                                      alert("✅ Registrado en el reporte de inteligencia.");
                                    }
                                  }
                                } else {
                                  addProductToCart(c);
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
                                    <span title="Producto de Alta Rentabilidad" style={{ fontSize: "0.7rem", background: "rgba(234, 179, 8, 0.15)", border: "1px solid rgba(234, 179, 8, 3)", color: "#eab308", padding: "2px 6px", borderRadius: "10px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
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
                                  e.preventDefault(); 
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
              type="button"
              onClick={startVoiceRecognition}
              title={isListening ? "Escuchando... Clic para detener" : "Dictar producto por voz"}
              style={{
                background: isListening ? "#ef4444" : "rgba(255,255,255,0.06)",
                border: isListening ? "1px solid #ef4444" : "1px solid var(--color-primary)",
                color: "white",
                width: "36px",
                height: "36px",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.95rem",
                cursor: "pointer",
                flexShrink: 0,
                transition: "all 0.2s ease"
              }}
            >
              🎤
            </button>
            <button
              type="submit"
              className="btn-primary"
              style={{ background: "var(--color-secondary)", color: "black", height: "36px", padding: "0 14px", fontSize: "0.85rem" }}
            >
              Agregar
            </button>
          </form>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
            <h3 style={{ color: "var(--color-secondary)", margin: 0, fontSize: "0.82rem", fontWeight: "bold" }}>
              ⚡ Atajos Rápidos (12 Más Vendidos)
            </h3>
            <span style={{ fontSize: "0.65rem", opacity: 0.6 }}>3 por fila • 12 productos</span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "3px",
            }}
          >
            {(topSellingProducts.length > 0 ? topSellingProducts.slice(0, 12) : globalCatalog.slice(0, 12)).map((c, i) => (
              <button
                key={c.id}
                type="button"
                className="btn-primary"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  padding: "2px 4px",
                  borderRadius: "4px",
                  fontSize: "0.64rem",
                  textAlign: "left",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  minHeight: "28px",
                  lineHeight: "1.05",
                  cursor: "pointer"
                }}
                onClick={() => addProductToCart(c)}
                title={`${c.name}${c.code ? ` (${c.code})` : ""} • Precio: $${c.price} • Stock: ${c.stock ?? 0}`}
              >
                <div style={{ display: "flex", justifyContent: "space-between", width: "100%", gap: "3px" }}>
                  <span style={{ color: "var(--color-primary)", fontWeight: "bold", fontSize: "0.62rem" }}>
                    [{i + 1}]
                  </span>
                  <strong style={{ color: "var(--color-secondary)", fontSize: "0.64rem" }}>
                    ${c.price}
                  </strong>
                </div>
                <span style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  width: "100%",
                  display: "block",
                  opacity: 0.9
                }}>
                  {c.name}
                </span>
                {c.code && (
                  // Varios productos comparten nombre a propósito (distintas
                  // presentaciones, ver src/lib/posItemMatch.ts) -- sin el
                  // código visible aquí, un atajo rápido con el mismo nombre
                  // que otro es indistinguible antes de darle clic.
                  <span style={{
                    fontSize: "0.56rem",
                    fontFamily: "monospace",
                    opacity: 0.55,
                    display: "block",
                  }}>
                    {c.code}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div
          className="glass-panel"
          style={{
            background: "linear-gradient(135deg, rgba(16, 185, 129, 0.08), transparent)",
            border: "1px solid var(--color-secondary)",
            padding: "5px 8px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "3px" }}>
            <h3 style={{ color: "var(--color-secondary)", margin: 0, fontSize: "0.82rem", display: "flex", alignItems: "center", gap: "5px" }}>
              <span>🧠</span>
              <span>ERIKA Sugiere Ofrecer (8 Artículos):</span>
            </h3>
            {activeTicket.items.length > 0 && (
              <span style={{ fontSize: "0.62rem", color: "#10b981", fontWeight: "bold" }}>
                ✨ Asociados a esta venta
              </span>
            )}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "3px",
            }}
          >
            {getCrossSellSuggestions().map((sug, idx) => (
              <div
                key={idx}
                onClick={() => addProductToCart(sug)}
                style={{
                  background: "rgba(0,0,0,0.35)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  padding: "2px 4px",
                  borderRadius: "4px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  minHeight: "28px",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  lineHeight: "1.05",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--color-secondary)";
                  e.currentTarget.style.background = "rgba(16, 185, 129, 0.15)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                  e.currentTarget.style.background = "rgba(0,0,0,0.35)";
                }}
                title={`${sug.name} • Precio: $${sug.price} (Clic para añadir a la nota)`}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                  <strong style={{ color: "var(--color-primary)", fontSize: "0.64rem" }}>
                    ${sug.price}
                  </strong>
                  <span style={{
                    fontSize: "0.58rem",
                    background: "var(--color-secondary)",
                    color: "black",
                    fontWeight: "bold",
                    borderRadius: "2px",
                    padding: "0px 2px"
                  }}>
                    +
                  </span>
                </div>
                <span style={{
                  fontSize: "0.62rem",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  width: "100%",
                  color: "#fff"
                }}>
                  {sug.name}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Barra inferior compacta de Terminal / Estado / Herramientas */}
        <div
          className="glass-panel"
          style={{
            padding: "4px 10px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            border: isOffline ? "1px solid #ef4444" : "1px solid rgba(255,255,255,0.08)",
            background: "rgba(18, 18, 28, 0.6)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {/* Antes vivía flotando arriba de toda la pantalla (ver
                GlobalIntelligenceWidget.tsx, que la oculta solo en esta
                ruta); aquí usa la variante compacta "inline" para no
                agrandar esta barra. */}
            <IntelligenceNotifications variant="inline" />

            <span style={{ fontSize: "0.78rem", fontWeight: "bold", color: isOffline ? "#ef4444" : "var(--color-primary)" }}>
              {isOffline ? "⚠️ Terminal Offline" : "☁️ Terminal Nube"}
            </span>

            <button
              type="button"
              onClick={openCancelTicketModal}
              className="btn-primary"
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid #ef4444",
                color: "#ef4444",
                padding: "3px 8px",
                fontSize: "0.74rem",
                fontWeight: "bold",
                borderRadius: "6px",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                cursor: "pointer",
                transition: "all 0.2s ease"
              }}
              title="Cancelar tickets impresos/ventas (Requiere clave de administrador)"
            >
              <span>🚫</span>
              <span>Cancelar Ticket</span>
            </button>
          </div>

          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button
              onClick={() => setShowSyncLogModal(true)}
              className="btn-primary"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "white",
                padding: "4px 10px",
                fontSize: "0.75rem",
                borderRadius: "6px"
              }}
            >
              📋 Historial Sync
              {pendingOfflineCount > 0 && (
                <span
                  style={{
                    background: "#ef4444",
                    padding: "1px 5px",
                    borderRadius: "6px",
                    fontSize: "0.7rem",
                    fontWeight: "bold",
                    marginLeft: "4px"
                  }}
                >
                  {pendingOfflineCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setShowPrinterModal(true)}
              className="btn-primary"
              style={{
                background: printerConnectionType === "bluetooth"
                  ? (bleStatus === "connected" ? "rgba(16, 185, 129, 0.2)" : bleStatus === "standby" ? "rgba(245, 158, 11, 0.2)" : "rgba(244, 63, 94, 0.2)")
                  : (isPrinterConnected ? "rgba(16, 185, 129, 0.15)" : "rgba(244, 63, 94, 0.15)"),
                border: printerConnectionType === "bluetooth"
                  ? (bleStatus === "connected" ? "1px solid #10b981" : bleStatus === "standby" ? "1px solid #f59e0b" : "1px solid #f43f5e")
                  : (isPrinterConnected ? "1px solid var(--color-secondary)" : "1px solid var(--color-primary)"),
                padding: "4px 10px",
                fontSize: "0.75rem",
                borderRadius: "6px",
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              <span>
                {printerConnectionType === "bluetooth"
                  ? (bleStatus === "connected" ? "🟢" : bleStatus === "standby" ? "🟡" : "🔴")
                  : (isPrinterConnected ? "🟢" : "🔴")}
              </span>
              <span>
                {printerConnectionType === "bluetooth"
                  ? (bleStatus === "connected" ? "BLE Conectado" : bleStatus === "standby" ? "BLE Standby" : "BLE Desconectado")
                  : (isPrinterConnected ? `Impresora Lista${silentKiosk ? " (Kiosco ⚡)" : ""}` : "Impresora Off")}
              </span>
            </button>

            <button
              onClick={() => setShowScanner(true)}
              className="btn-primary"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid var(--color-secondary)",
                padding: "4px 10px",
                fontSize: "0.75rem",
                borderRadius: "6px"
              }}
            >
              📷 Visión
            </button>
          </div>
        </div>
      </div>

      <div
        className="glass-panel no-print"
        style={{ width: "450px", display: "flex", flexDirection: "column" }}
      >
        <div className="flex-between" style={{ marginBottom: "10px", alignItems: "center" }}>
          <button
            type="button"
            onClick={openTicketsHistoryModal}
            className="btn-primary"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid var(--glass-border)",
              color: "white",
              padding: "6px 12px",
              fontSize: "0.8rem",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
            title="Consultar últimas ventas y buscar tickets para reimprimir"
          >
            <span>🎟️</span>
            <span>Buscar Tickets / Ant.</span>
          </button>

          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            {cancellations.length > 0 && (
              <button
                className="btn-primary"
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-primary)",
                  padding: "5px 10px",
                  fontSize: "0.75rem",
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
              style={{
                background: "var(--color-primary)",
                padding: "6px 12px",
                fontSize: "0.8rem",
                fontWeight: "bold"
              }}
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
            gap: "4px",
            marginBottom: "4px",
            overflowX: "auto",
            paddingBottom: "2px",
          }}
        >
          {tickets.map((t) => {
            const hasItems = t.items && t.items.length > 0;
            const isActive = activeTicketId === t.id;
            return (
              <div
                key={t.id}
                onClick={() => setActiveTicketId(t.id)}
                className={`btn-primary ${!isActive ? "inactive" : ""}`}
                style={{
                  padding: "3px 6px 3px 7px",
                  borderRadius: "8px",
                  fontSize: "0.72rem",
                  fontWeight: "600",
                  opacity: isActive ? 1 : 0.5,
                  lineHeight: "1.2",
                  whiteSpace: "nowrap",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  cursor: "pointer",
                  border: hasItems ? "1px solid #10b981" : "1px solid transparent",
                }}
              >
                {hasItems && (
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: "#10b981",
                      boxShadow: "0 0 5px #10b981",
                      display: "inline-block",
                    }}
                    title={`${t.items.length} producto(s) en nota`}
                  />
                )}
                <span>Cliente {t.id}</span>
                {hasItems && (
                  <span style={{ fontSize: "0.65rem", opacity: 0.85, color: "#10b981" }}>
                    ({t.items.length})
                  </span>
                )}
                {tickets.length > 1 && (
                  <span
                    onClick={(e) => handleCloseTicket(e, t.id)}
                    style={{
                      marginLeft: "2px",
                      padding: "0 2px",
                      fontSize: "0.7rem",
                      color: "rgba(255,255,255,0.6)",
                      cursor: "pointer",
                      borderRadius: "3px",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.6)")}
                    title="Cerrar esta nota"
                  >
                    ✕
                  </span>
                )}
              </div>
            );
          })}
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
              padding: "10px 14px",
              marginBottom: "12px",
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
              <span style={{ fontSize: "1.2rem" }}>⚠️</span>
              <div>
                <strong style={{ color: "var(--color-primary)", fontSize: "0.85rem", display: "block" }}>
                  Impresora Desconectada
                </strong>
                <span style={{ fontSize: "0.75rem", opacity: 0.8 }}>
                  Hay un ticket en espera. Haz clic para reconectar y auto-imprimir.
                </span>
              </div>
            </div>
            <span
              style={{
                background: "var(--color-primary)",
                color: "white",
                padding: "4px 8px",
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
            padding: "8px",
            marginBottom: "8px",
          }}
        >
          <ul style={{ listStyle: "none" }}>
            {activeTicket.items.map((item) => {
              const invItem = globalCatalog.find(i => matchesProduct(item, i));
              const hasInsufficientStock = invItem && item.qty > invItem.stock;
              const isLowStock = invItem && invItem.stock > 0 && invItem.stock <= 5;
              const otherVariants = globalCatalog.filter((c) => c.name === item.name && c.code !== item.code);
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
                        {item.code && (
                          <span
                            style={{
                              marginLeft: "8px",
                              fontSize: "0.72rem",
                              color: "var(--color-secondary)",
                              fontFamily: "monospace",
                              opacity: 0.7,
                            }}
                            title="Código de esta presentación exacta — dos productos con el mismo nombre pueden tener código distinto (ver Existencias)."
                          >
                            {item.code}
                          </span>
                        )}
                        {(() => {
                          const smartDisc = getSmartVolumeDiscount(item, smartVolumeRules);
                          if (smartDisc.discountPct > 0) {
                            return (
                              <span
                                style={{
                                  marginLeft: "8px",
                                  background: "linear-gradient(135deg, #10b981, #059669)",
                                  color: "white",
                                  padding: "2px 8px",
                                  borderRadius: "6px",
                                  fontSize: "0.72rem",
                                  fontWeight: "bold",
                                  boxShadow: "0 2px 6px rgba(16,185,129,0.3)",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "3px"
                                }}
                                title={`Descuento inteligente aplicado: ${smartDisc.ruleName || 'Volumen'} (${smartDisc.tierQty}+ pz)`}
                              >
                                ⚡ VOLUMEN ({smartDisc.tierQty}+ {item.unit || 'pz'}): -{smartDisc.discountPct}%
                              </span>
                            );
                          }
                          // El badge de "MAYOREO" se retiró junto con el
                          // Mayoreo Automático (ver getItemFinalPrice):
                          // Descuento Inteligente ya cubre este caso con
                          // una regla targetType:"all", que sí se refleja
                          // arriba como "⚡ VOLUMEN".
                          return null;
                        })()}
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
                          ${((getItemFinalPrice(item, wholesaleRules, smartVolumeRules) * increaseFactor) * item.qty).toFixed(activeTicket.discountPct < 0 ? 0 : 2)}
                        </strong>
                        {(() => {
                          const smartDisc = getSmartVolumeDiscount(item, smartVolumeRules);
                          const effectiveDisc = Math.max(item.discountPct || 0, smartDisc.discountPct || 0);
                          if (effectiveDisc > 0) {
                            return (
                              <span style={{ fontSize: "0.75rem", color: "#10b981", display: "block", textAlign: "right", marginTop: "2px", fontWeight: "bold" }}>
                                Desc. -{effectiveDisc}%
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* 💡 Sugerencia de Oportunidad de Venta por Volumen (Upsell) */}
                  {(() => {
                    const nextTier = getNextSmartVolumeTier(item, smartVolumeRules);
                    if (nextTier && nextTier.diff <= 25) {
                      return (
                        <div
                          onClick={() => updateItemQty(item.id, nextTier.nextQty)}
                          style={{
                            background: "rgba(245, 158, 11, 0.12)",
                            border: "1px dashed #f59e0b",
                            borderRadius: "6px",
                            padding: "4px 8px",
                            fontSize: "0.75rem",
                            color: "#fbbf24",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            cursor: "pointer",
                            transition: "all 0.2s"
                          }}
                          title={`Haz clic para cambiar la cantidad a ${nextTier.nextQty} ${item.unit || 'pz'} y obtener ${nextTier.discountPct}% de descuento`}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(245, 158, 11, 0.22)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(245, 158, 11, 0.12)")}
                        >
                          <span>
                            💡 <strong>¡Oportunidad de Venta!:</strong> Lleva <strong>{nextTier.diff} {item.unit || 'pz'}</strong> más para alcanzar {nextTier.nextQty} {item.unit || 'pz'} y obtener <strong>{nextTier.discountPct}% desc.</strong>
                          </span>
                          <span
                            style={{
                              background: "#f59e0b",
                              color: "black",
                              fontWeight: "bold",
                              padding: "2px 7px",
                              borderRadius: "4px",
                              fontSize: "0.7rem",
                              whiteSpace: "nowrap",
                              marginLeft: "6px"
                            }}
                          >
                            + Subir a {nextTier.nextQty}
                          </span>
                        </div>
                      );
                    }
                    return null;
                  })()}

                <div className="flex-between" style={{ alignItems: "center" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      background: "rgba(255,255,255,0.08)",
                      padding: "3px 8px",
                      borderRadius: "12px",
                      border: "1px solid rgba(255,255,255,0.12)"
                    }}
                  >
                    <button
                      type="button"
                      style={{
                        background: "rgba(255,255,255,0.1)",
                        border: "none",
                        color: "white",
                        cursor: "pointer",
                        width: "26px",
                        height: "26px",
                        borderRadius: "6px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "1.1rem",
                        fontWeight: "bold",
                        lineHeight: 1
                      }}
                      onClick={() => updateItemQty(item.id, Math.max(1, item.qty - 1))}
                      title="Disminuir 1 pieza"
                    >
                      -
                    </button>

                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <input
                        type="number"
                        min="0.01"
                        step={item.unit === "pz" ? "1" : "any"}
                        value={item.qty}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (!isNaN(val) && val > 0) {
                            updateItemQty(item.id, val);
                          }
                        }}
                        onFocus={(e) => e.target.select()}
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                        style={{
                          width: "56px",
                          textAlign: "center",
                          fontWeight: "bold",
                          fontSize: "0.95rem",
                          color: "var(--color-secondary)",
                          background: "rgba(0,0,0,0.5)",
                          border: "1px solid var(--color-secondary)",
                          borderRadius: "6px",
                          padding: "3px 2px",
                          outline: "none"
                        }}
                        title="Escribe directamente la cantidad que deseas vender (ej. 30)"
                      />
                      <span style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.85)", fontWeight: "600" }}>
                        {item.unit || "pz"}
                      </span>
                    </div>

                    <button
                      type="button"
                      style={{
                        background: "rgba(255,255,255,0.1)",
                        border: "none",
                        color: "white",
                        cursor: "pointer",
                        width: "26px",
                        height: "26px",
                        borderRadius: "6px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "1.1rem",
                        fontWeight: "bold",
                        lineHeight: 1
                      }}
                      onClick={() => updateItemQty(item.id, item.qty + 1)}
                      title="Aumentar 1 pieza"
                    >
                      +
                    </button>

                    {hasInsufficientStock && (
                      <span style={{ color: "#ef4444", fontSize: "0.78rem", fontWeight: "bold", marginLeft: "6px" }}>
                        ⚠️ Excede stock ({invItem.stock})
                      </span>
                    )}
                    {!hasInsufficientStock && isLowStock && (
                      <span style={{ color: "#f59e0b", fontSize: "0.78rem", fontWeight: "bold", marginLeft: "6px" }}>
                        ⚠️ Quedan {invItem.stock}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>

                    {otherVariants.length > 0 && (
                      <button
                        style={{
                          background: "transparent",
                          border: "1px solid #f59e0b",
                          color: "#f59e0b",
                          cursor: "pointer",
                          padding: "5px 10px",
                          borderRadius: "6px",
                          fontSize: "0.8rem",
                        }}
                        onClick={() => setShowVariantsFor(showVariantsFor === item.id ? null : item.id)}
                        title={`Hay ${otherVariants.length} otra(s) presentación(es) de "${item.name}" con este mismo nombre`}
                      >
                        🔄 Otra presentación ({otherVariants.length})
                      </button>
                    )}

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

                {showVariantsFor === item.id && otherVariants.length > 0 && (
                  // Mismo nombre, código distinto -- exactamente el caso que causó
                  // el bug del 2026-08-25 (video del cliente: agregó la
                  // presentación de $203 y necesitaba también la de $113, y el
                  // carrito colapsó ambas en una sola línea). Aquí se elige
                  // explícitamente la presentación correcta en vez de adivinar
                  // por nombre.
                  <div
                    style={{
                      background: "rgba(245, 158, 11, 0.06)",
                      border: "1px dashed #f59e0b",
                      borderRadius: "8px",
                      padding: "8px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                    }}
                  >
                    <span style={{ fontSize: "0.72rem", color: "#f59e0b", fontWeight: "bold" }}>
                      Otras presentaciones de &quot;{item.name}&quot;:
                    </span>
                    {otherVariants.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => switchCartItemVariant(item.id, v)}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          background: "rgba(0,0,0,0.3)",
                          border: "1px solid rgba(245, 158, 11, 0.3)",
                          borderRadius: "6px",
                          padding: "6px 10px",
                          cursor: "pointer",
                          color: "white",
                          fontSize: "0.78rem",
                        }}
                      >
                        <span style={{ fontFamily: "monospace", opacity: 0.85 }}>{v.code || "(sin código)"}</span>
                        <span>${v.price}</span>
                        <span style={{ opacity: 0.7 }}>Stock: {v.stock}</span>
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
            })}
          </ul>
        </div>

        <div
          style={{
            background: "rgba(255,255,255,0.05)",
            padding: "12px 16px",
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
                % Desc/Aumen [F4]
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
            {activeTicket.discountPct !== 0 && (
              <span
                style={{ color: activeTicket.discountPct > 0 ? "var(--color-primary)" : "#f59e0b", fontWeight: "bold" }}
              >
                {activeTicket.discountPct > 0 ? `-${activeTicket.discountPct.toFixed(1)}%` : `+${Math.abs(activeTicket.discountPct).toFixed(1)}%`}
              </span>
            )}
          </div>
          
          <div className="flex-between" style={{ marginBottom: "8px", fontSize: "0.95rem", opacity: 0.9 }}>
            <span>Subtotal:</span>
            <span style={{ fontWeight: "bold" }}>${formatPrice(subtotal)}</span>
          </div>

          {itemDiscountsSavings > 0 && (
             <div className="flex-between" style={{ marginBottom: "8px", color: "#10b981", fontSize: "0.88rem" }}>
               <span>Ahorro por productos:</span>
               <span>-${formatPrice(itemDiscountsSavings)}</span>
             </div>
          )}

          {activeTicket.discountPct > 0 && (
             <div className="flex-between" style={{
               marginBottom: "8px",
               color: "#10b981",
               background: "rgba(16, 185, 129, 0.12)",
               padding: "5px 10px",
               borderRadius: "6px",
               fontWeight: "bold",
               fontSize: "0.9rem",
               border: "1px solid rgba(16, 185, 129, 0.25)"
             }}>
               <span>🏷️ Descuento (-{activeTicket.discountPct}%):</span>
               <span>-${formatPrice(discountAmount)}</span>
             </div>
          )}
          {activeTicket.discountPct < 0 && (
             <div className="flex-between" style={{
               marginBottom: "8px",
               color: "#f59e0b",
               background: "rgba(245, 158, 11, 0.12)",
               padding: "5px 10px",
               borderRadius: "6px",
               fontWeight: "bold",
               fontSize: "0.9rem",
               border: "1px solid rgba(245, 158, 11, 0.25)"
             }}>
               <span>📈 Aumento (+{Math.abs(activeTicket.discountPct)}%):</span>
               <span>+${formatPrice(-discountAmount)}</span>
             </div>
          )}

          {applyIva && (
             <div className="flex-between" style={{ marginBottom: "8px", color: "#3b82f6", fontSize: "0.9rem" }}>
               <span>IVA (16%):</span>
               <span>+${formatPrice(iva)}</span>
             </div>
          )}

          <div
            className="flex-between"
            style={{
              marginBottom: "12px",
              borderTop: "1px solid rgba(255,255,255,0.2)",
              paddingTop: "10px",
              alignItems: "center"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "1.4rem", fontWeight: "bold" }}>TOTAL</span>
              <label style={{ display: "flex", alignItems: "center", gap: "5px", cursor: "pointer", fontSize: "0.76rem", color: applyIva ? "#3b82f6" : "var(--color-secondary)", opacity: 0.9 }}>
                <input type="checkbox" checked={applyIva} onChange={(e) => setApplyIva(e.target.checked)} style={{ width: "13px", height: "13px", accentColor: "#3b82f6", cursor: "pointer" }} />
                <span>Cobrar IVA (16%)</span>
              </label>
            </div>
            <span style={{ color: "var(--color-secondary)", fontSize: "1.5rem", fontWeight: "bold" }}>
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
                    padding: "10px 35px 10px 10px",
                    borderRadius: "8px",
                    background: "white",
                    color: "black",
                    border: "1px solid var(--color-primary)",
                  }}
                />
                {selectedCustomerId && (
                   <button
                     type="button"
                     onClick={() => {
                       setSelectedCustomerId("");
                       setCustomerSearch("");
                     }}
                     style={{
                       position: "absolute",
                       right: "10px",
                       top: "50%",
                       transform: "translateY(-50%)",
                       background: "transparent",
                       border: "none",
                       color: "#9ca3af",
                       fontSize: "1.2rem",
                       cursor: "pointer",
                       padding: "5px"
                     }}
                     title="Quitar cliente seleccionado"
                   >
                     ✖
                   </button>
                 )}
                 
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
            <div style={{ display: "flex", flexDirection: "column", gap: "5px", marginTop: "-10px", marginBottom: "15px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
              {customerActiveStats && (customerActiveStats.layawaysCount > 0 || customerActiveStats.quotesCount > 0) && (
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "3px" }}>
                  {customerActiveStats.layawaysCount > 0 && (
                    <span 
                      style={{ 
                        background: "rgba(245, 158, 11, 0.15)", 
                        border: "1px solid #f59e0b", 
                        color: "#f59e0b", 
                        fontSize: "0.75rem", 
                        padding: "2px 6px", 
                        borderRadius: "4px",
                        fontWeight: "500" 
                      }}
                      title="Este cliente tiene apartados pendientes por liquidar"
                    >
                      📦 {customerActiveStats.layawaysCount} Apartado(s) pendiente(s)
                    </span>
                  )}
                  {customerActiveStats.quotesCount > 0 && (
                    <span 
                      style={{ 
                        background: "rgba(59, 130, 246, 0.15)", 
                        border: "1px solid #3b82f6", 
                        color: "#3b82f6", 
                        fontSize: "0.75rem", 
                        padding: "2px 6px", 
                        borderRadius: "4px",
                        fontWeight: "500" 
                      }}
                      title="Este cliente tiene cotizaciones activas sin concretar"
                    >
                      📄 {customerActiveStats.quotesCount} Cotización(es) activa(s)
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

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

                   // Decremento atómico en el servidor (evita que dos
                   // canjes casi simultáneos al mismo cliente pierdan
                   // puntos entre sí).
                   const { error: pointsErr } = await adjustCustomerPoints(customer.id, -pointsToRedeem);
                   if (pointsErr) return alert("Error al descontar puntos.");

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
                   const { data: custData, error: custError } = await fetchActiveCustomers({
                     warn: businessSettings?.config?.customer_list_warn_threshold,
                     danger: businessSettings?.config?.customer_list_danger_threshold,
                   });
                   if (custError) {
                     console.error("Error al recargar clientes (puntos):", custError);
                     LoggerService.logError("POSModule_reloadCustomers_Points_fallback", custError);
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

          {/* Fila 1: Cobrar, Crédito y acciones rápidas de Cotización */}
          <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
            <button
              className="btn-primary"
              style={{
                flex: 1.5,
                padding: "8px 12px",
                background: "linear-gradient(135deg, var(--color-primary), #059669)",
                border: "none",
                fontWeight: "bold",
                color: "white",
                fontSize: "0.85rem",
                borderRadius: "8px",
              }}
              onClick={() => {
                if (activeTicket.items.length === 0) return alert("El ticket está vacío.");
                if (!selectedCustomerId && finalTotal >= 1000) {
                  const confirmNoCust = window.confirm(
                    `⚠️ VENTA IMPORTANTE DETECTADA: El total es de $${finalTotal.toFixed(2)}.\n¿Deseas registrar o seleccionar un cliente para registrarle puntos antes de proceder?`
                  );
                  if (confirmNoCust) {
                    const inputEl = document.querySelector('input[placeholder*="Buscar cliente"]') as HTMLInputElement;
                    if (inputEl) inputEl.focus();
                    return;
                  }
                }
                setPaymentMethod("efectivo");
                setCashPayAmount(finalTotal.toFixed(2));
                setCardPayAmount("");
                setTransferPayAmount("");
                checkoutTokenRef.current = crypto.randomUUID();
                setShowCheckoutModal(true);
              }}
            >
              💰 Cobrar
            </button>
            <button
              className="btn-primary"
              style={{
                flex: 1.2,
                padding: "8px 10px",
                background: "transparent",
                border: "1px solid #eab308",
                color: "#eab308",
                fontSize: "0.8rem",
                borderRadius: "8px",
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
            <button
              className="btn-primary"
              style={{
                padding: "8px 12px",
                background: "transparent",
                border: "1px solid #3b82f6",
                color: "#3b82f6",
                fontSize: "0.95rem",
                borderRadius: "8px",
              }}
              title="Guardar Cotización"
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

                const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);
                const quoteInsertObj: any = {
                  customer_name: customerName,
                  customer_id: selectedCustomerId || null,
                  customer_phone: selectedCustomer?.phone || null,
                  items: activeTicket.items,
                  total: finalTotal,
                  status: "pending",
                  // Sin esto, el % de descuento/aumento y el IVA que
                  // produjeron `finalTotal` se perdían por completo: al
                  // mandar la cotización a caja se recalculaba el total
                  // desde los precios base de `items`, dando un monto
                  // distinto al que realmente se le cotizó al cliente.
                  discount_pct: activeTicket.discountPct,
                  apply_iva: applyIva,
                };
                let { error } = await saveQuote({ fields: quoteInsertObj });
                if (error) {
                  console.warn("Falla al insertar quotes con customer_phone, reintentando sin ella...");
                  delete quoteInsertObj.customer_phone;
                  ({ error } = await saveQuote({ fields: quoteInsertObj }));
                }
                if (error)
                  return alert("Error al guardar cotización: " + error.message);
                alert("✅ Cotización guardada con éxito.");
                setSelectedCustomerId("");
                setTickets(
                  tickets.map((t) =>
                    t.id === activeTicketId
                      ? { ...t, items: [], discountPct: 0 }
                      : t,
                  ),
                );
              }}
            >
              📄
            </button>
            <button
              className="btn-primary"
              style={{
                padding: "8px 12px",
                background: "transparent",
                border: "1px solid #22c55e",
                color: "#22c55e",
                fontSize: "0.95rem",
                borderRadius: "8px",
              }}
              title="Enviar Cotización por WhatsApp"
              onClick={() => sendWhatsApp("quote")}
            >
              💬
            </button>
          </div>

          {/* Fila 2: Devolución y Apartado (50% de tamaño) */}
          <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
            <button
              className="btn-primary"
              style={{
                flex: 1,
                padding: "5px 8px",
                background: "transparent",
                border: "1px solid #ef4444",
                color: "#ef4444",
                fontSize: "0.72rem",
                borderRadius: "6px",
              }}
              onClick={async () => {
                if (currentUser?.role !== "admin") {
                   const pass = window.prompt("🔒 DEVOLUCIÓN - Requiere contraseña de Administrador:");
                   if (!pass || !(await verifyAdminPinRemote(pass))) return alert("❌ Contraseña incorrecta o sin privilegios.");
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
                   
                   const { error } = await insertCashTransaction({
                      type: "withdrawal",
                      amount: -amount,
                      description: `Devolución: ${reason}`
                   });
                   if (error) return alert("Error al registrar devolución: " + error.message);

                   // Restaurar inventario devuelto si aplica
                   if (window.confirm("¿La devolución incluye mercancía física que debe regresar al inventario?")) {
                      const searchTerm = window.prompt("Nombre o código del producto devuelto:");
                      if (searchTerm) {
                         const termLower = searchTerm.trim().toLowerCase();
                         const matches = globalCatalog.filter(i =>
                            i.name.toLowerCase().includes(termLower) || (i.code && i.code.toLowerCase() === termLower)
                         );
                         if (matches.length === 0) {
                            alert(`❌ No se encontró ningún producto que coincida con "${searchTerm}". Ajusta el stock manualmente desde Inventario.`);
                         } else if (matches.length > 1) {
                            alert(`⚠️ Coinciden ${matches.length} productos con "${searchTerm}" (${matches.map(m => m.name).join(", ")}). Sé más específico o ajusta el stock manualmente desde Inventario.`);
                         } else {
                            const product = matches[0];
                            const qtyStr = window.prompt(`¿Cuántas unidades de "${product.name}" regresan al inventario?`, "1");
                            const qty = parseFloat((qtyStr || "").replace(",", "."));
                            if (!isNaN(qty) && qty > 0) {
                               const { error: invErr } = await reduceInventoryStock([{ id: product.id, qty: -qty }], "adjustment", `RET-${Date.now()}`);
                               if (invErr) {
                                 console.warn("Falla al ajustar inventario en devolución:", invErr.message);
                                 toast.error(`⚠️ La devolución se registró, pero el inventario no se pudo ajustar: ${invErr.message}. Revisa el stock manualmente.`, { duration: 8000 });
                               }
                               setGlobalCatalog(prev => prev.map(i => i.id === product.id ? { ...i, stock: i.stock + qty } : i));
                            }
                         }
                      }
                   }

                   alert(`✅ Devolución exitosa. Se retiraron $${amount.toFixed(2)} de la caja.`);
                } else {
                   alert("❌ Las devoluciones solo se pueden hacer en modo en línea.");
                }
              }}
            >
              ↩️ Devolución / Reembolso
            </button>

            <button
              className="btn-primary"
              disabled={isCreatingLayaway}
              style={{
                flex: 1.2,
                padding: "5px 8px",
                background: "transparent",
                border: "1px solid #10b981",
                color: "#10b981",
                fontSize: "0.72rem",
                borderRadius: "6px",
                opacity: isCreatingLayaway ? 0.6 : 1,
                cursor: isCreatingLayaway ? "not-allowed" : "pointer",
              }}
              onClick={async () => {
                if (isCreatingLayaway) return;
                if (activeTicket.items.length === 0) return alert("El ticket está vacío.");
                if (!selectedCustomerId) return alert("❌ Debes seleccionar un cliente para hacer un Apartado (Layaway).");

                setIsCreatingLayaway(true);
                try {
                const minDownPayment = finalTotal * 0.1;
                const downPayment = parseFloat(window.prompt(`El total es $${finalTotal.toFixed(2)}.\n¿Cuánto dejará de enganche (Mínimo $${minDownPayment.toFixed(2)})?`) || "");
                if (isNaN(downPayment) || downPayment <= 0) return;
                if (downPayment > finalTotal) return alert("El enganche no puede ser mayor al total.");
                if (downPayment < minDownPayment) {
                  return alert(`❌ El enganche mínimo es $${minDownPayment.toFixed(2)} (10% del total).`);
                }

              // Validación de stock estricta, igual que en el cobro de contado/tarjeta.
              if (!isOffline) {
                const itemsExceedingStock = activeTicket.items.filter(item => {
                  if (item.price < 0) return false;
                  const invItem = globalCatalog.find(i => matchesProduct(item, i));
                  return !invItem || item.qty > invItem.stock;
                });

                if (itemsExceedingStock.length > 0) {
                  const itemNames = itemsExceedingStock.map(i => `• ${i.name} (Apartar: ${i.qty}, Stock: ${globalCatalog.find(cat => matchesProduct(i, cat))?.stock ?? 0})`).join("\n");

                  const pin = await getPinAsync(
                    "⚠️ STOCK INSUFICIENTE",
                    `Los siguientes artículos superan las existencias físicas en inventario:\n${itemNames}\n\nIngresa el PIN de Administrador para autorizar el apartado:`
                  );
                  if (!pin) return;

                  if (!(await verifyAdminPinRemote(pin))) {
                    return alert("❌ PIN incorrecto o sin privilegios de administrador. Apartado cancelado.");
                  }
                }
              }

              const makeLayaway = async () => {
                 const customer = customers.find(c => c.id === selectedCustomerId);
                 const { error } = await createLayaway({
                    customer_id: selectedCustomerId,
                    customer_name: customer?.name || "Desconocido",
                    total_amount: finalTotal,
                    down_payment: downPayment,
                    balance: finalTotal - downPayment,
                    due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
                    items: activeTicket.items,
                    discount_pct: activeTicket.discountPct,
                    apply_iva: applyIva,
                 });
                 if (error) return alert("Error al crear apartado: " + error.message);

                  // Reduce Inventory
                  try {
                     const { error: invStockErr } = await reduceInventoryStock(
                       activeTicket.items.map(item => {
                         const invItem = globalCatalog.find(i => matchesProduct(item, i));
                         return { id: invItem ? invItem.id : null, qty: item.qty };
                       }).filter((item): item is { id: string; qty: number } => item.id !== null),
                       "layaway",
                       `LAY-${Date.now()}`,
                     );
                     if (invStockErr) {
                       console.warn("Falla al ajustar inventario en apartado:", invStockErr.message);
                       toast.error(`⚠️ El apartado se creó, pero el inventario no se pudo ajustar: ${invStockErr.message}. Revisa el stock manualmente.`, { duration: 8000 });
                     }
                  } catch (invErr) {
                     console.error("Error crítico al actualizar inventario en layaway:", invErr);
                     toast.error(
                       "⚠️ El apartado se creó, pero el inventario NO se pudo actualizar. Revisa y ajusta el stock manualmente.",
                       { duration: 8000 },
                     );
                  }

                 // Update local state globalCatalog
                 setGlobalCatalog(prevCatalog =>
                    prevCatalog.map(invItem => {
                       const soldItem = activeTicket.items.find(item => matchesProduct(item, invItem));
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
                      downPayment,
                      discountPct: activeTicket.discountPct || 0,
                      applyIva: applyIva
                    }
                  });

                 alert(`✅ Apartado creado con éxito. Enganche de $${downPayment.toFixed(2)} registrado.\nTiene 30 días para liquidar el saldo de $${(finalTotal - downPayment).toFixed(2)}.`);
                 setSelectedCustomerId("");
                 setTickets(tickets.map(t => t.id === activeTicketId ? { ...t, items: [], discountPct: 0 } : t));
              };
              await makeLayaway();
              } finally {
                setIsCreatingLayaway(false);
              }
            }}
          >
            📦 Sistema de Apartado (Layaway)
          </button>
        </div>
      </div>
    </div>
      
      {/* Printable Receipt Area */}
      <div 
        id="printable-receipt" 
        style={{ 
          padding: `${marginPadding}mm`, 
          fontFamily: "monospace", 
          width: (previewConfig.printer_paper_size || "80mm") === "58mm" ? "58mm" : "80mm",
          maxWidth: (previewConfig.printer_paper_size || "80mm") === "58mm" ? "58mm" : "80mm", 
          margin: "0",
          textAlign: marginAlign as any,
          boxSizing: "border-box",
          "--receipt-width": (previewConfig.printer_paper_size || "80mm") === "58mm" ? "58mm" : "80mm",
          "--receipt-margin-left": previewConfig.printer_margin_left ? `${previewConfig.printer_margin_left}mm` : "0mm",
          "--receipt-margin-right": previewConfig.printer_margin_right ? `${previewConfig.printer_margin_right}mm` : "0mm",
          "--receipt-margin-top": previewConfig.printer_margin_top ? `${previewConfig.printer_margin_top}mm` : "0mm",
          "--receipt-margin-bottom": previewConfig.printer_margin_bottom ? `${previewConfig.printer_margin_bottom}mm` : "0mm",
          "--receipt-zoom": previewConfig.printer_zoom ? `scale(${parseFloat(previewConfig.printer_zoom) / 100})` : "scale(1)"
        } as any}
      >
        {printIsCancelled && (
          <div style={{ textAlign: "center", fontWeight: "bold", border: "2px solid #ef4444", color: "#ef4444", padding: "8px", marginBottom: "12px", fontSize: "14px" }}>
            🚫 TICKET CANCELADO
            <div style={{ fontWeight: "normal", fontSize: "11px" }}>No válido como comprobante de venta</div>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", alignItems: marginAlign === "center" ? "center" : "flex-start", borderBottom: "1px dashed #000", paddingBottom: "10px", marginBottom: "15px", textAlign: marginAlign as any }}>
          {showPreviewLogo && <img src={businessProfile.logo} alt="Logo" style={{ maxHeight: "60px", marginBottom: "10px" }} />}
          {showPreviewName && <h2 style={{ margin: "5px 0", fontSize: "18px", fontWeight: "bold" }}>{businessProfile.name}</h2>}
          {showPreviewRfc && <p style={{ margin: "2px 0", fontSize: "12px" }}>RFC: {businessProfile.rfc}</p>}
          {showPreviewPhone && <p style={{ margin: "2px 0", fontSize: "12px" }}>Tel: {businessProfile.phone}</p>}
          {showPreviewAddress && <p style={{ margin: "2px 0", fontSize: "12px", whiteSpace: "pre-line" }}>{businessProfile.address}</p>}
          {showPreviewEmail && <p style={{ margin: "2px 0", fontSize: "12px" }}>Email: {businessProfile.email}</p>}
        </div>
        
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px", fontSize: "14px", textAlign: "left" }}>
          <div>
            <h3 style={{ margin: 0, fontWeight: "bold", fontSize: "16px" }}>{printTitle}</h3>
            {printTicketId && <p style={{ margin: "2px 0", fontWeight: "bold" }}>Ticket: #{printTicketId}</p>}
            {printPaymentMethod === PAYMENT_METHOD_CREDITO && (
              <p style={{ margin: "2px 0", fontWeight: "bold", color: "#b91c1c" }}>*** VENTA A CRÉDITO ***</p>
            )}
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

        {showPreviewCustomer && printCustomerName && (
          <div style={{ marginBottom: "15px", padding: "8px", background: "#f3f4f6", borderRadius: "4px", fontSize: "12px", border: "1px solid #e5e7eb", textAlign: "left" }}>
            <strong>Cliente:</strong> {printCustomerName}
          </div>
        )}

        {showPreviewNotes && printNotes && (
          <div style={{ marginBottom: "10px", padding: "8px", background: "#f3f4f6", borderRadius: "4px", fontSize: "11px", border: "1px solid #e5e7eb", color: "#000", textAlign: "left" }}>
            <strong>Nota:</strong> {printNotes}
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
             {printDiscountPct < 0 && (
               <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px", color: "orange" }}>
                 <span>Aum ({Math.abs(printDiscountPct)}%):</span>
                 <span>+${Math.round(-printDiscountAmount)}</span>
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
        items={activeTicket.items}
        globalCatalog={globalCatalog}
        currentUserName={currentUser?.name}
        discountPct={activeTicket.discountPct || 0}
        applyIva={applyIva}
        saveTicketToQuotes={saveTicketToQuotes}
        onInventoryReduced={() => {
          setGlobalCatalog(prevCatalog =>
            prevCatalog.map(invItem => {
              const soldItem = activeTicket.items.find(item => matchesProduct(item, invItem));
              if (soldItem) {
                return { ...invItem, stock: invItem.stock - soldItem.qty };
              }
              return invItem;
            })
          );
        }}
        onSuccess={(customer, realTicketId, quoteUuid) => {
          // Antes una venta a crédito nunca disparaba ninguna impresión
          // (ni siquiera el primer ticket) — PosCreditModal solo cerraba
          // el modal. "Doble copia para Apartados y Crédito" nunca podía
          // funcionar en crédito porque este triggerPrint no existía.
          //
          // realTicketId ahora es el id REAL guardado en quotes (vía
          // saveTicketToQuotes, llamado dentro de PosCreditModal antes de
          // cobrar) -- antes se usaba activeTicketId (el id interno de la
          // pestaña del carrito, casi siempre "1"), que no correspondía a
          // ningún ticket real ni aparecía en "Consulta de Tickets
          // Anteriores".
          try {
            triggerPrint({
              type: "ticket",
              data: {
                realTicketId,
                quoteUuid,
                invoiceToken,
                items: [...activeTicket.items],
                finalTotal,
                paymentMethod: PAYMENT_METHOD_CREDITO,
                discountPct: activeTicket.discountPct || 0,
                applyIva: applyIva,
                customerName: customer?.name || "",
              },
            });
          } catch (printErr) {
            console.error("Error al disparar la impresión de venta a crédito:", printErr);
          }
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
            zIndex: Z_INDEX.MODAL,
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
            
            <div style={{ background: "rgba(255,255,255,0.05)", padding: "14px 18px", borderRadius: "10px", marginBottom: "18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", opacity: 0.85, marginBottom: "4px" }}>
                <span>Subtotal:</span>
                <span style={{ fontWeight: "bold" }}>${formatPrice(subtotal)}</span>
              </div>
              {activeTicket.discountPct > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", color: "#10b981", fontWeight: "bold", marginBottom: "4px" }}>
                  <span>🏷️ Descuento (-{activeTicket.discountPct}%):</span>
                  <span>-${formatPrice(discountAmount)}</span>
                </div>
              )}
              {activeTicket.discountPct < 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", color: "#f59e0b", fontWeight: "bold", marginBottom: "4px" }}>
                  <span>📈 Aumento (+{Math.abs(activeTicket.discountPct)}%):</span>
                  <span>+${formatPrice(-discountAmount)}</span>
                </div>
              )}
              {applyIva && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", color: "#3b82f6", marginBottom: "4px" }}>
                  <span>IVA (16%):</span>
                  <span>+${formatPrice(iva)}</span>
                </div>
              )}
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "8px", marginTop: "6px", textAlign: "center" }}>
                <span style={{ fontSize: "0.82rem", opacity: 0.7, letterSpacing: "1px" }}>TOTAL A COBRAR</span>
                <h1 style={{ color: "var(--color-secondary)", margin: "4px 0 0 0", fontSize: "2.3rem", fontWeight: "bold" }}>
                  ${formatPrice(finalTotal)}
                </h1>
              </div>
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

                // Antes solo se mostraba un aviso visual "Faltan: $X" para
                // efectivo, pero el botón seguía habilitado y el cobro se
                // registraba igual con un monto recibido menor al total.
                if (paymentMethod === "efectivo" && cash < finalTotal - 0.01) {
                  return alert(
                    `❌ El efectivo recibido ($${cash.toFixed(2)}) no cubre el total de la venta ($${finalTotal.toFixed(2)}). Faltan $${(finalTotal - cash).toFixed(2)}.`,
                  );
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
                  onClick={() => handleReconnectPrinter("bluetooth")}
                  className="btn-primary"
                  style={{ background: "rgba(59, 130, 246, 0.2)", border: "1px solid var(--color-primary)", color: "white" }}
                >
                  🛜 Conectar vía Bluetooth Directo (Web BLE)
                </button>

                <button
                  onClick={() => handleReconnectPrinter("system")}
                  className="btn-primary"
                  style={{ background: "rgba(16, 185, 129, 0.2)", border: "1px solid var(--color-secondary)", color: "white" }}
                >
                  🖥️ Impresora del Sistema (Navegador)
                </button>
                <p style={{ fontSize: "0.75rem", opacity: 0.7, color: "#93c5fd", marginTop: "-5px", textAlign: "center" }}>
                  💡 Soporta cualquier impresora (USB, Bluetooth, WiFi o Red) agregada en Windows.
                </p>
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

      {PinModal}

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
          zIndex: Z_INDEX.MODAL,
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
          zIndex: Z_INDEX.MODAL,
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
          zIndex: Z_INDEX.MODAL,
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
                          <ReprintButton ticket={ticket} onReprint={handleReprintHistoryTicket} variant="pill-outline" />
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

      {showTicketsHistoryModal && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.8)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: Z_INDEX.MODAL_LARGE,
          backdropFilter: "blur(6px)"
        }}>
          <div className="glass-panel animate-fade-in" style={{
            padding: "18px 22px",
            width: "960px",
            maxWidth: "96%",
            maxHeight: "85vh",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            background: "rgba(20, 20, 32, 0.98)",
            border: "1px solid var(--glass-border)",
            boxShadow: "0 25px 60px rgba(0,0,0,0.7)",
            borderRadius: "16px"
          }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "12px" }}>
              <div>
                <h3 style={{ color: "var(--color-primary)", margin: 0, fontSize: "1.25rem", display: "flex", alignItems: "center", gap: "8px" }}>
                  🎟️ Consulta de Tickets Anteriores
                </h3>
                <span style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.5)" }}>
                  Historial de ventas realizadas (Modo consulta / reimpresión)
                </span>
              </div>
              <button
                onClick={() => setShowTicketsHistoryModal(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#ef4444",
                  fontSize: "1.3rem",
                  cursor: "pointer"
                }}
              >
                ✕
              </button>
            </div>

            {/* Buscador y Filtros */}
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: "220px", position: "relative" }}>
                <input
                  type="text"
                  value={ticketSearchQuery}
                  onChange={(e) => setTicketSearchQuery(e.target.value)}
                  placeholder="🔍 Buscar por Nº Ticket, Artículo, Producto o Cliente..."
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    background: "rgba(0,0,0,0.35)",
                    border: "1px solid var(--color-primary)",
                    color: "white",
                    fontSize: "0.85rem"
                  }}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.7)" }}>📅 Fecha:</span>
                <input
                  type="date"
                  value={ticketDateFilter}
                  onChange={(e) => setTicketDateFilter(e.target.value)}
                  style={{
                    padding: "8px 10px",
                    borderRadius: "8px",
                    background: "rgba(0,0,0,0.35)",
                    border: "1px solid var(--glass-border)",
                    color: "white",
                    fontSize: "0.85rem"
                  }}
                />
              </div>

              {(ticketSearchQuery || ticketDateFilter) && (
                <button
                  type="button"
                  onClick={() => {
                    setTicketSearchQuery("");
                    setTicketDateFilter("");
                  }}
                  className="btn-primary"
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    padding: "8px 12px",
                    fontSize: "0.8rem"
                  }}
                >
                  🔄 Ver Últimas 5
                </button>
              )}

              <button
                type="button"
                onClick={fetchTicketsHistory}
                className="btn-primary"
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-secondary)",
                  color: "var(--color-secondary)",
                  padding: "8px 12px",
                  fontSize: "0.8rem"
                }}
              >
                {isLoadingTicketsHistory ? "⏳ Cargando..." : "🔄 Actualizar"}
              </button>
            </div>

            {/* Contenido en dos columnas: Lista izquierda | Detalle derecha */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1.2fr",
              gap: "16px",
              flex: 1,
              minHeight: 0,
              maxHeight: "55vh",
              overflow: "hidden"
            }}>
              {/* Columna Izquierda: Lista de Tickets */}
              <div style={{
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                paddingRight: "6px"
              }}>
                <div style={{ fontSize: "0.8rem", color: "var(--color-secondary)", fontWeight: "bold" }}>
                  {ticketSearchQuery === "" && ticketDateFilter === "" 
                    ? "🕒 Últimas 5 Ventas Realizadas:" 
                    : "📋 Resultados de la Búsqueda:"}
                </div>

                {isLoadingTicketsHistory ? (
                  <div style={{ textAlign: "center", padding: "30px", opacity: 0.6 }}>
                    Cargando ventas...
                  </div>
                ) : (() => {
                  const filtered = ticketsHistoryList.filter((ticket) => {
                    let itemsArr: any[] = [];
                    if (typeof ticket.items === "string") {
                      try { itemsArr = JSON.parse(ticket.items); } catch { itemsArr = []; }
                    } else if (Array.isArray(ticket.items)) {
                      itemsArr = ticket.items;
                    }

                    if (ticketDateFilter) {
                      const ticketDate = ticket.created_at ? new Date(ticket.created_at).toISOString().split("T")[0] : "";
                      if (ticketDate !== ticketDateFilter) return false;
                    }

                    if (ticketSearchQuery.trim()) {
                      const q = ticketSearchQuery.trim().toLowerCase();
                      const matchId = ticket.id ? ticket.id.toString().includes(q) : false;
                      // quote_number es el folio real y buscable (ver "Ver
                      // Ticket Original" en Cuentas por Cobrar) -- match
                      // exacto, no substring, para no confundir el folio
                      // #1 con el #100 solo por compartir dígitos.
                      const matchQuoteNumber = ticket.quote_number != null && ticket.quote_number.toString() === q;
                      const matchCustomer = ticket.customer_name ? ticket.customer_name.toLowerCase().includes(q) : false;
                      const matchNotes = ticket.notes ? ticket.notes.toLowerCase().includes(q) : false;
                      const matchArticle = itemsArr.some((it: any) =>
                        (it.name && it.name.toLowerCase().includes(q)) ||
                        (it.code && it.code.toLowerCase().includes(q))
                      );
                      return matchId || matchQuoteNumber || matchCustomer || matchNotes || matchArticle;
                    }

                    return true;
                  });

                  const displayed = (ticketSearchQuery.trim() === "" && ticketDateFilter === "")
                    ? filtered.slice(0, 5)
                    : filtered;

                  if (displayed.length === 0) {
                    return (
                      <div style={{ textAlign: "center", padding: "30px", opacity: 0.6, border: "1px dashed rgba(255,255,255,0.1)", borderRadius: "8px" }}>
                        No se encontraron tickets con los filtros seleccionados.
                      </div>
                    );
                  }

                  return displayed.map((ticket) => {
                    const isSelected = selectedHistoryTicket?.id === ticket.id;
                    let itemsArr: any[] = [];
                    if (typeof ticket.items === "string") {
                      try { itemsArr = JSON.parse(ticket.items); } catch { itemsArr = []; }
                    } else if (Array.isArray(ticket.items)) {
                      itemsArr = ticket.items;
                    }

                    return (
                      <div
                        key={ticket.id}
                        onClick={() => setSelectedHistoryTicket(ticket)}
                        style={{
                          padding: "10px 12px",
                          borderRadius: "10px",
                          background: isSelected ? "rgba(244, 63, 94, 0.12)" : "rgba(255,255,255,0.03)",
                          border: isSelected ? "1.5px solid var(--color-primary)" : "1px solid rgba(255,255,255,0.08)",
                          cursor: "pointer",
                          transition: "all 0.2s ease",
                          display: "flex",
                          flexDirection: "column",
                          gap: "5px"
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: "bold", color: "white", fontSize: "0.88rem" }} title={`Ticket #${ticket.id}`}>
                            Ticket #{formatTicketFolio(ticket.id)}
                          </span>
                          <span style={{ fontWeight: "bold", color: "var(--color-secondary)", fontSize: "0.95rem" }}>
                            ${Number(ticket.total || 0).toFixed(2)}
                          </span>
                        </div>

                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "rgba(255,255,255,0.6)" }}>
                          <span>📅 {new Date(ticket.created_at).toLocaleDateString()} {new Date(ticket.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          <span>📦 {itemsArr.length} art.</span>
                        </div>

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.72rem", marginTop: "2px" }}>
                          <span style={{ color: "rgba(255,255,255,0.7)", maxWidth: "130px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={ticket.customer_name || "Venta Mostrador"}>
                            👤 {ticket.customer_name || "Venta Mostrador"}
                          </span>
                          <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0 }}>
                            <ReprintButton ticket={ticket} onReprint={handleReprintHistoryTicket} variant="row" stopPropagation />
                            <span style={{ color: "var(--color-primary)", fontWeight: "600", fontSize: "0.72rem" }}>
                              {isSelected ? "▶ Activo" : "Ver"}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>

              {/* Columna Derecha: Detalle del Ticket & Botón Reimprimir */}
              <div style={{
                background: "rgba(0,0,0,0.25)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "12px",
                padding: "12px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                overflowY: "auto"
              }}>
                {selectedHistoryTicket ? (() => {
                  let ticketItems: any[] = [];
                  if (typeof selectedHistoryTicket.items === "string") {
                    try { ticketItems = JSON.parse(selectedHistoryTicket.items); } catch { ticketItems = []; }
                  } else if (Array.isArray(selectedHistoryTicket.items)) {
                    ticketItems = selectedHistoryTicket.items;
                  }

                  const displayTicketFolio = formatTicketFolio(selectedHistoryTicket.id);

                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", height: "100%" }}>
                      <div>
                        {/* El botón de reimprimir para este mismo ticket ya
                            está destacado abajo, junto al total -- antes
                            había uno también aquí arriba, duplicado (mismo
                            handleReprintHistoryTicket), y el cajero veía dos
                            botones idénticos para una sola acción (reporte
                            de Ferretería Erika, 2026-08-26). */}
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px", minWidth: 0 }}>
                          <h4 style={{ margin: 0, color: "white", fontSize: "1rem", whiteSpace: "nowrap" }} title={`Ticket #${selectedHistoryTicket.id}`}>
                            Ticket #{displayTicketFolio}
                          </h4>
                          <span style={{
                            background: selectedHistoryTicket.status === "cancelled" ? "rgba(239, 68, 68, 0.2)" : "rgba(16, 185, 129, 0.15)",
                            color: selectedHistoryTicket.status === "cancelled" ? "#ef4444" : "var(--color-secondary)",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "0.72rem",
                            fontWeight: "bold",
                            whiteSpace: "nowrap"
                          }}>
                            {selectedHistoryTicket.status === "cancelled" ? "🚫 Cancelado" : (selectedHistoryTicket.status || "Venta")}
                          </span>
                        </div>
                        <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.6)", display: "flex", gap: "10px", flexWrap: "wrap" }}>
                          <span>📅 {new Date(selectedHistoryTicket.created_at).toLocaleString()}</span>
                          <span>👤 {selectedHistoryTicket.customer_name || "Venta Mostrador"}</span>
                          {selectedHistoryTicket.notes && <span>💳 {selectedHistoryTicket.notes}</span>}
                        </div>
                      </div>

                      {/* Tabla de Artículos (Solo Lectura) */}
                      <div style={{ flex: 1, overflowY: "auto", maxHeight: "130px", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "8px" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem" }}>
                          <thead>
                            <tr style={{ background: "rgba(255,255,255,0.06)", textAlign: "left", color: "rgba(255,255,255,0.7)" }}>
                              <th style={{ padding: "4px 6px" }}>Cant</th>
                              <th style={{ padding: "4px 6px" }}>Artículo</th>
                              <th style={{ padding: "4px 6px", textAlign: "right" }}>P. Unit</th>
                              <th style={{ padding: "4px 6px", textAlign: "right" }}>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ticketItems.map((item: any, idx: number) => {
                              const qty = Number(item.qty || 1);
                              const price = Number(item.price || 0);
                              return (
                                <tr key={idx} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                                  <td style={{ padding: "4px 6px", color: "var(--color-secondary)", fontWeight: "bold" }}>{qty}</td>
                                  <td style={{ padding: "4px 6px" }}>{item.name}</td>
                                  <td style={{ padding: "4px 6px", textAlign: "right" }}>${price.toFixed(2)}</td>
                                  <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: "bold" }}>${(qty * price).toFixed(2)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Resumen Total */}
                      <div style={{
                        background: "rgba(255,255,255,0.03)",
                        padding: "6px 10px",
                        borderRadius: "6px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center"
                      }}>
                        <span style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.8)" }}>Total Cobrado:</span>
                        <span style={{ fontSize: "1.15rem", fontWeight: "bold", color: "var(--color-secondary)" }}>
                          ${Number(selectedHistoryTicket.total || 0).toFixed(2)}
                        </span>
                      </div>

                      {/* Botón Reimprimir Destacado Inferior */}
                      <ReprintButton
                        ticket={selectedHistoryTicket}
                        folio={displayTicketFolio}
                        onReprint={handleReprintHistoryTicket}
                        variant="featured"
                      />
                    </div>
                  );
                })() : (
                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                    color: "rgba(255,255,255,0.4)",
                    textAlign: "center",
                    gap: "10px",
                    padding: "30px"
                  }}>
                    <span style={{ fontSize: "2.5rem" }}>🎟️</span>
                    <p style={{ fontSize: "0.85rem", margin: 0 }}>
                      Selecciona un ticket de la lista para ver su desglose de artículos y reimprimirlo.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "12px" }}>
              <button
                type="button"
                className="btn-primary"
                style={{
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid var(--glass-border)",
                  padding: "8px 18px",
                  fontSize: "0.85rem"
                }}
                onClick={() => setShowTicketsHistoryModal(false)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🚫 MODAL DE CANCELACIÓN DE TICKETS (Requiere Clave de Administrador) */}
      {showCancelTicketModal && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.85)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: Z_INDEX.MODAL_LARGE,
          backdropFilter: "blur(8px)"
        }}>
          <div className="glass-panel animate-fade-in" style={{
            padding: "20px 24px",
            width: "980px",
            maxWidth: "96%",
            maxHeight: "88vh",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            background: "rgba(22, 18, 24, 0.98)",
            border: "1px solid rgba(239, 68, 68, 0.35)",
            boxShadow: "0 25px 60px rgba(239, 68, 68, 0.15)",
            borderRadius: "16px"
          }}>
            {/* Header Modal */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "1.6rem" }}>🚫</span>
                <div>
                  <h3 style={{ color: "#ef4444", margin: 0, fontSize: "1.25rem", display: "flex", alignItems: "center", gap: "8px" }}>
                    Cancelación de Tickets y Ventas
                  </h3>
                  <span style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.6)" }}>
                    🔒 Requiere clave de Administrador • Folios alfanuméricos de 6 caracteres (ej. 8B-2K*9M)
                  </span>
                </div>
              </div>

              <button
                onClick={() => setShowCancelTicketModal(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#ef4444",
                  fontSize: "1.4rem",
                  cursor: "pointer"
                }}
              >
                ✕
              </button>
            </div>

            {/* Barra de Búsqueda de Ticket para Cancelar */}
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: "240px", position: "relative" }}>
                <input
                  type="text"
                  value={cancelTicketSearchQuery}
                  onChange={(e) => setCancelTicketSearchQuery(e.target.value)}
                  placeholder="🔍 Buscar por Folio (ej. 8B-2K*9M), Cliente o Producto..."
                  style={{
                    width: "100%",
                    padding: "9px 14px",
                    borderRadius: "8px",
                    background: "rgba(0,0,0,0.4)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    color: "white",
                    fontSize: "0.85rem",
                    outline: "none"
                  }}
                  autoFocus
                />
              </div>

              {cancelTicketSearchQuery && (
                <button
                  type="button"
                  onClick={() => setCancelTicketSearchQuery("")}
                  className="btn-primary"
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    padding: "8px 12px",
                    fontSize: "0.8rem"
                  }}
                >
                  🔄 Ver Últimos 7
                </button>
              )}

              <button
                type="button"
                onClick={openCancelTicketModal}
                className="btn-primary"
                style={{
                  background: "transparent",
                  border: "1px solid #ef4444",
                  color: "#ef4444",
                  padding: "8px 12px",
                  fontSize: "0.8rem",
                  fontWeight: "bold"
                }}
              >
                {isLoadingCancelTickets ? "⏳ Cargando..." : "🔄 Actualizar"}
              </button>
            </div>

            {/* Contenido en dos columnas: Lista izquierda (7 últimos o búsqueda) | Detalle y Acción derecha */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "1.1fr 1.2fr",
              gap: "16px",
              flex: 1,
              minHeight: 0,
              maxHeight: "56vh",
              overflow: "hidden"
            }}>
              {/* Columna Izquierda: Lista de Tickets */}
              <div style={{
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                paddingRight: "6px"
              }}>
                <div style={{ fontSize: "0.8rem", color: "#ef4444", fontWeight: "bold" }}>
                  {cancelTicketSearchQuery.trim() === "" 
                    ? "⏱️ Últimos 7 Tickets Impresos:" 
                    : "📋 Resultados de Búsqueda de Tickets:"}
                </div>

                {isLoadingCancelTickets ? (
                  <div style={{ textAlign: "center", padding: "30px", opacity: 0.6 }}>
                    Cargando tickets...
                  </div>
                ) : (() => {
                  const filtered = cancelTicketsList.filter((ticket) => {
                    let itemsArr: any[] = [];
                    if (typeof ticket.items === "string") {
                      try { itemsArr = JSON.parse(ticket.items); } catch { itemsArr = []; }
                    } else if (Array.isArray(ticket.items)) {
                      itemsArr = ticket.items;
                    }

                    if (cancelTicketSearchQuery.trim()) {
                      const q = cancelTicketSearchQuery.trim().toLowerCase();
                      const folio = formatTicketFolio(ticket.id).toLowerCase();
                      const rawId = String(ticket.id || "").toLowerCase();
                      const matchCustomer = ticket.customer_name ? ticket.customer_name.toLowerCase().includes(q) : false;
                      const matchNotes = ticket.notes ? ticket.notes.toLowerCase().includes(q) : false;
                      const matchArticle = itemsArr.some((it: any) => 
                        (it.name && it.name.toLowerCase().includes(q)) || 
                        (it.code && it.code.toLowerCase().includes(q))
                      );
                      return folio.includes(q) || rawId.includes(q) || matchCustomer || matchNotes || matchArticle;
                    }

                    return true;
                  });

                  // Por defecto muestra los últimos 7 tickets impresos
                  const displayed = cancelTicketSearchQuery.trim() === ""
                    ? filtered.slice(0, 7)
                    : filtered;

                  if (displayed.length === 0) {
                    return (
                      <div style={{ textAlign: "center", padding: "30px", opacity: 0.6, border: "1px dashed rgba(255,255,255,0.1)", borderRadius: "8px" }}>
                        No se encontraron tickets con el folio o criterio buscado.
                      </div>
                    );
                  }

                  return displayed.map((ticket) => {
                    const isSelected = selectedCancelTicket?.id === ticket.id;
                    const isCancelled = ticket.status === "cancelled";
                    const folio = formatTicketFolio(ticket.id);

                    let itemsArr: any[] = [];
                    if (typeof ticket.items === "string") {
                      try { itemsArr = JSON.parse(ticket.items); } catch { itemsArr = []; }
                    } else if (Array.isArray(ticket.items)) {
                      itemsArr = ticket.items;
                    }

                    return (
                      <div
                        key={ticket.id}
                        onClick={() => setSelectedCancelTicket(ticket)}
                        style={{
                          padding: "10px 12px",
                          borderRadius: "10px",
                          background: isSelected ? "rgba(239, 68, 68, 0.15)" : "rgba(255,255,255,0.03)",
                          border: isSelected ? "1.5px solid #ef4444" : "1px solid rgba(255,255,255,0.08)",
                          cursor: "pointer",
                          transition: "all 0.2s ease",
                          display: "flex",
                          flexDirection: "column",
                          gap: "5px",
                          opacity: isCancelled ? 0.75 : 1
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontWeight: "bold", color: "white", fontSize: "0.92rem", letterSpacing: "0.5px" }}>
                              Ticket #{folio}
                            </span>
                            {isCancelled ? (
                              <span style={{ background: "rgba(239, 68, 68, 0.25)", color: "#ef4444", border: "1px solid #ef4444", fontSize: "0.68rem", fontWeight: "bold", padding: "1px 5px", borderRadius: "4px" }}>
                                🚫 Cancelado
                              </span>
                            ) : (
                              <span style={{ background: "rgba(16, 185, 129, 0.15)", color: "#10b981", fontSize: "0.68rem", fontWeight: "bold", padding: "1px 5px", borderRadius: "4px" }}>
                                ✓ Válido
                              </span>
                            )}
                          </div>
                          <span style={{ fontWeight: "bold", color: isCancelled ? "rgba(255,255,255,0.5)" : "var(--color-secondary)", fontSize: "0.95rem" }}>
                            ${Number(ticket.total || 0).toFixed(2)}
                          </span>
                        </div>

                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "rgba(255,255,255,0.6)" }}>
                          <span>📅 {new Date(ticket.created_at).toLocaleDateString()} {new Date(ticket.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          <span>📦 {itemsArr.length} artículo(s)</span>
                        </div>

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.72rem", marginTop: "2px" }}>
                          <span style={{ color: "rgba(255,255,255,0.7)", maxWidth: "150px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            👤 {ticket.customer_name || "Venta Mostrador"}
                          </span>

                          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                            {!isCancelled ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleExecuteCancelTicket(ticket);
                                }}
                                disabled={isCancellingTicket}
                                className="btn-primary"
                                style={{
                                  padding: "3px 8px",
                                  fontSize: "0.72rem",
                                  background: "rgba(239, 68, 68, 0.2)",
                                  border: "1px solid #ef4444",
                                  color: "#ef4444",
                                  borderRadius: "4px",
                                  fontWeight: "bold",
                                  cursor: "pointer"
                                }}
                              >
                                🚫 Cancelar
                              </button>
                            ) : (
                              <span style={{ color: "#ef4444", fontSize: "0.7rem", fontWeight: "bold" }}>Anulado</span>
                            )}
                            <span style={{ color: "var(--color-primary)", fontWeight: "600", fontSize: "0.72rem" }}>
                              {isSelected ? "▶ Activo" : "Ver"}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>

              {/* Columna Derecha: Detalle del Ticket & Confirmación de Cancelación */}
              <div style={{
                background: "rgba(0,0,0,0.3)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "12px",
                padding: "14px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                overflowY: "auto"
              }}>
                {selectedCancelTicket ? (() => {
                  let ticketItems: any[] = [];
                  if (typeof selectedCancelTicket.items === "string") {
                    try { ticketItems = JSON.parse(selectedCancelTicket.items); } catch { ticketItems = []; }
                  } else if (Array.isArray(selectedCancelTicket.items)) {
                    ticketItems = selectedCancelTicket.items;
                  }

                  const displayFolio = formatTicketFolio(selectedCancelTicket.id);
                  const isCancelled = selectedCancelTicket.status === "cancelled";

                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px", height: "100%" }}>
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                          <h4 style={{ margin: 0, color: "white", fontSize: "1.05rem", display: "flex", alignItems: "center", gap: "6px" }}>
                            <span>Ticket #{displayFolio}</span>
                          </h4>
                          <span style={{
                            background: isCancelled ? "rgba(239, 68, 68, 0.25)" : "rgba(16, 185, 129, 0.15)",
                            color: isCancelled ? "#ef4444" : "#10b981",
                            border: isCancelled ? "1px solid #ef4444" : "1px solid #10b981",
                            padding: "2px 8px",
                            borderRadius: "4px",
                            fontSize: "0.74rem",
                            fontWeight: "bold"
                          }}>
                            {isCancelled ? "🚫 CANCELADO" : "✓ VENTA VIGENTE"}
                          </span>
                        </div>

                        <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.6)", display: "flex", gap: "12px", flexWrap: "wrap" }}>
                          <span>📅 {new Date(selectedCancelTicket.created_at).toLocaleString()}</span>
                          <span>👤 {selectedCancelTicket.customer_name || "Venta Mostrador"}</span>
                          {selectedCancelTicket.notes && <span>💳 {selectedCancelTicket.notes}</span>}
                        </div>
                      </div>

                      {/* Desglose de Artículos */}
                      <div style={{ flex: 1, overflowY: "auto", maxHeight: "140px", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem" }}>
                          <thead>
                            <tr style={{ background: "rgba(255,255,255,0.06)", textAlign: "left", color: "rgba(255,255,255,0.7)" }}>
                              <th style={{ padding: "5px 8px" }}>Cant</th>
                              <th style={{ padding: "5px 8px" }}>Artículo</th>
                              <th style={{ padding: "5px 8px", textAlign: "right" }}>P. Unit</th>
                              <th style={{ padding: "5px 8px", textAlign: "right" }}>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ticketItems.map((item: any, idx: number) => {
                              const qty = Number(item.qty || 1);
                              const price = Number(item.price || 0);
                              return (
                                <tr key={idx} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                                  <td style={{ padding: "5px 8px", color: "var(--color-secondary)", fontWeight: "bold" }}>{qty}</td>
                                  <td style={{ padding: "5px 8px" }}>{item.name}</td>
                                  <td style={{ padding: "5px 8px", textAlign: "right" }}>${price.toFixed(2)}</td>
                                  <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: "bold" }}>${(qty * price).toFixed(2)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Resumen Total */}
                      <div style={{
                        background: "rgba(255,255,255,0.03)",
                        padding: "8px 12px",
                        borderRadius: "8px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center"
                      }}>
                        <span style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.8)" }}>Monto Total del Ticket:</span>
                        <span style={{ fontSize: "1.2rem", fontWeight: "bold", color: isCancelled ? "rgba(255,255,255,0.5)" : "var(--color-secondary)" }}>
                          ${Number(selectedCancelTicket.total || 0).toFixed(2)}
                        </span>
                      </div>

                      {/* Botón de Acción de Cancelación */}
                      {isCancelled ? (
                        <div style={{
                          background: "rgba(239, 68, 68, 0.12)",
                          border: "1px solid #ef4444",
                          color: "#ef4444",
                          padding: "10px",
                          borderRadius: "8px",
                          textAlign: "center",
                          fontSize: "0.82rem",
                          fontWeight: "bold"
                        }}>
                          🚫 Este ticket ya fue anulado y procesado como cancelación.
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleExecuteCancelTicket(selectedCancelTicket)}
                          disabled={isCancellingTicket}
                          className="btn-primary"
                          style={{
                            width: "100%",
                            padding: "10px",
                            fontSize: "0.9rem",
                            fontWeight: "bold",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "8px",
                            background: "linear-gradient(135deg, #ef4444, #b91c1c)",
                            border: "none",
                            borderRadius: "8px",
                            cursor: isCancellingTicket ? "not-allowed" : "pointer",
                            boxShadow: "0 4px 14px rgba(239, 68, 68, 0.4)",
                            color: "white"
                          }}
                        >
                          {isCancellingTicket ? "⏳ Cancelando..." : `🚫 Cancelar Ticket #${displayFolio} (Pedir PIN Admin)`}
                        </button>
                      )}
                    </div>
                  );
                })() : (
                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                    color: "rgba(255,255,255,0.4)",
                    textAlign: "center",
                    gap: "10px",
                    padding: "30px"
                  }}>
                    <span style={{ fontSize: "2.5rem" }}>🚫</span>
                    <p style={{ fontSize: "0.85rem", margin: 0 }}>
                      Selecciona un ticket de la lista para ver sus detalles y autorizar su cancelación con clave de administrador.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "12px" }}>
              <button
                type="button"
                className="btn-primary"
                style={{
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid var(--glass-border)",
                  padding: "8px 18px",
                  fontSize: "0.85rem"
                }}
                onClick={() => setShowCancelTicketModal(false)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
