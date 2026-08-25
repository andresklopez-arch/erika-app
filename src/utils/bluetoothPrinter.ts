/**
 * Utilería centralizada para impresión por Web Bluetooth (GATT BLE) en Erika POS.
 * Optimizado para compatibilidad total con EC Line EC-MP-300, Windows PC y Android Tablets.
 */

export const KNOWN_SERVICES = [
  "0000fff0-0000-1000-8000-00805f9b34fb", // EC Line EC-MP-300 / Rongta primary service
  "0000ffe0-0000-1000-8000-00805f9b34fb", // EC Line / HM-300 / OEM BLE service
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "000018f0-0000-1000-8000-00805f9b34fb",
  "0000e7e1-0000-1000-8000-00805f9b34fb",
  "0000ae30-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "000018f1-0000-1000-8000-00805f9b34fb",
  "00001800-0000-1000-8000-00805f9b34fb",
  "00001801-0000-1000-8000-00805f9b34fb",
  "0000fee7-0000-1000-8000-00805f9b34fb",
  "0000af00-0000-1000-8000-00805f9b34fb",
  "00001101-0000-1000-8000-00805f9b34fb", // SPP Bluetooth Serial
];

export const KNOWN_PATTERNS = ["fff2", "fff1", "ffe1", "e7e2", "ae01", "ae02", "18f1", "2af1", "4954", "ff02", "ff01", "fee7", "1101"];

/**
 * Limpia un texto para que un ticket ESC/POS lo imprima sin caracteres
 * corruptos -- las impresoras térmicas baratas (EC-MP-300 y similares) no
 * traen tabla de codificación UTF-8, así que acentos/ñ/¡¿ salen como
 * basura si se mandan tal cual. Antes esto vivía copiado (idéntico) en
 * caja/page.tsx y en POSModule.tsx; se centraliza aquí para que cualquier
 * ticket nuevo que se agregue (ej. estado de cuenta de cliente) lo use sin
 * volver a copiar la función.
 */
export function sanitizeForThermal(str: string): string {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // á -> a, é -> e, etc. (quita marcas combinantes tras NFD)
    .replace(/¡/g, "!")
    .replace(/¿/g, "?")
    .replace(/ñ/g, "n")
    .replace(/Ñ/g, "N")
    .replace(/[^\x20-\x7E\r\n\t]/g, ""); // Solo caracteres ASCII estándar
}

export interface BleConnectResult {
  success: boolean;
  char?: any;
  allVendorChars?: any[];
  device?: any;
  error?: string;
  userGestureRequired?: boolean;
  diagInfo?: string;
}

/**
 * Encuentra todas las características de escritura del fabricante excluyendo atributos genéricos del sistema.
 */
export function findAllVendorWriteCharacteristics(characteristics: any[]): any[] {
  if (!characteristics || characteristics.length === 0) return [];

  return characteristics.filter((c) => {
    if (!c.properties || (!c.properties.write && !c.properties.writeWithoutResponse)) return false;
    const uuid = c.uuid.toLowerCase();
    // Excluir atributos genéricos del sistema Bluetooth (Device Name 2a00, Appearance 2a01, GATT 1800, 1801)
    if (uuid.includes("00002a") || uuid.includes("00001800") || uuid.includes("00001801") || uuid.includes("0000180a")) {
      return false;
    }
    return true;
  });
}

/**
 * Encuentra la característica de escritura adecuada dada la lista de características
 */
export function findWriteCharacteristic(characteristics: any[]): any {
  if (!characteristics || characteristics.length === 0) return null;

  const validVendorChars = findAllVendorWriteCharacteristics(characteristics);
  const searchList = validVendorChars.length > 0 ? validVendorChars : characteristics;

  let char = searchList.find((c) => {
    const uuidLower = c.uuid.toLowerCase();
    return KNOWN_PATTERNS.some((pat) => uuidLower.includes(pat));
  });

  if (!char) char = searchList.find((c) => c.properties && c.properties.write);
  if (!char) char = searchList.find((c) => c.properties && c.properties.writeWithoutResponse);
  if (!char) char = searchList[0];

  return char;
}

