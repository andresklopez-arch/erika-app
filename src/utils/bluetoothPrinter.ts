/**
 * Utilería centralizada para impresión por Web Bluetooth (GATT BLE) en Erika POS.
 * Optimizado para compatibilidad total con Windows PC y Android Tablets.
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

export interface BleConnectResult {
  success: boolean;
  char?: any;
  device?: any;
  error?: string;
  userGestureRequired?: boolean;
}

/**
 * Encuentra la característica de escritura adecuada dada la lista de características
 */
export function findWriteCharacteristic(characteristics: any[]): any {
  if (!characteristics || characteristics.length === 0) return null;

  // Filtrar características para EXCLUIR atributos genéricos de Bluetooth SIG (GAP/GATT/Device Name 00002aXX)
  const validVendorChars = characteristics.filter((c) => {
    if (!c.properties || (!c.properties.write && !c.properties.writeWithoutResponse)) return false;
    const uuid = c.uuid.toLowerCase();
    if (uuid.includes("00002a") || uuid.includes("00001800") || uuid.includes("00001801") || uuid.includes("0000180a")) {
      return false;
    }
    return true;
  });

  const searchList = validVendorChars.length > 0 ? validVendorChars : characteristics;

  let char = searchList.find((c) => {
    const uuidLower = c.uuid.toLowerCase();
    return KNOWN_PATTERNS.some((pat) => uuidLower.includes(pat));
  });
  if (!char) char = searchList.find((c) => c.properties && (c.properties.write || c.properties.writeWithoutResponse));
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
  try {
    const server = await device.gatt.connect();
    if (!server || !server.connected) {
      throw new Error("El servidor GATT no reportó estado conectado tras connect().");
    }
    return server;
  } catch (err: any) {
    console.warn("[BLE] Reintentando conexión GATT tras desvinculación previa...", err);
    try {
      device.gatt.disconnect();
    } catch (discErr) {}

    await new Promise((r) => setTimeout(r, 350));
    const server = await device.gatt.connect();
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
        const char = findWriteCharacteristic(chars);
        if (char) {
          return { success: true, char, device };
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
            const char = findWriteCharacteristic(chars);
            if (char) {
              return { success: true, char, device: dev };
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
      const char = findWriteCharacteristic(chars);
      if (!char) {
        return {
          success: false,
          error: "Dispositivo vinculado pero no se encontró canal de impresión térmico.",
        };
      }
      return { success: true, char, device };
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
 * Transmite datos ESC/POS en bloques asegurando transmisión robusta para tablets y PCs.
 */
export async function sendBleBytes(
  char: any,
  bytes: Uint8Array,
  chunkSize: number = 20,
  delayMs: number = 35
): Promise<boolean> {
  if (!char) throw new Error("No hay característica Bluetooth válida.");

  let activeChar = char;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);

    const device = activeChar.service?.device;
    if (device && !device.gatt?.connected) {
      console.warn("[BLE] Conexión caída durante transmisión, reconectando...");
      const server = await reconnectGattServer(device);
      const chars = await getCharacteristicsFromGattServer(server);
      const newChar = findWriteCharacteristic(chars);
      if (newChar) activeChar = newChar;
    }

    let written = false;
    if (activeChar.properties && activeChar.properties.writeWithoutResponse) {
      try {
        await activeChar.writeValueWithoutResponse(chunk);
        written = true;
      } catch (errNoResp) {
        console.warn("[BLE] writeValueWithoutResponse falló, probando writeValueWithResponse...", errNoResp);
      }
    }

    if (!written) {
      try {
        if (activeChar.properties && activeChar.properties.write) {
          await activeChar.writeValueWithResponse(chunk);
        } else {
          await activeChar.writeValue(chunk);
        }
      } catch (writeErr: any) {
        console.warn("[BLE] Reintentando transmisión de bloque tras reconexión...", writeErr);
        if (device) {
          const server = await reconnectGattServer(device);
          const chars = await getCharacteristicsFromGattServer(server);
          const newChar = findWriteCharacteristic(chars);
          if (newChar) {
            activeChar = newChar;
            await activeChar.writeValue(chunk);
          }
        }
      }
    }

    const effectiveDelay = Math.max(30, delayMs);
    await new Promise((r) => setTimeout(r, effectiveDelay));
  }

  return true;
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
