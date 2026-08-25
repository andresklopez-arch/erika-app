// Prueba de regresión de printEscPosBytes() / getOrReconnectBlePrinter() /
// sendBleBytes() (src/utils/bluetoothPrinter.ts) usando un mock de
// navigator.bluetooth -- nace de que, hasta ahora, la parte Bluetooth de la
// impresión nunca tenía ninguna prueba automatizada (solo la lógica de
// emparejamiento de productos, en test-duplicate-name-products.js). El
// bug del 2026-08-25 (varios tickets que nunca revisaban ERIKA_PRINTER_TYPE)
// no lo hubiera atrapado esto, pero SÍ hubiera atrapado, por ejemplo, una
// regresión futura donde sendBleBytes deje de reintentar los 3 métodos de
// escritura, o donde el reconector de dispositivo pre-vinculado se rompa.
//
// Simula: un dispositivo ya vinculado (navigator.bluetooth.getDevices(),
// el camino "silencioso" sin ventana emergente), su GATT conectado, un
// servicio con una característica de escritura válida -- y verifica que
// los bytes que se mandan a imprimir llegan completos y en orden a esa
// característica mock.
//
// Uso: npm run test-bluetooth-print

let failures = 0;
function check(condition, label) {
  if (condition) {
    console.log(`✅ ${label}`);
  } else {
    console.error(`❌ ${label}`);
    failures++;
  }
}

function buildMockPrinter() {
  const writtenChunks = [];

  const mockChar = {
    uuid: "0000fff2-0000-1000-8000-00805f9b34fb", // coincide con KNOWN_PATTERNS ("fff2")
    properties: { write: true, writeWithoutResponse: false },
    writeValueWithResponse: async (chunk) => {
      writtenChunks.push(Uint8Array.from(chunk));
    },
  };

  const mockService = {
    getCharacteristics: async () => [mockChar],
  };

  // En la API real de Web Bluetooth, device.gatt ES el servidor GATT (tiene
  // tanto connect()/disconnect() como getPrimaryServices() en el mismo
  // objeto) -- reconnectGattServer() en bluetoothPrinter.ts devuelve
  // device.gatt directo cuando ya está conectado, sin llamar a .connect().
  const mockDevice = {
    name: "EC-MP-300 (mock)",
    gatt: {
      connected: true,
      connect: async function () { return this; },
      disconnect: () => {},
      getPrimaryServices: async () => [mockService],
    },
  };

  mockChar.service = { device: mockDevice };

  return { mockDevice, writtenChunks };
}

async function main() {
  const { mockDevice, writtenChunks } = buildMockPrinter();

  // getOrReconnectBlePrinter() revisa `typeof window === "undefined"` antes que
  // nada -- en Node no existe por defecto, así que hay que simularlo. Y
  // Node 21+ ya trae su PROPIO `navigator` global de solo lectura (getter
  // sin setter, ver navigator.userAgent) -- una asignación normal
  // (`global.navigator = {...}`) se ignora en silencio y el mock nunca
  // aplica, así que hay que reemplazar la propiedad completa con
  // Object.defineProperty.
  global.window = global.window || {};
  Object.defineProperty(globalThis, "navigator", {
    value: { bluetooth: { getDevices: async () => [mockDevice] } },
    configurable: true,
    writable: true,
  });

  const { printEscPosBytes } = require("../src/utils/bluetoothPrinter.ts");

  const testBytes = new TextEncoder().encode("HOLA MUNDO - TICKET DE PRUEBA\n");
  const result = await printEscPosBytes(testBytes, 10, 0);

  check(result.success === true, "printEscPosBytes() reporta éxito con un dispositivo pre-vinculado simulado");

  const totalWritten = writtenChunks.reduce((sum, c) => sum + c.length, 0);
  check(totalWritten === testBytes.length, `Se escribieron ${totalWritten} de ${testBytes.length} bytes esperados`);

  const reconstructed = new Uint8Array(totalWritten);
  let offset = 0;
  for (const chunk of writtenChunks) {
    reconstructed.set(chunk, offset);
    offset += chunk.length;
  }
  check(
    Buffer.from(reconstructed).equals(Buffer.from(testBytes)),
    "Los bytes reconstruidos desde los chunks recibidos coinciden EXACTO con el mensaje original (orden y contenido)",
  );

  check(writtenChunks.length === Math.ceil(testBytes.length / 10), `Se dividió correctamente en ${writtenChunks.length} chunk(s) de tamaño 10`);

  // Caso de falla: sin ningún dispositivo pre-vinculado y sin permiso para
  // pedir uno nuevo (allowRequestDevicePrompt=false dentro de
  // printEscPosBytes no aplica -- pero probamos el caso "no hay
  // dispositivos" para confirmar que printEscPosBytes falla de forma
  // controlada, no que revienta).
  Object.defineProperty(globalThis, "navigator", {
    value: {
      bluetooth: {
        getDevices: async () => [],
        // Sin dispositivo pre-vinculado, printEscPosBytes cae al camino de
        // pedir vinculación nueva (requestDevice) -- en un entorno de
        // pruebas sin navegador real, se simula como cancelada por el
        // usuario (mismo error que Chrome real lanza en ese caso).
        requestDevice: async () => { const e = new Error("cancelada"); e.name = "NotFoundError"; throw e; },
      },
    },
    configurable: true,
    writable: true,
  });
  const failResult = await printEscPosBytes(testBytes, 10, 0);
  check(failResult.success === false && !!failResult.error, "Sin ningún dispositivo vinculado, printEscPosBytes() falla de forma controlada (no revienta)");

  if (failures > 0) {
    console.error(`\n${failures} verificación(es) fallaron.`);
    process.exitCode = 1;
    return;
  }
  console.log("\n✅ Todo correcto: el envío de bytes por Bluetooth (simulado) llega completo y en orden.");
}

main();