/**
 * Obtiene todas las características de un servidor GATT activo de forma robusta
 */
export async function getCharacteristicsFromGattServer(server: any): Promise<any[]> {
  if (!server) return [];
  let allCharacteristics: any[] = [];

  try {
    const services = await server.getPrimaryServices();
    for (const service of services) {
      try {
        const characteristics = await service.getCharacteristics();
        allCharacteristics.push(...characteristics);
      } catch (e) {
        console.warn("[BLE] Error al leer características del servicio:", e);
      }
    }
  } catch (err) {
    console.warn("[BLE] getPrimaryServices general falló, buscando servicios conocidos...", err);
    for (const sUuid of KNOWN_SERVICES) {
      try {
        const service = await server.getPrimaryService(sUuid);
        if (service) {
          const characteristics = await service.getCharacteristics();
          allCharacteristics.push(...characteristics);
        }
      } catch (e) {}
    }
  }

  return allCharacteristics;
}

/**
 * Reconecta de forma limpia al servidor GATT de un BluetoothDevice
 */
export async function reconnectGattServer(device: any): Promise<any> {
  if (!device || !device.gatt) {
    throw new Error("Dispositivo inválido o sin soporte GATT.");
  }

  if (device.gatt.connected) {
    return device.gatt;
  }

  console.log(`[BLE] Conectando servidor GATT a "${device.name || "Impresora"}"...`);

  const connectWithTimeout = (timeoutMs: number) => {
    return Promise.race([
      device.gatt.connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Tiempo de espera agotado al conectar por Bluetooth.")), timeoutMs)
      )
    ]);
  };

  try {
    const server: any = await connectWithTimeout(4000);
    if (!server || !server.connected) {
      throw new Error("El servidor GATT no reportó estado conectado tras connect().");
    }
    return server;
  } catch (err: any) {
    console.warn("[BLE] Reintentando conexión GATT tras desvinculación previa...", err);
    try {
      device.gatt.disconnect();
    } catch (discErr) {}

    await new Promise((r) => setTimeout(r, 250));
    const server: any = await connectWithTimeout(3000);
    if (!server || !server.connected) {
      throw new Error("No se pudo conectar con el servicio Bluetooth de la impresora.");
    }
    return server;
  }
}

/**
 * Obtiene o reconecta a una impresora BLE.
 */
