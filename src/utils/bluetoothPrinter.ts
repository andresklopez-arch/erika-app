/**
 * Utilería centralizada para impresión por Web Bluetooth (GATT BLE) en Erika POS.
 * Resuelve problemas de reconexión GATT Server y gestos de usuario (User Gesture) en navegadores móviles/tablets.
 */

export const KNOWN_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "0000e7e1-0000-1000-8000-00805f9b34fb",
  "0000ae30-0000-1000-8000-00805f9b34fb",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
];

export const KNOWN_PATTERNS = ["e7e2", "ae01", "ae02", "18f1", "2af1", "4954", "ff02"];

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
  const writeChars = characteristics.filter(
    (c) => c.properties && (c.properties.write || c.properties.writeWithoutResponse)
  );
  let char = writeChars.find((c) => {
    const uuidLower = c.uuid.toLowerCase();
    return KNOWN_PATTERNS.some((pat) => uuidLower.includes(pat));
  });
  if (!char) char = writeChars.find((c) => c.properties.writeWithoutResponse);
  if (!char) char = writeChars[0];
  return char;
}

/**
 * Obtiene todas las características de un servidor GATT activo
 */
export async function getCharacteristicsFromGattServer(server: any): Promise<any[]> {
  if (!server) return [];
  const services = await server.getPrimaryServices();
  let allCharacteristics: any[] = [];
  for (const service of services) {
    try {
      const characteristics = await service.getCharacteristics();
      allCharacteristics.push(...characteristics);
    } catch (e) {
      console.warn("[BLE] Error al leer características de servicio:", e);
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

  console.log(`[BLE] Reconectando servidor GATT a "${device.name || "Impresora"}"...`);
  try {
    const server = await device.gatt.connect();
    if (!server || !server.connected) {
      throw new Error("El servidor GATT no reportó estado conectado tras connect().");
    }
    return server;
  } catch (err: any) {
    console.warn("[BLE] Falló primera reconexión GATT, reintentando...", err);
    try {
      device.gatt.disconnect();
    } catch (discErr) {}

    await new Promise((r) => setTimeout(r, 250));
    const server = await device.gatt.connect();
    if (!server || !server.connected) {
      throw new Error("No se pudo reconectar al servidor GATT de la impresora.");
    }
    return server;
  }
}

/**
 * Obtiene o reconecta a una impresora BLE.
 * @param cachedChar Característica guardada previamente
 * @param allowRequestDevicePrompt Si se permite solicitar vinculación mediante ventana del navegador (requiere clic del usuario)
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

  // 2. Intentar reconectar mediante getDevices() (dispositivos pre-vinculados sin necesidad de ventana emergente)
  if ((navigator as any).bluetooth.getDevices) {
    try {
      const devices = await (navigator as any).bluetooth.getDevices();
      if (devices && devices.length > 0) {
        for (const dev of devices) {
          try {
            console.log("[BLE] Intentando conectar a dispositivo pre-vinculado:", dev.name);
            const server = await reconnectGattServer(dev);
            const chars = await getCharacteristicsFromGattServer(server);
            const char = findWriteCharacteristic(chars);
            if (char) {
              return { success: true, char, device: dev };
            }
          } catch (e) {
            console.warn("[BLE] Falló conexión a dispositivo pre-vinculado:", dev.name, e);
          }
        }
      }
    } catch (err) {
      console.warn("[BLE] Error al consultar getDevices():", err);
    }
  }

  // 3. Si no hay dispositivos activos y se autorizó prompt directo (User Gesture)
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
          error: "Dispositivo vinculado pero no se encontró canal de escritura térmico.",
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
          error: "El navegador requiere presionar un botón directamente para vincular por Bluetooth.",
        };
      }
      return { success: false, error: err.message || "Error al solicitar dispositivo Bluetooth." };
    }
  }

  return {
    success: false,
    userGestureRequired: true,
    error: "Impresora Bluetooth desconectada. Toque el botón de reconectar.",
  };
}

/**
 * Transmite un array de bytes por Bluetooth en bloques (chunks) reconectando el GATT server si es necesario
 */
export async function sendBleBytes(
  char: any,
  bytes: Uint8Array,
  chunkSize: number = 20,
  delayMs: number = 20
): Promise<boolean> {
  if (!char) throw new Error("No hay característica Bluetooth válida.");

  let activeChar = char;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);

    const device = activeChar.service?.device;
    if (device && !device.gatt?.connected) {
      console.warn("[BLE] GATT Server desconectado durante envío, reconectando...");
      const server = await reconnectGattServer(device);
      const chars = await getCharacteristicsFromGattServer(server);
      const newChar = findWriteCharacteristic(chars);
      if (newChar) activeChar = newChar;
    }

    try {
      if (activeChar.properties.writeWithoutResponse) {
        await activeChar.writeValueWithoutResponse(chunk);
      } else if (activeChar.properties.write) {
        await activeChar.writeValueWithResponse(chunk);
      } else {
        await activeChar.writeValue(chunk);
      }
    } catch (writeErr: any) {
      console.warn("[BLE] Error al escribir bloque, reintentando con reconexión...", writeErr);
      if (device) {
        const server = await reconnectGattServer(device);
        const chars = await getCharacteristicsFromGattServer(server);
        const newChar = findWriteCharacteristic(chars);
        if (newChar) activeChar = newChar;
      }
      await activeChar.writeValue(chunk);
    }

    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return true;
}
