"use client";
import React, { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "./AuthProvider";
import { LoggerService } from "../services/loggerService";

export default function SettingsModule() {
  const { currentUser, businessSettings, updateBusinessSettings } = useAuth();

  const checkAdmin = () => {
    if (currentUser?.role !== "admin") {
      alert("❌ Acceso Denegado. Esta acción requiere privilegios de Administrador.");
      return false;
    }
    return true;
  };
  const [voiceKeyword, setVoiceKeyword] = useState("erika");
  const [earnRate, setEarnRate] = useState("100"); // Gasta $100
  const [earnPoints, setEarnPoints] = useState("1"); // Gana 1 punto
  const [redeemRate, setRedeemRate] = useState("10"); // 10 puntos = $1 de descuento
  const [theme, setTheme] = useState("dark");
  const [wholesaleMinQty, setWholesaleMinQty] = useState("10");
  const [wholesaleDiscount, setWholesaleDiscount] = useState("10");
  const [lowStockThreshold, setLowStockThreshold] = useState("5");
  const [maxCajeroDiscountPct, setMaxCajeroDiscountPct] = useState("5");

  const [targetUtility, setTargetUtility] = useState("30");
  const [monthlyGoals, setMonthlyGoals] = useState("0");

  // Print Config States
  const [printerName, setPrinterName] = useState("");
  const [printerPaperSize, setPrinterPaperSize] = useState("80mm");
  const [printerFontSize, setPrinterFontSize] = useState("normal");
  const [printerFontFamily, setPrinterFontFamily] = useState("monospace");
  const [printerFields, setPrinterFields] = useState<string[]>(["name", "rfc", "phone", "address", "logo", "footer"]);
  const [printerFooterMsg, setPrinterFooterMsg] = useState("¡Gracias por su compra!");
  const [printerAlign, setPrinterAlign] = useState("center");
  const [printerPadding, setPrinterPadding] = useState("8");
  const [printerMarginLeft, setPrinterMarginLeft] = useState("0");
  const [printerMarginRight, setPrinterMarginRight] = useState("0");
  const [printerMarginTop, setPrinterMarginTop] = useState("0");
  const [printerMarginBottom, setPrinterMarginBottom] = useState("0");
  const [printerZoom, setPrinterZoom] = useState("100");
  
  // Printer scan simulation states
  const [isScanning, setIsScanning] = useState(false);
  const [scannedPrinters, setScannedPrinters] = useState<string[]>([]);

  const [businessName, setBusinessName] = useState("Ferretería ERIKA");
  const [businessRfc, setBusinessRfc] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [businessLogo, setBusinessLogo] = useState("");

  interface UserItem {
    id: string;
    name: string;
    pin: string;
    role: string;
    permissions?: Record<string, boolean>;
  }

  const [systemUsers, setSystemUsers] = useState<UserItem[]>([]);
  const [newUserName, setNewUserName] = useState("");
  const [newUserPin, setNewUserPin] = useState("");
  const [roleType, setRoleType] = useState("cajero"); // "cajero", "admin", "custom"
  const [customRoleName, setCustomRoleName] = useState("");
  const [newPermissions, setNewPermissions] = useState<Record<string, boolean>>({
     pos: true,
     dashboard: false,
     caja: true,
     servicios: false,
     inventario: false,
     reportes: false,
     configuracion: false
  });

  // Estados de Edición de Usuario (Modal)
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editPin, setEditPin] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editPermissions, setEditPermissions] = useState<Record<string, boolean>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showNewUserPinText, setShowNewUserPinText] = useState(false);
  const [showEditUserPinText, setShowEditUserPinText] = useState(false);

  const [isConnected, setIsConnected] = useState<boolean>(true);
  const [connectionType, setConnectionType] = useState<string>("system");
  const [silentKiosk, setSilentKiosk] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("ERIKA_PRINTER_SILENT_KIOSK") === "true";
    }
    return false;
  });
  const [printerDoubleCopy, setPrinterDoubleCopy] = useState<boolean>(false);
  const [printerBleChunkSize, setPrinterBleChunkSize] = useState<number>(20);

  interface ErrorLogItem {
    id: string;
    module: string;
    error_details: string;
    usuario: string;
    created_at: string;
  }
  const [errorLogs, setErrorLogs] = useState<ErrorLogItem[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  // Recycle Bin (Papelera) States
  interface TrashItem {
    id: string;
    name: string;
    type: "producto" | "cliente" | "proveedor" | "servicio";
    deleted_at: string;
  }
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [isLoadingTrash, setIsLoadingTrash] = useState(false);

  const fetchTrash = async () => {
    setIsLoadingTrash(true);
    try {
      const { data: invData, error: invError } = await supabase.from("inventory").select("id, name, code, deleted_at").eq("deleted", true);
      if (invError) {
        console.error("Error al cargar papelera de inventario:", invError);
        LoggerService.logError("SettingsModule_fetchTrash_Inventory", invError);
      }

      const { data: custData, error: custError } = await supabase.from("customers").select("id, name, deleted_at").eq("deleted", true);
      if (custError) {
        console.error("Error al cargar papelera de clientes:", custError);
        LoggerService.logError("SettingsModule_fetchTrash_Customers", custError);
      }

      const { data: suppData, error: suppError } = await supabase.from("suppliers").select("id, name, deleted_at").eq("deleted", true);
      if (suppError) {
        console.error("Error al cargar papelera de proveedores:", suppError);
        LoggerService.logError("SettingsModule_fetchTrash_Suppliers", suppError);
      }

      const { data: servData, error: servError } = await supabase.from("services").select("id, customer_name, service_type, deleted_at").eq("deleted", true);
      if (servError) {
        console.error("Error al cargar papelera de servicios:", servError);
        LoggerService.logError("SettingsModule_fetchTrash_Services", servError);
      }

      const items: TrashItem[] = [];

      if (invData) {
        invData.forEach((i: any) => {
          items.push({
            id: i.id,
            name: i.code ? `[${i.code}] ${i.name}` : i.name,
            type: "producto",
            deleted_at: i.deleted_at || new Date().toISOString()
          });
        });
      }

      if (custData) {
        custData.forEach((c: any) => {
          items.push({
            id: c.id,
            name: c.name,
            type: "cliente",
            deleted_at: c.deleted_at || new Date().toISOString()
          });
        });
      }

      if (suppData) {
        suppData.forEach((s: any) => {
          items.push({
            id: s.id,
            name: s.name,
            type: "proveedor",
            deleted_at: s.deleted_at || new Date().toISOString()
          });
        });
      }

      if (servData) {
        servData.forEach((s: any) => {
          items.push({
            id: s.id,
            name: `Servicio: ${s.service_type} (${s.customer_name})`,
            type: "servicio",
            deleted_at: s.deleted_at || new Date().toISOString()
          });
        });
      }

      // Auto-purging logic (older than 33 days)
      const now = Date.now();
      const activeTrash: TrashItem[] = [];

      for (const item of items) {
        const deletedTime = new Date(item.deleted_at).getTime();
        const daysInTrash = (now - deletedTime) / (1000 * 60 * 60 * 24);

        if (daysInTrash > 33) {
          if (item.type === "producto") {
            await supabase.from("inventory").delete().eq("id", item.id);
          } else if (item.type === "cliente") {
            await supabase.from("customers").delete().eq("id", item.id);
          } else if (item.type === "proveedor") {
            await supabase.from("suppliers").delete().eq("id", item.id);
          } else if (item.type === "servicio") {
            await supabase.from("services").delete().eq("id", item.id);
          }
        } else {
          activeTrash.push(item);
        }
      }

      setTrashItems(activeTrash);
    } catch (e) {
      console.error("Error fetching trash:", e);
    } finally {
      setIsLoadingTrash(false);
    }
  };

  const handleRestoreTrash = async (item: TrashItem) => {
    if (!checkAdmin()) return;
    try {
      let error;
      if (item.type === "producto") {
        const { error: err } = await supabase.from("inventory").update({ deleted: false, deleted_at: null }).eq("id", item.id);
        error = err;
      } else if (item.type === "cliente") {
        const { error: err } = await supabase.from("customers").update({ deleted: false, deleted_at: null }).eq("id", item.id);
        error = err;
      } else if (item.type === "proveedor") {
        const { error: err } = await supabase.from("suppliers").update({ deleted: false, deleted_at: null }).eq("id", item.id);
        error = err;
      } else if (item.type === "servicio") {
        const { error: err } = await supabase.from("services").update({ deleted: false, deleted_at: null }).eq("id", item.id);
        error = err;
      }

      if (error) {
        alert("Error al restaurar: " + error.message);
      } else {
        // Log audit event
        await supabase.from("error_logs").insert({
          module: "RecycleBin",
          error_details: `Restaurado: ${item.type} "${item.name}" (ID: ${item.id})`,
          usuario: currentUser?.name || "Administrador"
        });
        alert(`✅ Restaurado exitosamente.`);
        fetchTrash();
        fetchErrorLogs();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleHardDeleteTrash = async (item: TrashItem) => {
    if (!checkAdmin()) return;
    if (!confirm(`⚠️ ¿Seguro que deseas eliminar definitivamente a "${item.name}"?\nEsta acción es irreversible.`)) return;

    try {
      let error;
      if (item.type === "producto") {
        const { error: err } = await supabase.from("inventory").delete().eq("id", item.id);
        error = err;
      } else if (item.type === "cliente") {
        const { error: err } = await supabase.from("customers").delete().eq("id", item.id);
        error = err;
      } else if (item.type === "proveedor") {
        const { error: err } = await supabase.from("suppliers").delete().eq("id", item.id);
        error = err;
      } else if (item.type === "servicio") {
        const { error: err } = await supabase.from("services").delete().eq("id", item.id);
        error = err;
      }

      if (error) {
        alert("Error al eliminar permanentemente: " + error.message);
      } else {
        // Log audit event
        await supabase.from("error_logs").insert({
          module: "RecycleBin",
          error_details: `Eliminado Definitivamente: ${item.type} "${item.name}" (ID: ${item.id})`,
          usuario: currentUser?.name || "Administrador"
        });
        alert("🚨 Eliminado definitivamente.");
        fetchTrash();
        fetchErrorLogs();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchErrorLogs = async () => {
    setIsLoadingLogs(true);
    try {
      const { data, error } = await supabase
        .from("error_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);
      
      if (data && !error) {
        setErrorLogs(data);
      }
    } catch (e) {
      console.error("Error fetching logs:", e);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (businessSettings) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setVoiceKeyword(businessSettings.config.voice_keyword);
      setEarnRate(String(businessSettings.config.earn_rate));
      setEarnPoints(String(businessSettings.config.earn_points));
      setRedeemRate(String(businessSettings.config.redeem_rate));
      setTheme(businessSettings.config.theme);
      setWholesaleMinQty(String(businessSettings.config.wholesale_min_qty));
      setWholesaleDiscount(String(businessSettings.config.wholesale_discount));
      setTargetUtility(String(businessSettings.target_utility));
      setMonthlyGoals(String(businessSettings.monthly_goals));
      setBusinessName(businessSettings.config.business_name);
      setBusinessRfc(businessSettings.config.business_rfc);
      setBusinessPhone(businessSettings.config.business_phone);
      setBusinessEmail(businessSettings.config.business_email);
      setBusinessAddress(businessSettings.config.business_address);
      setBusinessLogo(businessSettings.config.business_logo);
      setIsConnected(businessSettings.config.printer_connected);
      setConnectionType(businessSettings.config.printer_type);
      setPrinterName(businessSettings.config.printer_name || "");
      setPrinterPaperSize(businessSettings.config.printer_paper_size || "80mm");
      setPrinterFontSize(businessSettings.config.printer_font_size || "normal");
      setPrinterFontFamily(businessSettings.config.printer_font_family || "monospace");
      setPrinterFields(businessSettings.config.printer_fields || ["name", "rfc", "phone", "address", "logo", "footer"]);
      setPrinterFooterMsg(businessSettings.config.printer_footer_msg || "¡Gracias por su compra!");
      setPrinterAlign(businessSettings.config.printer_align || "center");
      setPrinterPadding(businessSettings.config.printer_padding || "8");
      setPrinterMarginLeft(businessSettings.config.printer_margin_left || "0");
      setPrinterMarginRight(businessSettings.config.printer_margin_right || "0");
      setPrinterMarginTop(businessSettings.config.printer_margin_top || "0");
      setPrinterMarginBottom(businessSettings.config.printer_margin_bottom || "0");
      setPrinterZoom(businessSettings.config.printer_zoom || "100");
      setPrinterDoubleCopy(businessSettings.config.printer_double_copy_layaway_credit || false);
      setPrinterBleChunkSize(businessSettings.config.printer_ble_chunk_size || 20);
      setLowStockThreshold(String(businessSettings.config.low_stock_threshold || 5));
      setMaxCajeroDiscountPct(String(businessSettings.config.max_cajero_discount_pct || 5));
      /* eslint-enable react-hooks/set-state-in-effect */

      // Pre-cargar lista de impresoras escaneadas si ya hay una guardada
      const savedPrinter = businessSettings.config.printer_name;
      const type = businessSettings.config.printer_type;
      if (savedPrinter && (type === "bluetooth" || type === "wifi")) {
        const defaultList = type === "bluetooth"
          ? ["🛜 Impresora Térmica Portátil BT-58", "🛜 EC Line Printer BT-80", "🛜 Star Micronics SM-T300i"]
          : ["📶 EPSON TM-T88VI (192.168.1.150)", "📶 Bixolon SRP-350plusIII (192.168.1.155)", "📶 Impresora Cocina (192.168.1.200)"];
        if (!defaultList.includes(savedPrinter)) {
          defaultList.unshift(savedPrinter);
        }
        setScannedPrinters(defaultList);
      }
    }
    fetchUsers();
    fetchErrorLogs();
    fetchTrash();
  }, [businessSettings]);

  async function fetchUsers() {
    const { data } = await supabase.from("users").select("*");
    if (data) setSystemUsers(data);
  }

  const saveConfig = async () => {
    if (!checkAdmin()) return;
    const success = await updateBusinessSettings({
      config: {
        voice_keyword: voiceKeyword.toLowerCase(),
      }
    });
    if (success) {
      alert(
        "✅ Configuración guardada. El Cajero Inteligente de Voz pedirá esta palabra clave antes de ejecutar las órdenes de venta.",
      );
    }
  };

  const saveLoyaltyConfig = async () => {
    if (!checkAdmin()) return;
    const success = await updateBusinessSettings({
      config: {
        earn_rate: Number(earnRate) || 100,
        earn_points: Number(earnPoints) || 1,
        redeem_rate: Number(redeemRate) || 10,
      }
    });
    if (success) {
      alert("✅ Tasas del Programa de Lealtad actualizadas.");
    }
  };

  const saveWholesaleConfig = async () => {
    if (!checkAdmin()) return;
    const success = await updateBusinessSettings({
      config: {
        wholesale_min_qty: Number(wholesaleMinQty) || 10,
        wholesale_discount: Number(wholesaleDiscount) || 10,
      }
    });
    if (success) {
      alert("✅ Configuración de Mayoreo Automático guardada.");
    }
  };

  const saveInventoryAlertConfig = async () => {
    if (!checkAdmin()) return;
    const success = await updateBusinessSettings({
      config: {
        low_stock_threshold: Number(lowStockThreshold) || 5,
        max_cajero_discount_pct: Number(maxCajeroDiscountPct) || 5,
      }
    });
    if (success) {
      alert("✅ Umbral de existencias y límite de descuento autónomo actualizados.");
    }
  };

  const saveUtilityAndGoalsConfig = async () => {
    if (!checkAdmin()) return;
    const success = await updateBusinessSettings({
      target_utility: parseFloat(targetUtility) || 0,
      monthly_goals: parseFloat(monthlyGoals) || 0,
    });
    if (success) {
      alert("✅ Utilidad y Metas de Venta actualizadas (sincronizado con la nube).");
    }
  };

  const toggleTheme = async (newTheme: string) => {
    setTheme(newTheme);
    if (newTheme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    await updateBusinessSettings({
      config: {
        theme: newTheme,
      }
    });
  };

  const saveBusinessProfile = async () => {
    if (!checkAdmin()) return;
    const success = await updateBusinessSettings({
      config: {
        business_name: businessName,
        business_rfc: businessRfc,
        business_phone: businessPhone,
        business_email: businessEmail,
        business_address: businessAddress,
        business_logo: businessLogo,
      }
    });
    if (success) {
      alert("✅ Perfil del Negocio guardado exitosamente.");
    }
  };

  const savePrintSettings = async () => {
    if (!checkAdmin()) return;
    const paddingNum = parseInt(printerPadding, 10);
    const validatedPadding = isNaN(paddingNum) ? "8" : String(Math.max(0, Math.min(50, paddingNum)));
    const sanitizedFooterMsg = printerFooterMsg.trim().slice(0, 150);
    setPrinterFooterMsg(sanitizedFooterMsg);
    
    const success = await updateBusinessSettings({
      config: {
        printer_connected: isConnected,
        printer_type: connectionType,
        printer_name: printerName,
        printer_paper_size: printerPaperSize,
        printer_font_size: printerFontSize,
        printer_font_family: printerFontFamily,
        printer_fields: printerFields,
        printer_footer_msg: sanitizedFooterMsg,
        printer_align: printerAlign,
        printer_padding: validatedPadding,
        printer_margin_left: printerMarginLeft,
        printer_margin_right: printerMarginRight,
        printer_margin_top: printerMarginTop,
        printer_margin_bottom: printerMarginBottom,
        printer_zoom: printerZoom,
        printer_double_copy_layaway_credit: printerDoubleCopy,
        printer_ble_chunk_size: printerBleChunkSize,
      }
    });
    if (success) {
      localStorage.setItem("ERIKA_PRINTER_CONNECTED", isConnected ? "true" : "false");
      localStorage.setItem("ERIKA_PRINTER_TYPE", connectionType);
      localStorage.setItem("ERIKA_PRINTER_NAME", printerName);
      localStorage.setItem("ERIKA_PRINTER_SILENT_KIOSK", silentKiosk ? "true" : "false");
      localStorage.setItem("ERIKA_PRINTER_DOUBLE_COPY", printerDoubleCopy ? "true" : "false");
      localStorage.setItem("ERIKA_PRINTER_BLE_CHUNK_SIZE", String(printerBleChunkSize));
      alert("✅ Configuración de Impresión guardada exitosamente.");
    }
  };

  const handleScanPrinters = async () => {
    if (!checkAdmin()) return;
    if (connectionType === "bluetooth") {
      try {
        if (typeof window === "undefined" || !(navigator as any).bluetooth) {
          alert("Su navegador o sistema no soporta Web Bluetooth. Asegúrese de usar Google Chrome y tener el Bluetooth encendido.");
          return;
        }
        setIsScanning(true);
        const device = await (navigator as any).bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [
            "000018f0-0000-1000-8000-00805f9b34fb",
            "0000e7e1-0000-1000-8000-00805f9b34fb",
            "0000ae30-0000-1000-8000-00805f9b34fb"
          ]
        });
        
        console.log("Conectando a GATT server de:", device.name);
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
            const name = device.name || "MPT-II";
            setPrinterName(name);
            setScannedPrinters([name]);
            
            const success = await updateBusinessSettings({
              config: {
                printer_connected: true,
                printer_type: "bluetooth",
                printer_name: name,
                printer_paper_size: printerPaperSize,
                printer_font_size: printerFontSize,
                printer_font_family: printerFontFamily,
                printer_fields: printerFields,
                printer_footer_msg: printerFooterMsg,
                printer_align: printerAlign,
                printer_padding: printerPadding,
                printer_margin_left: printerMarginLeft,
                printer_margin_right: printerMarginRight,
                printer_margin_top: printerMarginTop,
                printer_margin_bottom: printerMarginBottom,
                printer_zoom: printerZoom,
                printer_double_copy_layaway_credit: printerDoubleCopy,
                printer_ble_chunk_size: printerBleChunkSize,
              }
            });
            
            if (success) {
              localStorage.setItem("ERIKA_PRINTER_CONNECTED", "true");
              localStorage.setItem("ERIKA_PRINTER_TYPE", "bluetooth");
              localStorage.setItem("ERIKA_PRINTER_NAME", name);
              localStorage.setItem("ERIKA_PRINTER_SILENT_KIOSK", silentKiosk ? "true" : "false");
              localStorage.setItem("ERIKA_PRINTER_DOUBLE_COPY", printerDoubleCopy ? "true" : "false");
              localStorage.setItem("ERIKA_PRINTER_BLE_CHUNK_SIZE", String(printerBleChunkSize));
              alert(`✅ Impresora "${name}" vinculada y guardada como predeterminada con éxito.`);
            } else {
              alert(`✅ Vinculado a "${name}" localmente, pero hubo un error al guardar en la nube.`);
            }
          } else {
            alert("⚠️ Dispositivo vinculado, pero no se encontró un canal de escritura de impresión térmica.");
          }
        } else {
          alert("No se pudo conectar a la impresora.");
        }
      } catch (err: any) {
        console.error(err);
        if (err.name !== "NotFoundError") {
          alert("Error al vincular: " + err.message);
        }
      } finally {
        setIsScanning(false);
      }
    } else {
      setIsScanning(true);
      setScannedPrinters([]);
      setTimeout(() => {
        setIsScanning(false);
        setScannedPrinters([
          "💻 Impresora de Sistema (PDF Writer)",
          "💻 POS-58 USB Printer",
          "💻 EPSON TM-T20II USB"
        ]);
      }, 1500);
    }
  };

  const handleRoleTypeChange = (val: string) => {
    setRoleType(val);
    if (val === "admin") {
      setNewPermissions({
        pos: true,
        dashboard: true,
        caja: true,
        servicios: true,
        inventario: true,
        reportes: true,
        configuracion: true
      });
    } else if (val === "cajero") {
      setNewPermissions({
        pos: true,
        dashboard: false,
        caja: true,
        servicios: false,
        inventario: false,
        reportes: false,
        configuracion: false
      });
    } else {
      setNewPermissions({
        pos: false,
        dashboard: false,
        caja: false,
        servicios: false,
        inventario: false,
        reportes: false,
        configuracion: false
      });
    }
  };

  const handleGenerateRandomPin = () => {
     let randomPin = "";
     let attempts = 0;
     do {
        randomPin = Math.floor(1000 + Math.random() * 9000).toString();
        attempts++;
     } while (systemUsers.some(u => u.pin === randomPin) && attempts < 100);
     setNewUserPin(randomPin);
  };

  const handleGenerateEditRandomPin = () => {
     let randomPin = "";
     let attempts = 0;
     do {
        randomPin = Math.floor(1000 + Math.random() * 9000).toString();
        attempts++;
     } while (systemUsers.some(u => u.pin === randomPin) && attempts < 100);
     setEditPin(randomPin);
  };

  const handleCreateUser = async () => {
     if (!checkAdmin()) return;
     if (!newUserName || !newUserPin || newUserPin.length < 4) return alert("Ingresa un nombre y un PIN de 4 dígitos o más.");
     
     // Validación de PIN duplicado (Sugerencia 2)
     if (systemUsers.some(u => u.pin === newUserPin)) {
        return alert("❌ El PIN ingresado ya pertenece a otro usuario. Por seguridad, cada usuario debe tener un PIN único.");
     }

     const roleToSave = roleType === "custom" ? customRoleName.trim() : roleType;
     if (!roleToSave) return alert("Ingresa o selecciona un rol válido.");

     try {
       const response = await fetch("/api/admin/users", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
           adminPin: currentUser?.pin,
           user: {
             name: newUserName,
             pin: newUserPin,
             role: roleToSave,
             permissions: newPermissions
           }
         })
       });

       const result = await response.json();
       if (response.ok && result.success) {
         setNewUserName(""); 
         setNewUserPin("");
         setCustomRoleName("");
         setRoleType("cajero");
         setNewPermissions({
            pos: true,
            dashboard: false,
            caja: true,
            servicios: false,
            inventario: false,
            reportes: false,
            configuracion: false
         });
         setShowCreateModal(false);
         fetchUsers();
         alert("✅ Cajero/Usuario creado exitosamente.");
       } else {
         alert(`❌ Error al crear usuario: ${result.error || "Desconocido"}`);
       }
     } catch (e) {
       console.error("Error al crear usuario:", e);
       alert("Error de red al crear usuario.");
     }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const startEditUser = (user: any) => {
    setEditingUser(user);
    setEditName(user.name);
    setEditPin(user.pin);
    setEditRole(user.role);
    setEditPermissions({
      pos: user.permissions?.pos || false,
      dashboard: user.permissions?.dashboard || false,
      caja: user.permissions?.caja || false,
      servicios: user.permissions?.servicios || false,
      inventario: user.permissions?.inventario || false,
      reportes: user.permissions?.reportes || false,
      configuracion: user.permissions?.configuracion || false,
    });
    setShowEditUserPinText(false);
  };

  const handleSaveEditUser = async () => {
     if (!checkAdmin()) return;
     if (!editName || !editPin || editPin.length < 4) return alert("Ingresa un nombre y un PIN de 4 dígitos o más.");
     
     // Validación de PIN duplicado en edición (Sugerencia 2)
     if (systemUsers.some(u => u.pin === editPin && u.id !== editingUser?.id)) {
        return alert("❌ El PIN ingresado ya pertenece a otro usuario. Por seguridad, cada usuario debe tener un PIN único.");
     }

     if (!editRole) return alert("El rol no puede estar vacío.");

    try {
      const response = await fetch("/api/admin/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminPin: currentUser?.pin,
          userId: editingUser?.id,
          user: {
            name: editName,
            pin: editPin,
            role: editRole.trim(),
            permissions: editPermissions
          }
        })
      });

      const result = await response.json();
      if (response.ok && result.success) {
        setEditingUser(null);
        fetchUsers();
        alert("✅ Usuario actualizado exitosamente.");
      } else {
        alert(`❌ Error al actualizar usuario: ${result.error || "Desconocido"}`);
      }
    } catch (e) {
      console.error("Error al actualizar usuario:", e);
      alert("Error de red al actualizar usuario.");
    }
  };

  const handleDeleteUser = async (id: string, name: string) => {
     if (!checkAdmin()) return;
     if (!window.confirm(`¿Estás seguro de eliminar al usuario ${name}?`)) return;

     try {
       const response = await fetch(`/api/admin/users?adminPin=${currentUser?.pin}&userId=${id}`, {
         method: "DELETE"
       });

       const result = await response.json();
       if (response.ok && result.success) {
         fetchUsers();
         alert("✅ Usuario eliminado exitosamente.");
       } else {
         alert(`❌ Error al eliminar usuario: ${result.error || "Desconocido"}`);
       }
     } catch (e) {
       console.error("Error al eliminar usuario:", e);
       alert("Error de red al eliminar usuario.");
     }
  };

  const togglePrinterConnection = async () => {
    const nextVal = !isConnected;
    setIsConnected(nextVal);
    const success = await updateBusinessSettings({
      config: {
        printer_connected: nextVal,
      }
    });
    if (success) {
      window.dispatchEvent(new Event("storage"));
    }
  };

  const testPrint = () => {
    if (!isConnected) {
      alert("❌ Error: La impresora está desconectada. No se puede realizar la prueba.");
      return;
    }
    const widthCss = printerPaperSize === "58mm" ? "58mm" : "80mm";
    const fontSizeCss = printerFontSize === "small" ? "10px" : printerFontSize === "large" ? "14px" : "12px";
    let fontFamilyCss = "monospace";
    if (printerFontFamily === "sans-serif") fontFamilyCss = "sans-serif";
    else if (printerFontFamily === "serif") fontFamilyCss = "serif";

    const printWindow = window.open("", "_blank", `width=${printerPaperSize === "58mm" ? 300 : 400},height=500`);
    if (!printWindow) {
      alert("❌ Error: Bloqueador de ventanas emergentes activado.");
      return;
    }

    const showLogo = printerFields.includes("logo") && businessLogo;
    const showName = printerFields.includes("name");
    const showRfc = printerFields.includes("rfc") && businessRfc;
    const showPhone = printerFields.includes("phone") && businessPhone;
    const showAddress = printerFields.includes("address") && businessAddress;
    const showBilling = printerFields.includes("billing");
    const showFooter = printerFields.includes("footer");
    const showEmail = printerFields.includes("email") && businessEmail;

    const html = `
      <html>
        <head>
          <style>
            @page { margin: 0 !important; }
            body { 
              font-family: ${fontFamilyCss}; 
              font-size: ${fontSizeCss}; 
              margin: 0 auto !important; 
              padding: ${printerPadding}mm !important; 
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
          <div style="text-align: ${printerAlign}; width: 100%;">
            ${showLogo ? `<div class="center"><img src="${businessLogo}" style="max-width: 80px; margin-bottom: 10px;" /></div>` : ""}
            ${showName ? `<div class="center bold" style="font-size: 1.2em; margin-bottom: 5px;">${businessName}</div>` : ""}
            ${showRfc ? `<div class="center" style="font-size: 0.9em; margin-bottom: 3px;">RFC: ${businessRfc}</div>` : ""}
            ${showAddress ? `<div class="center" style="font-size: 0.9em; margin-bottom: 3px;">${businessAddress}</div>` : ""}
            ${showPhone ? `<div class="center" style="font-size: 0.9em; margin-bottom: 3px;">Tel: ${businessPhone}</div>` : ""}
            ${showEmail ? `<div class="center" style="font-size: 0.9em; margin-bottom: 3px;">Email: ${businessEmail}</div>` : ""}
            
            <div class="divider"></div>
            <p class="center bold">TICKET DE PRUEBA POS</p>
            <p class="center">¡Impresora configurada correctamente!</p>
            <div style="font-size: 0.9em; margin-bottom: 5px;">Fecha: ${new Date().toLocaleString()}</div>
            <div style="font-size: 0.9em; margin-bottom: 5px;">Impresora: ${printerName || "Por defecto del sistema"}</div>
            <div style="font-size: 0.9em; margin-bottom: 5px;">Papel: ${printerPaperSize}</div>
            <div style="font-size: 0.9em; margin-bottom: 5px;">Letra: ${printerFontFamily} (${printerFontSize})</div>
            <div class="divider"></div>
            
            ${showBilling ? `
            <div class="center" style="margin-top: 10px; font-size: 0.9em;">
              <strong>Auto-Facturación Express</strong><br>
              <span>Entra a ${window.location.origin}/facturacion/test para facturar.</span>
            </div>
            ` : ""}
            ${showFooter ? `<div class="center bold" style="margin-top: 10px;">${printerFooterMsg}</div>` : ""}
          </div>
        </body>
      </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 500);
  };

  return (
    <div
      className="animate-fade-in glass-panel"
      style={{ padding: "30px", maxWidth: "800px", margin: "0 auto" }}
    >
      <h2 style={{ color: "var(--color-primary)" }}>
        ⚙️ Configuración Global de ERIKA
      </h2>

      <div style={{ marginTop: "30px" }}>
        <h3 style={{ marginBottom: "10px", color: "var(--color-secondary)" }}>
          ☁️ Conexión Supabase (Nube)
        </h3>
        <p style={{ fontSize: "0.85rem", opacity: 0.7, marginBottom: "15px" }}>
          El paso final. Obtén estas credenciales al crear un proyecto en
          Supabase.com para iniciar la migración oficial.
        </p>

        <input
          type="text"
          placeholder="URL del Proyecto (ej. https://xxx.supabase.co)"
          disabled
          style={{
            width: "100%",
            padding: "12px",
            borderRadius: "8px",
            background: "rgba(255,255,255,0.05)",
            color: "white",
            border: "1px solid rgba(255,255,255,0.1)",
            marginBottom: "10px",
          }}
        />
        <input
          type="password"
          placeholder="Anon / Public Key"
          disabled
          style={{
            width: "100%",
            padding: "12px",
            borderRadius: "8px",
            background: "rgba(255,255,255,0.05)",
            color: "white",
            border: "1px solid rgba(255,255,255,0.1)",
            marginBottom: "20px",
          }}
        />

        <button
          className="btn-primary"
          disabled
          style={{ width: "100%", opacity: 0.5 }}
        >
          Conectar Nube (Pendiente)
        </button>
      </div>

      <div style={{ display: "flex", gap: "30px", flexWrap: "wrap", marginTop: "30px" }}>
        <div style={{ flex: 1, minWidth: "300px", display: "flex", flexDirection: "column", gap: "20px" }}>
          
          <div className="glass-panel">
            <h3 style={{ marginBottom: "10px" }}>
              🔐 Palabra Clave de Seguridad (Voz)
            </h3>
            <p style={{ fontSize: "0.85rem", opacity: 0.7, marginBottom: "15px" }}>
              El sistema de voz ignorará peticiones a menos que la persona que le
              hable incluya esta palabra en su frase.
            </p>

            <input
              type="text"
              value={voiceKeyword}
              onChange={(e) => setVoiceKeyword(e.target.value)}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "8px",
                background: "rgba(0,0,0,0.3)",
                color: "white",
                border: "1px solid var(--color-primary)",
                marginBottom: "20px",
              }}
            />

            <button
              className="btn-primary"
              onClick={saveConfig}
              style={{ width: "100%" }}
            >
              💾 Guardar Palabra de Seguridad
            </button>
          </div>

          <div className="glass-panel" style={{ border: "1px solid var(--color-secondary)" }}>
            <h3 style={{ margin: "0 0 20px 0", color: "var(--color-secondary)", display: "flex", alignItems: "center", gap: "10px" }}>
              🏢 Perfil del Negocio
            </h3>
            <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)", marginBottom: "15px" }}>
              Estos datos aparecerán en las cotizaciones impresas, PDFs y tickets de venta.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "15px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Nombre del Negocio:</label>
                <input type="text" value={businessName} onChange={e => setBusinessName(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "var(--color-text)" }} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>RFC:</label>
                <input type="text" value={businessRfc} onChange={e => setBusinessRfc(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "var(--color-text)" }} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "15px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Teléfono:</label>
                <input type="text" value={businessPhone} onChange={e => setBusinessPhone(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "var(--color-text)" }} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Correo Electrónico:</label>
                <input type="text" value={businessEmail} onChange={e => setBusinessEmail(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "var(--color-text)" }} />
              </div>
            </div>
            <div style={{ marginBottom: "15px" }}>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Dirección Física:</label>
              <textarea value={businessAddress} onChange={e => setBusinessAddress(e.target.value)} rows={2} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "var(--color-text)" }} />
            </div>
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>URL del Logotipo (Opcional):</label>
              <input type="text" placeholder="https://ejemplo.com/logo.png" value={businessLogo} onChange={e => setBusinessLogo(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "var(--color-text)" }} />
            </div>
            <button className="btn-primary" onClick={saveBusinessProfile} style={{ width: "100%", background: "transparent", border: "1px solid var(--color-secondary)", color: "var(--color-secondary)" }}>
              💾 Guardar Perfil
            </button>
          </div>

          <div className="glass-panel" style={{ border: "1px solid #eab308" }}>
            <h3 style={{ margin: "0 0 20px 0", color: "#eab308", display: "flex", alignItems: "center", gap: "10px" }}>
              ⭐ Tasas de Puntos de Lealtad
            </h3>
            <div style={{ marginBottom: "15px" }}>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Por cada $ de compra (Pesos):</label>
              <input type="number" value={earnRate} onChange={e => setEarnRate(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />
            </div>
            <div style={{ marginBottom: "15px" }}>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Se otorgan (Puntos):</label>
              <input type="number" value={earnPoints} onChange={e => setEarnPoints(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />
            </div>
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Puntos requeridos para $1.00 de descuento en caja:</label>
              <input type="number" value={redeemRate} onChange={e => setRedeemRate(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />
            </div>
            <button className="btn-primary" onClick={saveLoyaltyConfig} style={{ width: "100%", background: "transparent", border: "1px solid #eab308", color: "#eab308" }}>
              💾 Guardar Tasas de Lealtad
            </button>
          </div>

        </div>

          <div className="glass-panel" style={{ flex: 1, border: "1px solid #10b981", display: "flex", flexDirection: "column" }}>
            <h3 style={{ margin: "0 0 20px 0", color: "#10b981", display: "flex", alignItems: "center", gap: "10px" }}>
              👥 Gestión de Personal (Roles y Permisos)
            </h3>
            <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)", marginBottom: "15px" }}>
              Crea cuentas de personal, define su rol (predeterminado o personalizado) y gestiona los permisos granulares de visibilidad para cada módulo.
            </p>
            
            <button 
              className="btn-primary animate-fade-in" 
              onClick={() => {
                if (!checkAdmin()) return;
                setShowCreateModal(true);
                setShowNewUserPinText(false);
              }} 
              style={{ background: "#10b981", border: "none", padding: "12px", width: "100%", fontWeight: "bold", fontSize: "1rem", marginBottom: "20px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
            >
              ➕ Añadir Usuario / Personal
            </button>

            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "15px" }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                  <th style={{ padding: "10px", textAlign: "left" }}>Nombre</th>
                  <th style={{ padding: "10px", textAlign: "left" }}>PIN</th>
                  <th style={{ padding: "10px", textAlign: "left" }}>Rol</th>
                  <th style={{ padding: "10px", textAlign: "left" }}>Módulos Permitidos</th>
                  <th style={{ padding: "10px", textAlign: "center" }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                 {systemUsers.map(u => {
                   const uPermissions = u.permissions || {};
                   return (
                     <tr key={u.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                       <td style={{ padding: "10px", fontWeight: "bold" }}>{u.name}</td>
                       <td style={{ padding: "10px", fontFamily: "monospace", letterSpacing: "1px" }}>{u.pin}</td>
                       <td style={{ padding: "10px" }}>
                         <span style={{ 
                           padding: "4px 8px", 
                           background: u.role === "admin" ? "rgba(16,185,129,0.2)" : u.role === "cajero" ? "rgba(59,130,246,0.2)" : "rgba(234,179,8,0.2)", 
                           color: u.role === "admin" ? "#10b981" : u.role === "cajero" ? "#3b82f6" : "#eab308", 
                           borderRadius: "4px", 
                           fontSize: "0.8rem",
                           fontWeight: "bold"
                         }}>
                           {u.role.toUpperCase()}
                         </span>
                       </td>
                       <td style={{ padding: "10px" }}>
                         <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                           {uPermissions.pos && <span title="Punto de Venta" style={{ cursor: "help" }}>🛒</span>}
                           {uPermissions.dashboard && <span title="Dashboard" style={{ cursor: "help" }}>📊</span>}
                           {uPermissions.caja && <span title="Arqueo de Caja" style={{ cursor: "help" }}>💵</span>}
                           {uPermissions.servicios && <span title="Agenda de Servicios" style={{ cursor: "help" }}>📅</span>}
                           {uPermissions.inventario && <span title="Almacén e Inventario" style={{ cursor: "help" }}>📦</span>}
                           {uPermissions.reportes && <span title="Reportes e Inteligencia" style={{ cursor: "help" }}>📈</span>}
                           {uPermissions.configuracion && <span title="Configuración" style={{ cursor: "help" }}>⚙️</span>}
                           {!Object.values(uPermissions).some(Boolean) && <span style={{ opacity: 0.5, fontSize: "0.85rem" }}>Ninguno</span>}
                         </div>
                       </td>
                       <td style={{ padding: "10px", textAlign: "center" }}>
                         <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                           <button 
                             onClick={() => startEditUser(u)} 
                             style={{ 
                               background: "rgba(59,130,246,0.1)", 
                               color: "#3b82f6", 
                               border: "1px solid rgba(59,130,246,0.3)", 
                               padding: "4px 8px", 
                               borderRadius: "4px", 
                               cursor: "pointer",
                               fontSize: "0.85rem"
                             }}
                           >
                             ✏️ Editar
                           </button>
                           <button 
                             onClick={() => handleDeleteUser(u.id, u.name)} 
                             style={{ 
                               background: "transparent", 
                               color: "#ef4444", 
                               border: "1px solid #ef4444", 
                               padding: "4px 8px", 
                               borderRadius: "4px", 
                               cursor: "pointer",
                               fontSize: "0.85rem"
                             }}
                           >
                             Eliminar
                           </button>
                         </div>
                       </td>
                     </tr>
                   );
                 })}
              </tbody>
            </table>
          </div>

          <div className="glass-panel" style={{ border: "1px solid #8b5cf6" }}>
            <h3 style={{ margin: "0 0 20px 0", color: "#10b981", display: "flex", alignItems: "center", gap: "10px" }}>
              🔑 Licencia del Sistema ERIKA
            </h3>
            
            <div style={{ background: "rgba(255,255,255,0.05)", padding: "15px", borderRadius: "8px", marginBottom: "15px" }}>
              <p style={{ margin: "0 0 5px 0", color: "var(--color-secondary)", fontSize: "0.9rem" }}>Estado de la Licencia</p>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ display: "inline-block", width: "12px", height: "12px", borderRadius: "50%", background: "#10b981" }}></span>
                <span style={{ fontSize: "1.2rem", fontWeight: "bold", color: "white" }}>Activa (Versión Ilimitada)</span>
              </div>
            </div>

            <div style={{ background: "rgba(255,255,255,0.05)", padding: "15px", borderRadius: "8px", marginBottom: "20px" }}>
              <p style={{ margin: "0 0 5px 0", color: "var(--color-secondary)", fontSize: "0.9rem" }}>Fecha de Vencimiento / Renovación</p>
              <p style={{ margin: 0, fontSize: "1.1rem", fontWeight: "bold", color: "white" }}>Licencia Vitalicia ♾️</p>
            </div>

            <div style={{ borderTop: "1px solid var(--glass-border)", paddingTop: "15px" }}>
              <label style={{ display: "block", marginBottom: "8px", color: "var(--color-secondary)", fontSize: "0.9rem" }}>Actualizar o Cambiar Clave de Producto</label>
              <div style={{ display: "flex", gap: "10px" }}>
                <input 
                  type="text" 
                  placeholder="XXXX-XXXX-XXXX-XXXX" 
                  style={{ flex: 1, padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "var(--color-text)", fontFamily: "monospace", textTransform: "uppercase" }} 
                />
                <button className="btn-primary" style={{ padding: "10px 20px" }}>
                  Validar
                </button>
              </div>
              <p style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.5)", marginTop: "10px", fontStyle: "italic" }}>* El módulo de licencias se encuentra en modo bypass actualmente.</p>
            </div>
          </div>
          
          <div className="glass-panel" style={{ border: "1px solid #3b82f6" }}>
            <h3 style={{ margin: "0 0 20px 0", color: "#3b82f6", display: "flex", alignItems: "center", gap: "10px" }}>
              🛒 Descuentos Automáticos por Mayoreo
            </h3>
            <div style={{ marginBottom: "15px" }}>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Cantidad Mínima para Mayoreo (piezas):</label>
              <input type="number" value={wholesaleMinQty} onChange={e => setWholesaleMinQty(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "var(--color-text)" }} />
            </div>
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Descuento a aplicar (%):</label>
              <input type="number" value={wholesaleDiscount} onChange={e => setWholesaleDiscount(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "var(--color-text)" }} />
            </div>
            <button className="btn-primary" onClick={saveWholesaleConfig} style={{ width: "100%", background: "transparent", border: "1px solid #3b82f6", color: "#3b82f6" }}>
              💾 Guardar Reglas de Mayoreo
            </button>
          </div>

          <div className="glass-panel" style={{ border: "1px solid #ef4444" }}>
            <h3 style={{ margin: "0 0 20px 0", color: "#ef4444", display: "flex", alignItems: "center", gap: "10px" }}>
              ⚠️ Inventario y Límites de Descuento
            </h3>
            <div style={{ marginBottom: "15px" }}>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Umbral de Alerta de Existencias Bajas:</label>
              <input type="number" value={lowStockThreshold} onChange={e => setLowStockThreshold(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "var(--color-text)" }} />
            </div>
            <div style={{ marginBottom: "15px" }}>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Descuento Autónomo Máximo de Cajero (%):</label>
              <input type="number" value={maxCajeroDiscountPct} onChange={e => setMaxCajeroDiscountPct(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "var(--color-text)" }} />
            </div>
            <p style={{ fontSize: "0.75rem", opacity: 0.7, marginBottom: "20px" }}>
              Define el stock de alerta en POS y el descuento máximo por artículo que un cajero puede aplicar sin requerir PIN de administrador.
            </p>
            <button className="btn-primary" onClick={saveInventoryAlertConfig} style={{ width: "100%", background: "transparent", border: "1px solid #ef4444", color: "#ef4444" }}>
              💾 Guardar Configuración
            </button>
          </div>

          <div className="glass-panel" style={{ border: "1px solid var(--color-primary)", display: "flex", flexDirection: "column", gap: "15px" }}>
            <h3 style={{ margin: "0 0 10px 0", color: "var(--color-primary)", display: "flex", alignItems: "center", gap: "10px" }}>
              🖨️ Menú de Impresión Profesional
            </h3>
            <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)", margin: 0 }}>
              Configure la impresora física o inalámbrica (Bluetooth/WiFi) y los parámetros del ticket de compra.
            </p>

            <div style={{ display: "flex", gap: "15px", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: "200px" }}>
                <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Conexión:</label>
                <select
                  value={connectionType}
                  onChange={(e) => setConnectionType(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }}
                >
                  <option value="system">Sistema / Navegador (USB/Red/WiFi)</option>
                  <option value="bluetooth">Bluetooth Directo (Sin Controlador - Web BLE)</option>
                </select>
              </div>

              <div style={{ flex: 1, minWidth: "200px" }}>
                <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Tamaño del Papel:</label>
                <select
                  value={printerPaperSize}
                  onChange={(e) => setPrinterPaperSize(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }}
                >
                  <option value="58mm">58mm (Estándar Angosto)</option>
                  <option value="80mm">80mm (Ancho POS Profesional)</option>
                </select>
              </div>
            </div>

            {connectionType === "bluetooth" && (
              <div style={{ 
                background: "rgba(59,130,246,0.1)", 
                border: "1px solid rgba(59,130,246,0.25)", 
                borderRadius: "8px", 
                padding: "15px", 
                color: "#93c5fd",
                fontSize: "0.85rem",
                lineHeight: "1.5"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "bold", marginBottom: "8px" }}>
                  🛜 Conexión Directa Bluetooth (Sin Controlador)
                </div>
                <div style={{ color: "rgba(255,255,255,0.85)" }}>
                  Erika se conectará directamente a su impresora Bluetooth mediante las herramientas inalámbricas del navegador (GATT BLE), similar a conectar audífonos.
                  <ol style={{ margin: "8px 0 8px 20px", padding: 0 }}>
                    <li>Encienda el Bluetooth de su computadora e impresora.</li>
                    <li>Haga clic en el botón <strong>"Vincular Impresora"</strong> de abajo.</li>
                    <li>Seleccione su impresora (ej: <code>MPT-II</code>) en la ventana flotante de Chrome y haga clic en <strong>Vincular</strong>.</li>
                    <li>¡Eso es todo! Erika enviará los tickets de forma inalámbrica directa sin diálogos de impresión y sin requerir drivers de Windows.</li>
                  </ol>
                </div>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "5px", background: "rgba(255,255,255,0.05)", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)" }}>
              <input
                type="checkbox"
                id="printer-double-copy-checkbox"
                checked={printerDoubleCopy}
                onChange={(e) => setPrinterDoubleCopy(e.target.checked)}
                style={{ width: "18px", height: "18px", cursor: "pointer" }}
              />
              <label htmlFor="printer-double-copy-checkbox" style={{ fontSize: "0.9rem", cursor: "pointer", userSelect: "none", color: "white" }}>
                <strong>Doble copia para Apartados y Crédito</strong> (Imprime automáticamente un segundo ticket de copia para el negocio).
              </label>
            </div>

            {connectionType === "system" && (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "5px", background: "rgba(255,255,255,0.05)", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)" }}>
                <input
                  type="checkbox"
                  id="silent-kiosk-checkbox"
                  checked={silentKiosk}
                  onChange={(e) => setSilentKiosk(e.target.checked)}
                  style={{ width: "18px", height: "18px", cursor: "pointer" }}
                />
                <label htmlFor="silent-kiosk-checkbox" style={{ fontSize: "0.9rem", cursor: "pointer", userSelect: "none", color: "white" }}>
                  <strong>Modo Kiosco / Impresión Silenciosa</strong> (Requiere iniciar Google Chrome con la opción <code>--kiosk-printing</code> para saltar la ventana de confirmación).
                </label>
              </div>
            )}

            {/* Bluetooth Scan block */}
            {connectionType === "bluetooth" && (
              <div style={{ background: "rgba(0,0,0,0.2)", padding: "12px", borderRadius: "8px", border: "1px dashed var(--color-secondary)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "0.85rem", fontWeight: "bold" }}>
                    Vinculación Inalámbrica:
                  </span>
                  <button
                    onClick={handleScanPrinters}
                    disabled={isScanning}
                    className="btn-primary"
                    style={{ padding: "6px 12px", fontSize: "0.8rem", background: "var(--color-secondary)", border: "none", color: "black" }}
                  >
                    {isScanning ? "⏳ Buscando..." : "🔍 Vincular Impresora"}
                  </button>
                </div>
                {printerName && (
                  <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "5px" }}>
                    <div style={{ fontSize: "0.85rem", color: "#34d399", fontWeight: "bold" }}>
                      Dispositivo Activo: 🟢 {printerName}
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "#34d399", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.2)", padding: "6px 10px", borderRadius: "4px" }}>
                      ✔️ Impresora Lista y Conectada (Canal de escritura verificado)
                    </div>
                  </div>
                )}
              </div>
            )}

            {connectionType === "bluetooth" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "5px", background: "rgba(255,255,255,0.02)", padding: "12px", borderRadius: "8px", border: "1px solid var(--glass-border)" }}>
                <label style={{ display: "block", fontSize: "0.9rem", fontWeight: "bold" }}>Tamaño de Bloque Bluetooth (Buffer de Envío):</label>
                <select
                  value={printerBleChunkSize}
                  onChange={(e) => setPrinterBleChunkSize(Number(e.target.value))}
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }}
                >
                  <option value={10}>10 bytes (Ultra seguro / Impresoras lentas)</option>
                  <option value={20}>20 bytes (Estándar / Recomendado)</option>
                  <option value={40}>40 bytes (Rápido)</option>
                  <option value={60}>60 bytes (Ultra Rápido / Alta Gama)</option>
                </select>
                <span style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.5)" }}>
                  Reduzca este valor a 10 bytes si nota que los tickets largos salen incompletos o con caracteres extraños.
                </span>
              </div>
            )}

            {/* Format Parameters */}
            <div style={{ display: "flex", gap: "15px", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: "200px" }}>
                <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Tipo de Letra:</label>
                <select
                  value={printerFontFamily}
                  onChange={(e) => setPrinterFontFamily(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }}
                >
                  <option value="monospace">Monospace (Limpia y Alineada)</option>
                  <option value="sans-serif">Sans-serif (Moderna y Redondeada)</option>
                  <option value="serif">Serif (Clásica Elegante)</option>
                </select>
              </div>

              <div style={{ flex: 1, minWidth: "200px" }}>
                <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Tamaño de Letra:</label>
                <select
                  value={printerFontSize}
                  onChange={(e) => setPrinterFontSize(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }}
                >
                  <option value="small">Pequeña (10px)</option>
                  <option value="normal">Normal (12px)</option>
                  <option value="large">Grande (14px)</option>
                </select>
              </div>
            </div>

            {/* Nuevos parámetros de formato: Margen y Alineación */}
            <div style={{ display: "flex", gap: "15px", flexWrap: "wrap", marginTop: "15px" }}>
              <div style={{ flex: 1, minWidth: "200px" }}>
                <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem", color: "var(--color-text)" }}>Alineación Horizontal del Ticket:</label>
                <select
                  value={printerAlign}
                  onChange={(e) => setPrinterAlign(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }}
                >
                  <option value="center">Centrado (Centrar impresión)</option>
                  <option value="left">Alineado a la Izquierda</option>
                </select>
              </div>

              <div style={{ flex: 1, minWidth: "200px" }}>
                <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem", color: "var(--color-text)" }}>Margen Interno del Ticket (Padding en mm):</label>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={printerPadding}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "") {
                      setPrinterPadding("");
                      return;
                    }
                    const num = parseInt(val, 10);
                    if (!isNaN(num)) {
                      setPrinterPadding(String(Math.max(0, Math.min(50, num))));
                    }
                  }}
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }}
                />
              </div>
            </div>

            {/* Parámetros de alineación avanzada (Desfases y Zoom) */}
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "5px" }}>
              <div style={{ flex: 1, minWidth: "120px" }}>
                <label style={{ display: "block", marginBottom: "5px", fontSize: "0.85rem", color: "var(--color-text)" }}>Margen Izq. (mm):</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={printerMarginLeft}
                  onChange={(e) => setPrinterMarginLeft(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }}
                />
              </div>

              <div style={{ flex: 1, minWidth: "120px" }}>
                <label style={{ display: "block", marginBottom: "5px", fontSize: "0.85rem", color: "var(--color-text)" }}>Margen Der. (mm):</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={printerMarginRight}
                  onChange={(e) => setPrinterMarginRight(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }}
                />
              </div>

              <div style={{ flex: 1, minWidth: "120px" }}>
                <label style={{ display: "block", marginBottom: "5px", fontSize: "0.85rem", color: "var(--color-text)" }}>Margen Sup. (mm):</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={printerMarginTop}
                  onChange={(e) => setPrinterMarginTop(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }}
                />
              </div>

              <div style={{ flex: 1, minWidth: "120px" }}>
                <label style={{ display: "block", marginBottom: "5px", fontSize: "0.85rem", color: "var(--color-text)" }}>Margen Inf. (mm):</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={printerMarginBottom}
                  onChange={(e) => setPrinterMarginBottom(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }}
                />
              </div>

              <div style={{ flex: 1, minWidth: "120px" }}>
                <label style={{ display: "block", marginBottom: "5px", fontSize: "0.85rem", color: "var(--color-text)" }}>Zoom / Escala (%):</label>
                <input
                  type="number"
                  min="30"
                  max="200"
                  value={printerZoom}
                  onChange={(e) => setPrinterZoom(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }}
                />
              </div>
            </div>

            {/* Fields to Print */}
            <div>
              <label style={{ display: "block", marginBottom: "8px", fontSize: "0.9rem", color: "var(--color-secondary)" }}>
                Campos a Imprimir en el Ticket:
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "8px", background: "rgba(0,0,0,0.15)", padding: "10px", borderRadius: "6px" }}>
                {[
                  { key: "logo", label: "🖼️ Logotipo" },
                  { key: "name", label: "🏢 Nombre Negocio" },
                  { key: "rfc", label: "🧾 RFC Fiscal" },
                  { key: "phone", label: "📱 Teléfono" },
                  { key: "address", label: "📍 Dirección" },
                  { key: "email", label: "✉️ Correo" },
                  { key: "payment_method", label: "💳 Método de Pago" },
                  { key: "seller", label: "👤 Cajero / Vendedor" },
                  { key: "customer", label: "👥 Datos Cliente" },
                  { key: "notes", label: "📝 Notas Ticket" },
                  { key: "warranty", label: "🛡️ Garantías" },
                  { key: "billing", label: "🧾 Facturación Express" },
                  { key: "footer", label: "💬 Mensaje de Pie" },
                ].map((field) => {
                  const isChecked = printerFields.includes(field.key);
                  return (
                    <label key={field.key} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "0.85rem", color: "white" }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setPrinterFields([...printerFields, field.key]);
                          } else {
                            setPrinterFields(printerFields.filter(f => f !== field.key));
                          }
                        }}
                      />
                      {field.label}
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Footer Message */}
            {printerFields.includes("footer") && (
              <div>
                <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Mensaje del Pie de Ticket:</label>
                <input
                  type="text"
                  value={printerFooterMsg}
                  onChange={(e) => setPrinterFooterMsg(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }}
                />
              </div>
            )}

            {/* Live Preview of the Ticket */}
            <div style={{ marginTop: "20px", borderTop: "1px dashed var(--glass-border)", paddingTop: "15px" }}>
              <h4 style={{ fontSize: "0.95rem", fontWeight: "bold", marginBottom: "12px", color: "var(--color-primary)", display: "flex", alignItems: "center", gap: "8px" }}>
                👁️ Vista Previa del Ticket (Alineación: {printerAlign === "center" ? "Centrado" : "Izquierda"}, Margen: {printerPadding || 0}mm)
              </h4>
              <div style={{ display: "flex", justifyContent: "center", background: "rgba(0,0,0,0.2)", padding: "15px", borderRadius: "8px", border: "1px solid var(--glass-border)" }}>
                <div 
                  style={{ 
                    background: "white", 
                    color: "black", 
                    width: "100%", 
                    maxWidth: printerPaperSize === "58mm" ? "200px" : "260px", 
                    padding: `${printerPadding || 0}mm`, 
                    boxSizing: "border-box", 
                    fontFamily: printerFontFamily === "sans-serif" ? "sans-serif" : printerFontFamily === "serif" ? "serif" : "monospace",
                    fontSize: printerFontSize === "small" ? "10px" : printerFontSize === "large" ? "13px" : "11px",
                    textAlign: printerAlign as any,
                    boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
                    borderRadius: "4px",
                    transition: "all 0.15s ease",
                    marginLeft: `${printerMarginLeft || 0}px`,
                    marginRight: `${printerMarginRight || 0}px`,
                    marginTop: `${printerMarginTop || 0}px`,
                    marginBottom: `${printerMarginBottom || 0}px`,
                    transform: `scale(${parseFloat(printerZoom || "100") / 100})`,
                    transformOrigin: "top center"
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", alignItems: printerAlign === "center" ? "center" : "flex-start", borderBottom: "1px dashed #000", paddingBottom: "6px", marginBottom: "8px" }}>
                    {printerFields.includes("logo") && businessLogo && <img src={businessLogo} alt="Logo" style={{ maxHeight: "35px", marginBottom: "5px" }} />}
                    {printerFields.includes("name") && <div style={{ fontWeight: "bold", fontSize: "1.1em" }}>{businessName || "Ferretería ERIKA"}</div>}
                    {printerFields.includes("rfc") && businessRfc && <div>RFC: {businessRfc}</div>}
                    {printerFields.includes("address") && businessAddress && <div style={{ fontSize: "0.9em", whiteSpace: "pre-line" }}>{businessAddress}</div>}
                    {printerFields.includes("phone") && businessPhone && <div>Tel: {businessPhone}</div>}
                    {printerFields.includes("email") && businessEmail && <div>Email: {businessEmail}</div>}
                  </div>

                  <div style={{ fontSize: "0.9em", marginBottom: "6px", textAlign: "left" }}>
                    <strong>Ticket: #0001</strong><br />
                    <span>Fecha: {new Date().toLocaleDateString()}</span><br />
                    {printerFields.includes("seller") && <span>Atendido por: Administrador</span>}
                  </div>

                  {printerFields.includes("customer") && (
                    <div style={{ background: "#f3f4f6", padding: "3px 6px", borderRadius: "3px", fontSize: "0.85em", marginBottom: "6px", border: "1px solid #e5e7eb", textAlign: "left" }}>
                      <strong>Cliente:</strong> Público General
                    </div>
                  )}

                  {printerFields.includes("payment_method") && (
                    <div style={{ fontSize: "0.85em", marginBottom: "6px", textAlign: "left" }}>
                      <strong>Método de Pago:</strong> EFECTIVO
                    </div>
                  )}

                  {printerFields.includes("notes") && (
                    <div style={{ background: "#f3f4f6", padding: "3px 6px", borderRadius: "3px", fontSize: "0.8em", marginBottom: "6px", border: "1px solid #e5e7eb", textAlign: "left" }}>
                      <strong>Nota:</strong> Esta es una nota de prueba.
                    </div>
                  )}

                  <div style={{ borderBottom: "1px dashed #000", paddingBottom: "4px", marginBottom: "4px", fontSize: "0.9em" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>1x Producto Demo</span>
                      <span>$100</span>
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", fontSize: "1em" }}>
                    <span>TOTAL:</span>
                    <span>$100</span>
                  </div>

                  {printerFields.includes("warranty") && (
                    <div style={{ fontSize: "0.8em", marginTop: "8px", opacity: 0.8, textAlign: "center" }}>
                      🛡️ Garantía de 30 días contra defectos de fábrica.
                    </div>
                  )}

                  {printerFields.includes("billing") && (
                    <div style={{ fontSize: "0.8em", marginTop: "8px", textAlign: "center" }}>
                      <strong>Auto-Facturación Express</strong><br />
                      <span style={{ fontSize: "0.85em" }}>Entra a: erika-app.vercel.app/facturacion para facturar</span>
                    </div>
                  )}

                  {printerFields.includes("footer") && printerFooterMsg && (
                    <div style={{ marginTop: "8px", fontWeight: "bold", textAlign: "center" }}>
                      {printerFooterMsg}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "10px" }}>
              <button
                onClick={savePrintSettings}
                className="btn-primary"
                style={{ flex: 2, background: "var(--color-primary)", color: "#000", fontWeight: "bold" }}
              >
                💾 Guardar Configuración de Impresión
              </button>
              <button
                onClick={testPrint}
                className="btn-primary"
                style={{ flex: 1, background: "transparent", border: "1px solid var(--color-secondary)", color: "var(--color-secondary)" }}
              >
                📄 Prueba
              </button>
            </div>
          </div>

          <div className="glass-panel" style={{ border: "1px solid var(--color-primary)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h3 style={{ margin: 0, color: "var(--color-primary)", display: "flex", alignItems: "center", gap: "10px" }}>
                📋 Bitácora de Auditoría y Eventos del Sistema
              </h3>
              <button 
                onClick={fetchErrorLogs} 
                disabled={isLoadingLogs}
                style={{ background: "rgba(16,185,129,0.15)", color: "var(--color-primary)", border: "1px solid var(--color-primary)", padding: "5px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "0.8rem" }}
              >
                {isLoadingLogs ? "Cargando..." : "🔄 Actualizar"}
              </button>
            </div>
            
            <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)", marginTop: "-10px", marginBottom: "15px" }}>
              Historial de actividades del personal, cambios en el inventario e incidencias técnicas registradas en el sistema.
            </p>

            <div style={{ maxHeight: "250px", overflowY: "auto", background: "rgba(0,0,0,0.2)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
              {errorLogs.length === 0 ? (
                <p style={{ textAlign: "center", padding: "20px", color: "rgba(255,255,255,0.5)", fontSize: "0.9rem", margin: 0 }}>
                  No hay registros ni incidencias recientes en la bitácora. ¡Todo funciona perfecto!
                </p>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                  <thead style={{ background: "rgba(255,255,255,0.05)", position: "sticky", top: 0 }}>
                    <tr>
                      <th style={{ padding: "8px", textAlign: "left", color: "rgba(255,255,255,0.7)" }}>Fecha</th>
                      <th style={{ padding: "8px", textAlign: "left", color: "rgba(255,255,255,0.7)" }}>Tipo / Módulo</th>
                      <th style={{ padding: "8px", textAlign: "left", color: "rgba(255,255,255,0.7)" }}>Usuario</th>
                      <th style={{ padding: "8px", textAlign: "left", color: "rgba(255,255,255,0.7)" }}>Detalle de la Actividad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errorLogs.map(log => {
                      const isAudit = log.module === "Inventario_Edicion_Manual" || log.error_details.toLowerCase().includes("edición inline") || log.error_details.toLowerCase().includes("cambió");
                      return (
                        <tr key={log.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                          <td style={{ padding: "8px", color: "white", whiteSpace: "nowrap" }}>{new Date(log.created_at).toLocaleString()}</td>
                          <td style={{ padding: "8px" }}>
                            <span style={{ 
                              padding: "2px 6px", 
                              borderRadius: "4px", 
                              fontSize: "0.75rem", 
                              fontWeight: "bold",
                              background: isAudit ? "rgba(59,130,246,0.15)" : "rgba(239,68,68,0.15)",
                              color: isAudit ? "#60a5fa" : "#f87171",
                              border: isAudit ? "1px solid rgba(59,130,246,0.3)" : "1px solid rgba(239,68,68,0.3)"
                            }}>
                              {isAudit ? "📋 Auditoría" : "🚨 Incidencia"}
                            </span>
                          </td>
                          <td style={{ padding: "8px", color: "white" }}>{log.usuario}</td>
                          <td style={{ padding: "8px", color: isAudit ? "rgba(255,255,255,0.9)" : "#f87171", fontFamily: isAudit ? "inherit" : "monospace", wordBreak: "break-all" }}>
                            {log.error_details}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="glass-panel" style={{ border: "1px solid var(--color-primary)" }}>
            <h3 style={{ margin: "0 0 20px 0", display: "flex", alignItems: "center", gap: "10px" }}>
              🎨 Apariencia del Sistema
            </h3>
            <div style={{ display: "flex", gap: "10px" }}>
              <button 
                onClick={() => toggleTheme("dark")}
                style={{ flex: 1, padding: "15px", borderRadius: "8px", border: theme === "dark" ? "2px solid var(--color-primary)" : "1px solid var(--glass-border)", background: "#0a0a0f", color: "white", cursor: "pointer", fontWeight: "bold" }}
              >
                🌙 Modo Oscuro
              </button>
              <button 
                onClick={() => toggleTheme("light")}
                style={{ flex: 1, padding: "15px", borderRadius: "8px", border: theme === "light" ? "2px solid var(--color-primary)" : "1px solid var(--glass-border)", background: "#f8fafc", color: "#0f172a", cursor: "pointer", fontWeight: "bold" }}
              >
                ☀️ Modo Claro
              </button>
            </div>
          </div>

          <div className="glass-panel" style={{ border: "1px solid #3b82f6" }}>
            <h3 style={{ margin: "0 0 20px 0", color: "#3b82f6", display: "flex", alignItems: "center", gap: "10px" }}>
              🧠 Utilidad y Metas de Venta ERIKA
            </h3>
            <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)", marginBottom: "15px" }}>
              Configura el porcentaje de utilidad objetivo para importaciones y la meta de ventas mensuales del negocio.
            </p>
            <div style={{ marginBottom: "15px" }}>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>% de Utilidad Objetivo (Margen):</label>
              <input 
                type="number" 
                value={targetUtility} 
                onChange={e => setTargetUtility(e.target.value)} 
                style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} 
              />
            </div>
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Meta de Venta Mensual ($):</label>
              <input 
                type="number" 
                value={monthlyGoals} 
                onChange={e => setMonthlyGoals(e.target.value)} 
                style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} 
              />
            </div>
            <button className="btn-primary" onClick={saveUtilityAndGoalsConfig} style={{ width: "100%", background: "transparent", border: "1px solid #3b82f6", color: "#3b82f6" }}>
              💾 Guardar Utilidad y Metas
            </button>
          </div>
      </div>

      {/* Sección: Papelera de Reciclaje */}
      <div className="glass-panel" style={{ marginTop: "30px", border: "1px solid #ef4444" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h3 style={{ margin: 0, color: "#ef4444", display: "flex", alignItems: "center", gap: "10px" }}>
            ♻️ Papelera de Reciclaje (Retención: 33 días)
          </h3>
          <button 
            onClick={fetchTrash} 
            disabled={isLoadingTrash}
            style={{ background: "rgba(239,68,68,0.2)", color: "#ef4444", border: "1px solid #ef4444", padding: "5px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "0.8rem" }}
          >
            {isLoadingTrash ? "Cargando..." : "🔄 Actualizar"}
          </button>
        </div>

        <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)", marginBottom: "15px" }}>
          Los elementos en esta papelera se eliminarán **definitivamente** del sistema después de 33 días en la papelera de manera automática.
        </p>

        <div style={{ maxHeight: "300px", overflowY: "auto", background: "rgba(0,0,0,0.2)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
          {trashItems.length === 0 ? (
            <p style={{ textAlign: "center", padding: "20px", color: "rgba(255,255,255,0.5)", fontSize: "0.9rem", margin: 0 }}>
              La papelera está vacía.
            </p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", textAlign: "left" }}>
              <thead style={{ background: "rgba(255,255,255,0.05)", position: "sticky", top: 0 }}>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                  <th style={{ padding: "10px", color: "rgba(255,255,255,0.7)" }}>Tipo</th>
                  <th style={{ padding: "10px", color: "rgba(255,255,255,0.7)" }}>Nombre / Código</th>
                  <th style={{ padding: "10px", color: "rgba(255,255,255,0.7)" }}>Fecha Eliminado</th>
                  <th style={{ padding: "10px", color: "rgba(255,255,255,0.7)", textAlign: "center" }}>Días Restantes</th>
                  <th style={{ padding: "10px", color: "rgba(255,255,255,0.7)", textAlign: "center" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {trashItems.map((item) => {
                  const daysInTrash = (Date.now() - new Date(item.deleted_at).getTime()) / (1000 * 60 * 60 * 24);
                  const daysRemaining = Math.max(0, Math.ceil(33 - daysInTrash));
                  return (
                    <tr key={`${item.type}-${item.id}`} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <td style={{ padding: "10px" }}>
                        <span style={{
                          padding: "4px 8px",
                          background: item.type === "producto" ? "rgba(59,130,246,0.15)" : item.type === "cliente" ? "rgba(16,185,129,0.15)" : "rgba(234,179,8,0.15)",
                          color: item.type === "producto" ? "#3b82f6" : item.type === "cliente" ? "#10b981" : "#eab308",
                          borderRadius: "4px",
                          fontSize: "0.75rem",
                          fontWeight: "bold",
                          textTransform: "uppercase"
                        }}>
                          {item.type}
                        </span>
                      </td>
                      <td style={{ padding: "10px", fontWeight: "bold" }}>{item.name}</td>
                      <td style={{ padding: "10px" }}>{new Date(item.deleted_at).toLocaleDateString()}</td>
                      <td style={{ padding: "10px", textAlign: "center", fontWeight: "bold", color: daysRemaining <= 5 ? "#ef4444" : "#10b981" }}>
                        {daysRemaining} días
                      </td>
                      <td style={{ padding: "10px", textAlign: "center" }}>
                        <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                          <button
                            onClick={() => handleRestoreTrash(item)}
                            className="btn-primary"
                            style={{
                              background: "rgba(16,185,129,0.15)",
                              border: "1px solid rgba(16,185,129,0.3)",
                              color: "#10b981",
                              fontSize: "0.8rem",
                              padding: "4px 8px",
                            }}
                          >
                            🔄 Restaurar
                          </button>
                          <button
                            onClick={() => handleHardDeleteTrash(item)}
                            className="btn-primary"
                            style={{
                              background: "rgba(239,68,68,0.15)",
                              border: "1px solid rgba(239,68,68,0.3)",
                              color: "#ef4444",
                              fontSize: "0.8rem",
                              padding: "4px 8px",
                            }}
                          >
                            🚨 Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {editingUser && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0, 0, 0, 0.6)",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
          padding: "20px"
        }}>
          <div className="glass-panel animate-fade-in" style={{
            width: "100%",
            maxWidth: "500px",
            padding: "25px",
            border: "1px solid var(--color-primary)",
            display: "flex",
            flexDirection: "column",
            gap: "15px"
          }}>
            <h3 style={{ margin: 0, color: "var(--color-primary)", fontSize: "1.2rem" }}>✏️ Editar Usuario / Personal</h3>
            
            <div>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Nombre:</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                style={{ width: "100%", padding: "10px", borderRadius: "6px", background: "rgba(0,0,0,0.3)", color: "white", border: "1px solid var(--glass-border)" }}
              />
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>PIN:</label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type={showEditUserPinText ? "text" : "password"}
                  value={editPin}
                  onChange={(e) => setEditPin(e.target.value)}
                  style={{ flex: 1, padding: "10px", borderRadius: "6px", background: "rgba(0,0,0,0.3)", color: "white", border: editPin.length >= 4 && systemUsers.some(u => u.pin === editPin && u.id !== editingUser?.id) ? "1px solid #ef4444" : "1px solid var(--glass-border)" }}
                />
                <button
                  type="button"
                  onClick={() => setShowEditUserPinText(!showEditUserPinText)}
                  className="btn-primary"
                  style={{ background: "rgba(255, 255, 255, 0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white", padding: "10px", width: "40px", fontSize: "1rem", display: "flex", alignItems: "center", justifyContent: "center" }}
                  title={showEditUserPinText ? "Ocultar PIN" : "Mostrar PIN"}
                >
                  {showEditUserPinText ? "🙈" : "👁️"}
                </button>
                <button
                  type="button"
                  onClick={handleGenerateEditRandomPin}
                  className="btn-primary"
                  style={{ background: "rgba(59, 130, 246, 0.1)", border: "1px solid #3b82f6", color: "#3b82f6", padding: "10px", fontSize: "0.85rem" }}
                >
                  🔑 Generar
                </button>
              </div>
              {editPin.length >= 4 && systemUsers.some(u => u.pin === editPin && u.id !== editingUser?.id) && (
                <span style={{ color: "#ef4444", fontSize: "0.8rem", marginTop: "4px", display: "block" }}>
                  ⚠️ Este PIN ya está asignado a otro usuario. Elige otro.
                </span>
              )}
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Rol / Puesto:</label>
              <input
                type="text"
                value={editRole}
                onChange={(e) => setEditRole(e.target.value)}
                placeholder="ej. cajero, admin o rol personalizado"
                style={{ width: "100%", padding: "10px", borderRadius: "6px", background: "rgba(0,0,0,0.3)", color: "white", border: "1px solid var(--glass-border)" }}
              />
              <span style={{ fontSize: "0.75rem", opacity: 0.6, marginTop: "4px", display: "block" }}>
                Ingresa roles predefinidos (&apos;admin&apos;, &apos;cajero&apos;) o cualquier rol personalizado que desees asignarle.
              </span>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "8px", fontSize: "0.9rem", color: "var(--color-secondary)" }}>Permisos Rápidos (Plantillas):</label>
              <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setEditPermissions({ pos: true, dashboard: false, caja: true, servicios: false, inventario: false, reportes: false, configuracion: false })}
                  style={{ padding: "6px 12px", fontSize: "0.75rem", background: "rgba(59,130,246,0.15)", border: "1px solid #3b82f6", color: "#3b82f6", borderRadius: "4px", cursor: "pointer" }}
                >
                  💵 Cajero
                </button>
                <button
                  type="button"
                  onClick={() => setEditPermissions({ pos: false, dashboard: false, caja: false, servicios: false, inventario: true, reportes: false, configuracion: false })}
                  style={{ padding: "6px 12px", fontSize: "0.75rem", background: "rgba(245,158,11,0.15)", border: "1px solid #f59e0b", color: "#f59e0b", borderRadius: "4px", cursor: "pointer" }}
                >
                  📦 Almacenista
                </button>
                <button
                  type="button"
                  onClick={() => setEditPermissions({ pos: true, dashboard: true, caja: true, servicios: true, inventario: true, reportes: true, configuracion: true })}
                  style={{ padding: "6px 12px", fontSize: "0.75rem", background: "rgba(16,185,129,0.15)", border: "1px solid #10b981", color: "#10b981", borderRadius: "4px", cursor: "pointer" }}
                >
                  👑 Admin
                </button>
              </div>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "8px", fontSize: "0.9rem", color: "var(--color-secondary)" }}>Permisos de Visibilidad (Módulos):</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", background: "rgba(0,0,0,0.15)", padding: "10px", borderRadius: "6px" }}>
                {[
                  { key: "pos", label: "🛒 Punto de Venta" },
                  { key: "dashboard", label: "📊 Dashboard" },
                  { key: "caja", label: "💵 Arqueo de Caja" },
                  { key: "servicios", label: "📅 Agenda de Servicios" },
                  { key: "inventario", label: "📦 Almacén e Inventario" },
                  { key: "reportes", label: "📈 Reportes e Inteligencia" },
                  { key: "configuracion", label: "⚙️ Configuración" },
                ].map((mod) => (
                  <label key={mod.key} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "0.85rem", color: "white" }}>
                    <input
                      type="checkbox"
                      checked={editPermissions[mod.key] || false}
                      onChange={(e) => setEditPermissions({ ...editPermissions, [mod.key]: e.target.checked })}
                    />
                    {mod.label}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "15px" }}>
              <button
                className="btn-primary"
                onClick={handleSaveEditUser}
                style={{ flex: 1, padding: "10px" }}
              >
                💾 Guardar Cambios
              </button>
              <button
                onClick={() => setEditingUser(null)}
                style={{ flex: 1, padding: "10px", background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "white", borderRadius: "6px", cursor: "pointer" }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0, 0, 0, 0.6)",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
          padding: "20px"
        }}>
          <div className="glass-panel animate-fade-in" style={{
            width: "100%",
            maxWidth: "500px",
            padding: "25px",
            border: "1px solid var(--color-secondary)",
            display: "flex",
            flexDirection: "column",
            gap: "15px"
          }}>
            <h3 style={{ margin: 0, color: "var(--color-secondary)", fontSize: "1.2rem", display: "flex", alignItems: "center", gap: "8px" }}>
              👤 Añadir Nuevo Usuario / Personal
            </h3>
            
            <div>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Nombre:</label>
              <input
                type="text"
                placeholder="Nombre (ej. Juan)"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                style={{ width: "100%", padding: "10px", borderRadius: "6px", background: "rgba(0,0,0,0.3)", color: "white", border: "1px solid var(--glass-border)" }}
              />
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>PIN:</label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type={showNewUserPinText ? "text" : "password"}
                  placeholder="PIN (ej. 4321)"
                  value={newUserPin}
                  onChange={(e) => setNewUserPin(e.target.value)}
                  style={{ flex: 1, padding: "10px", borderRadius: "6px", background: "rgba(0,0,0,0.3)", color: "white", border: newUserPin.length >= 4 && systemUsers.some(u => u.pin === newUserPin) ? "1px solid #ef4444" : "1px solid var(--glass-border)" }}
                />
                <button
                  type="button"
                  onClick={() => setShowNewUserPinText(!showNewUserPinText)}
                  className="btn-primary"
                  style={{ background: "rgba(255, 255, 255, 0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white", padding: "10px", width: "40px", fontSize: "1rem", display: "flex", alignItems: "center", justifyContent: "center" }}
                  title={showNewUserPinText ? "Ocultar PIN" : "Mostrar PIN"}
                >
                  {showNewUserPinText ? "🙈" : "👁️"}
                </button>
                <button
                  type="button"
                  onClick={handleGenerateRandomPin}
                  className="btn-primary"
                  style={{ background: "rgba(59, 130, 246, 0.1)", border: "1px solid #3b82f6", color: "#3b82f6", padding: "10px", fontSize: "0.85rem" }}
                >
                  🔑 Generar
                </button>
              </div>
              {newUserPin.length >= 4 && systemUsers.some(u => u.pin === newUserPin) && (
                <span style={{ color: "#ef4444", fontSize: "0.8rem", marginTop: "4px", display: "block" }}>
                  ⚠️ Este PIN ya está asignado a otro usuario. Elige otro.
                </span>
              )}
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Rol / Puesto:</label>
              <select 
                value={roleType} 
                onChange={e => handleRoleTypeChange(e.target.value)} 
                style={{ width: "100%", padding: "10px", borderRadius: "6px", background: "rgba(0,0,0,0.3)", color: "white", border: "1px solid var(--glass-border)", marginBottom: roleType === "custom" ? "10px" : "0" }}
              >
                <option value="cajero">Cajero</option>
                <option value="admin">Administrador</option>
                <option value="custom">Otro (Personalizado)</option>
              </select>
              {roleType === "custom" && (
                <input 
                  type="text" 
                  placeholder="ej. Supervisor, Vendedor, Contador" 
                  value={customRoleName} 
                  onChange={e => setCustomRoleName(e.target.value)} 
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", background: "rgba(0,0,0,0.3)", color: "white", border: "1px solid var(--color-primary)" }} 
                />
              )}
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "8px", fontSize: "0.9rem", color: "var(--color-secondary)" }}>Permisos Rápidos (Plantillas):</label>
              <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setNewPermissions({ pos: true, dashboard: false, caja: true, servicios: false, inventario: false, reportes: false, configuracion: false })}
                  style={{ padding: "6px 12px", fontSize: "0.75rem", background: "rgba(59,130,246,0.15)", border: "1px solid #3b82f6", color: "#3b82f6", borderRadius: "4px", cursor: "pointer" }}
                >
                  💵 Cajero
                </button>
                <button
                  type="button"
                  onClick={() => setNewPermissions({ pos: false, dashboard: false, caja: false, servicios: false, inventario: true, reportes: false, configuracion: false })}
                  style={{ padding: "6px 12px", fontSize: "0.75rem", background: "rgba(245,158,11,0.15)", border: "1px solid #f59e0b", color: "#f59e0b", borderRadius: "4px", cursor: "pointer" }}
                >
                  📦 Almacenista
                </button>
                <button
                  type="button"
                  onClick={() => setNewPermissions({ pos: true, dashboard: true, caja: true, servicios: true, inventario: true, reportes: true, configuracion: true })}
                  style={{ padding: "6px 12px", fontSize: "0.75rem", background: "rgba(16,185,129,0.15)", border: "1px solid #10b981", color: "#10b981", borderRadius: "4px", cursor: "pointer" }}
                >
                  👑 Admin
                </button>
              </div>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "8px", fontSize: "0.9rem", color: "var(--color-secondary)" }}>Permisos de Visibilidad (Módulos):</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", background: "rgba(0,0,0,0.15)", padding: "10px", borderRadius: "6px" }}>
                {[
                  { key: "pos", label: "🛒 Punto de Venta" },
                  { key: "dashboard", label: "📊 Dashboard" },
                  { key: "caja", label: "💵 Arqueo de Caja" },
                  { key: "servicios", label: "📅 Agenda de Servicios" },
                  { key: "inventario", label: "📦 Almacén e Inventario" },
                  { key: "reportes", label: "📈 Reportes e Inteligencia" },
                  { key: "configuracion", label: "⚙️ Configuración" },
                ].map((mod) => (
                  <label key={mod.key} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "0.85rem", color: "white" }}>
                    <input
                      type="checkbox"
                      checked={newPermissions[mod.key] || false}
                      onChange={(e) => setNewPermissions({ ...newPermissions, [mod.key]: e.target.checked })}
                    />
                    {mod.label}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "15px" }}>
              <button
                className="btn-primary"
                onClick={handleCreateUser}
                style={{ flex: 1, padding: "10px", background: "#10b981", border: "none" }}
              >
                💾 Guardar Usuario
              </button>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewUserName("");
                  setNewUserPin("");
                  setCustomRoleName("");
                  setRoleType("cajero");
                  setNewPermissions({
                    pos: true,
                    dashboard: false,
                    caja: true,
                    servicios: false,
                    inventario: false,
                    reportes: false,
                    configuracion: false
                  });
                }}
                style={{ flex: 1, padding: "10px", background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "white", borderRadius: "6px", cursor: "pointer" }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