export async function getOrReconnectBlePrinter(
  cachedChar?: any,
  allowRequestDevicePrompt: boolean = false
): Promise<BleConnectResult> {
  if (typeof window === "undefined" || !(navigator as any).bluetooth) {
    return {
      success: false,
      error: "Web Bluetooth no está soportado en este navegador. Asegúrese de usar Google Chrome y tener Bluetooth encendido.",
    };
  }

  // 1. Probar característica guardada en caché
  if (cachedChar) {
    const device = cachedChar.service?.device;
    if (device) {
      try {
        const server = await reconnectGattServer(device);
        const chars = await getCharacteristicsFromGattServer(server);
        const vendorChars = findAllVendorWriteCharacteristics(chars);
        const char = findWriteCharacteristic(chars);
        if (char) {
          return { success: true, char, allVendorChars: vendorChars, device };
        }
      } catch (err: any) {
        console.warn("[BLE] No se pudo reutilizar característica guardada:", err);
      }
    }
  }

  // 2. Intentar reconectar mediante getDevices() (dispositivos pre-vinculados sin ventana emergente)
  if ((navigator as any).bluetooth.getDevices) {
    try {
      const devices = await (navigator as any).bluetooth.getDevices();
      if (devices && devices.length > 0) {
        for (const dev of devices) {
          try {
            console.log("[BLE] Reconectando dispositivo pre-vinculado:", dev.name);
            const server = await reconnectGattServer(dev);
            const chars = await getCharacteristicsFromGattServer(server);
            const vendorChars = findAllVendorWriteCharacteristics(chars);
            const char = findWriteCharacteristic(chars);
            if (char) {
              return { success: true, char, allVendorChars: vendorChars, device: dev };
            }
          } catch (e) {
            console.warn("[BLE] Falló reconexión a:", dev.name, e);
          }
        }
      }
    } catch (err) {
      console.warn("[BLE] Error al consultar getDevices():", err);
    }
  }

  // 3. Si se autorizó solicitar dispositivo (User Gesture)
  if (allowRequestDevicePrompt) {
    try {
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: KNOWN_SERVICES,
      });
      const server = await reconnectGattServer(device);
      const chars = await getCharacteristicsFromGattServer(server);
      const vendorChars = findAllVendorWriteCharacteristics(chars);
      const char = findWriteCharacteristic(chars);

      const charUuids = chars.map((c: any) => c.uuid.substring(0, 8)).join(", ");
      const diagInfo = `Dispositivo: ${device.name || "EC-MP-300"}\nCanales detectados (${chars.length}): ${charUuids}`;

      if (!char) {
        return {
          success: false,
          diagInfo,
          error: `Dispositivo '${device.name || "EC-MP-300"}' vinculado pero no se encontró canal de impresión térmico.\n\nDetalles:\n${diagInfo}`,
        };
      }
      return { success: true, char, allVendorChars: vendorChars, device, diagInfo };
    } catch (err: any) {
      console.error("[BLE] Error en requestDevice:", err);
      if (err.name === "NotFoundError") {
        return { success: false, error: "Vinculación cancelada por el usuario." };
      }
      if (err.message && err.message.toLowerCase().includes("user gesture")) {
        return {
          success: false,
          userGestureRequired: true,
          error: "Presione el botón 'Reconectar Impresora' para vincular por Bluetooth.",
        };
      }
      return { success: false, error: err.message || "Error de conexión Bluetooth." };
    }
  }

  return {
    success: false,
    userGestureRequired: true,
    error: "Impresora Bluetooth no conectada. Toque el botón de reconectar.",
  };
}

/**
 * Transmite datos ESC/POS en bloques asegurando transmisión robusta para EC Line EC-MP-300, tablets y PCs.
 */
export async function sendBleBytes(
  char: any,
  bytes: Uint8Array,
  chunkSize: number = 20,
  delayMs: number = 35,
  allVendorCharacteristics?: any[]
): Promise<boolean> {
  if (!char) throw new Error("No hay característica Bluetooth válida.");

  const targets = (allVendorCharacteristics && allVendorCharacteristics.length > 0)
    ? allVendorCharacteristics
    : [char];

  for (const activeChar of targets) {
    let currentChar = activeChar;

    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.slice(i, i + chunkSize);

      const device = currentChar.service?.device;
      if (device && !device.gatt?.connected) {
        console.warn("[BLE] Conexión caída durante transmisión, reconectando...");
        const server = await reconnectGattServer(device);
        const chars = await getCharacteristicsFromGattServer(server);
        const newChar = findWriteCharacteristic(chars);
        if (newChar) currentChar = newChar;
      }

      let written = false;

      // 1. Probar writeValueWithResponse primero (garantizado para EC Line EC-MP-300 en Android/Windows)
      if (currentChar.properties && currentChar.properties.write) {
        try {
          await currentChar.writeValueWithResponse(chunk);
          written = true;
        } catch (errWithResp) {
          console.warn("[BLE] writeValueWithResponse falló, probando writeValueWithoutResponse...", errWithResp);
        }
      }

      // 2. Probar writeValueWithoutResponse
      if (!written && currentChar.properties && currentChar.properties.writeWithoutResponse) {
        try {
          await currentChar.writeValueWithoutResponse(chunk);
          written = true;
        } catch (errNoResp) {
          console.warn("[BLE] writeValueWithoutResponse falló...", errNoResp);
        }
      }

      // 3. Fallback genérico
      if (!written) {
        try {
          await currentChar.writeValue(chunk);
          written = true;
        } catch (fallbackErr) {
          console.warn("[BLE] writeValue (fallback genérico) también falló.", fallbackErr);
        }
      }

      // Si los tres métodos de escritura fallaron, el chunk nunca llegó a la
      // impresora. Antes esto se ignoraba y la función igual devolvía `true`,
      // haciendo creer que el ticket se imprimió completo cuando en realidad
      // quedó parcial o en blanco.
      if (!written) {
        throw new Error("No se pudo enviar un fragmento de datos a la impresora Bluetooth tras 3 intentos.");
      }

      const effectiveDelay = Math.max(30, delayMs);
      await new Promise((r) => setTimeout(r, effectiveDelay));
    }
  }

  return true;
}

export interface PrintEscPosResult {
  success: boolean;
  error?: string;
}

/**
 * Conecta (o reconecta) a la impresora Bluetooth y manda los bytes ya
 * armados por el llamador. Centraliza el patrón de conectar+enviar+manejar
 * error que antes se repetía completo en cada lugar que imprimía un ticket
 * (POSModule.tsx, caja/page.tsx, CustomersModule.tsx, AccountsPayableModal.tsx,
 * lib/receiptPrinting.ts, SettingsModule.tsx) -- lo único que cambia entre
 * ellos es el contenido del ticket (los `bytes`), no cómo se conecta o
 * transmite.
 */
export async function printEscPosBytes(
  bytes: Uint8Array,
  chunkSize: number = 20,
  delayMs: number = 20,
): Promise<PrintEscPosResult> {
  const result = await getOrReconnectBlePrinter(undefined, true);
  if (!result.success || !result.char) {
    return { success: false, error: result.error || "No se pudo conectar a la impresora." };
  }
  try {
    await sendBleBytes(result.char, bytes, chunkSize, delayMs, result.allVendorChars);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Error al transmitir a la impresora." };
  }
}

export type BleStatusType = "connected" | "standby" | "disconnected" | "unsupported";

export function getBleStatus(cachedChar?: any): BleStatusType {
  if (typeof window === "undefined" || !(navigator as any).bluetooth) {
    return "unsupported";
  }
  if (cachedChar?.service?.device?.gatt?.connected) {
    return "connected";
  }
  if (cachedChar?.service?.device) {
    return "standby";
  }
  return "disconnected";
}

/**
 * Inicia un bucle Keep-Alive silencioso que mantiene caliente la conexión Bluetooth GATT en segundo plano
 */
export function startBleKeepAlive(
  getChar: () => any,
  onStatusChange?: (status: BleStatusType, char?: any) => void,
  intervalMs: number = 20000
): () => void {
  if (typeof window === "undefined") return () => {};

  let isRunning = true;

  const timer = setInterval(async () => {
    if (!isRunning) return;
    const currentChar = getChar();
    if (!currentChar) {
      if ((navigator as any).bluetooth?.getDevices) {
        try {
          const devices = await (navigator as any).bluetooth.getDevices();
          if (devices && devices.length > 0) {
            const dev = devices[0];
            if (!dev.gatt?.connected) {
              const server = await reconnectGattServer(dev);
              const chars = await getCharacteristicsFromGattServer(server);
              const newChar = findWriteCharacteristic(chars);
              if (newChar && onStatusChange) {
                onStatusChange("connected", newChar);
                return;
              }
            }
          }
        } catch (e) {}
      }
      if (onStatusChange) onStatusChange(getBleStatus(currentChar), currentChar);
      return;
    }

    const device = currentChar.service?.device;
    if (device && !device.gatt?.connected) {
      console.log("[BLE Keep-Alive] Reconectando silenciosamente servidor GATT en reposo...");
      try {
        const server = await reconnectGattServer(device);
        const chars = await getCharacteristicsFromGattServer(server);
        const newChar = findWriteCharacteristic(chars);
        if (newChar && onStatusChange) {
          onStatusChange("connected", newChar);
        }
      } catch (err) {
        console.warn("[BLE Keep-Alive] Intento de ping silencioso falló:", err);
        if (onStatusChange) onStatusChange("standby", currentChar);
      }
    } else if (device?.gatt?.connected) {
      if (onStatusChange) onStatusChange("connected", currentChar);
    }
  }, intervalMs);

  return () => {
    isRunning = false;
    clearInterval(timer);
  };
}
