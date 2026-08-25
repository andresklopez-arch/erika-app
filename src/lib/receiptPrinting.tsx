// Ticket de abono de apartado, compartido entre LayawaysModule.tsx (vista de
// página) y LayawayModal.tsx (modal embebido) — antes vivía duplicado byte
// por byte en ambos archivos, así que cualquier ajuste al formato del
// comprobante (o a la config de copia doble) había que hacerlo dos veces.

import { printEscPosBytes, sanitizeForThermal } from "../utils/bluetoothPrinter";
import { LoggerService } from "../services/loggerService";
import { showPrintFailureToast } from "./printFailureToast";

export interface AbonoReceiptData {
  businessName: string;
  customerName: string;
  payment: number;
  newBalance: number;
  isCompleted: boolean;
}

export function isDoubleCopyEnabled(config: Record<string, unknown> | undefined | null): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    (config as any)?.printer_double_copy ||
    (config as any)?.printer_double_copy_layaway_credit ||
    localStorage.getItem("ERIKA_PRINTER_DOUBLE_COPY") === "true" ||
    localStorage.getItem("ERIKA_DOUBLE_TICKET") === "true"
  );
}

function renderAbonoBody(data: AbonoReceiptData, isCopyFlag: boolean): string {
  return `
    ${isCopyFlag ? `<div class="center bold" style="border: 2px dashed #000; padding: 4px; margin-bottom: 8px; background: #eee;">*** COPIA PARA EL NEGOCIO ***</div>` : ""}
    <div class="center bold" style="font-size: 16px; margin-bottom: 5px;">${data.businessName.toUpperCase()}</div>
    <div class="center" style="font-size: 12px;">Comprobante de Abono</div>
    <div class="divider"></div>
    <div style="font-size: 12px; margin-bottom: 5px;">Fecha: ${new Date().toLocaleString()}</div>
    <div style="font-size: 12px; margin-bottom: 5px;">Cliente: ${data.customerName}</div>
    <div class="divider"></div>
    <div style="display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 5px;">
      <div>Abono Recibido:</div>
      <div class="bold">$${data.payment.toFixed(2)}</div>
    </div>
    <div style="display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 5px;">
      <div>Saldo Restante:</div>
      <div class="bold">$${data.newBalance.toFixed(2)}</div>
    </div>
    <div class="divider"></div>
    <div class="center bold" style="font-size: 12px; margin-top: 10px;">
      ${data.isCompleted ? "¡APARTADO LIQUIDADO!" : "¡Gracias por su abono!"}
    </div>
  `;
}

export function buildAbonoReceiptHtml(data: AbonoReceiptData, doubleCopyEnabled: boolean): string {
  const body = doubleCopyEnabled
    ? `${renderAbonoBody(data, false)}<div style="page-break-after: always; border-bottom: 2px dashed #000; margin: 15px 0;"></div>${renderAbonoBody(data, true)}`
    : renderAbonoBody(data, false);

  return `
    <html>
      <head>
        <style>
          body { font-family: 'Courier New', Courier, monospace; margin: 0; padding: 10px; width: 58mm; color: #000; background: #fff; }
          .center { text-align: center; }
          .divider { border-bottom: 1px dashed #000; margin: 10px 0; }
          .bold { font-weight: bold; }
        </style>
      </head>
      <body>${body}</body>
    </html>
  `;
}

function buildAbonoEscPosBytes(data: AbonoReceiptData, doubleCopyEnabled: boolean): Uint8Array {
  const paperSize = typeof window !== "undefined" ? localStorage.getItem("ERIKA_PRINTER_PAPER_SIZE") || "80mm" : "80mm";
  const maxCols = paperSize === "58mm" ? 30 : 42;
  const divider = "-".repeat(maxCols) + "\n";

  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const write = (b: number[]) => chunks.push(new Uint8Array(b));
  const writeText = (t: string) => chunks.push(encoder.encode(sanitizeForThermal(t)));
  const formatRow = (label: string, value: string) => {
    const spaces = maxCols - label.length - value.length;
    return label + (spaces > 0 ? " ".repeat(spaces) : " ") + value + "\n";
  };

  const writeCopy = (isCopyFlag: boolean) => {
    if (isCopyFlag) {
      write([0x1b, 0x61, 0x01]);
      write([0x1b, 0x45, 0x01]);
      writeText("*** COPIA PARA EL NEGOCIO ***\n");
      write([0x1b, 0x45, 0x00]);
    }
    write([0x1b, 0x61, 0x01]);
    write([0x1b, 0x45, 0x01]);
    writeText(`${data.businessName.toUpperCase()}\n`);
    write([0x1b, 0x45, 0x00]);
    writeText("Comprobante de Abono\n");
    writeText(divider);

    write([0x1b, 0x61, 0x00]);
    writeText(`Fecha: ${new Date().toLocaleString()}\n`);
    writeText(`Cliente: ${data.customerName}\n`);
    writeText(divider);

    writeText(formatRow("Abono Recibido:", `$${data.payment.toFixed(2)}`));
    writeText(formatRow("Saldo Restante:", `$${data.newBalance.toFixed(2)}`));
    writeText(divider);

    write([0x1b, 0x61, 0x01]);
    writeText(`${data.isCompleted ? "APARTADO LIQUIDADO!" : "Gracias por su abono!"}\n`);
  };

  write([0x1b, 0x40]);
  writeCopy(false);
  if (doubleCopyEnabled) {
    write([0x1b, 0x64, 2]);
    writeCopy(true);
  }

  const bottomLines = typeof window !== "undefined" ? Number(localStorage.getItem("ERIKA_PRINTER_BOTTOM_LINES")) || 1 : 1;
  if (bottomLines > 0) write([0x1b, 0x64, bottomLines]);
  if (typeof window === "undefined" || localStorage.getItem("ERIKA_PRINTER_ENABLE_AUTOCUT") !== "false") {
    write([0x1d, 0x56, 0x41, 0x00]);
  }

  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  chunks.forEach((c) => { bytes.set(c, offset); offset += c.length; });
  return bytes;
}

// Abre la ventana de impresión y dispara print()/close() tras el mismo
// medio segundo de espera que ya usaban ambos componentes (deja tiempo a
// que el navegador termine de pintar el HTML antes del diálogo de impresión).
//
// Igual que "Imprimir Estado" en Clientes y Credito (ver CustomersModule.tsx):
// window.print() no tiene a donde mandar nada si la impresora esta vinculada
// solo por Bluetooth (sin driver de sistema) -- ahora revisa
// ERIKA_PRINTER_TYPE igual que el resto del POS antes de decidir el camino.
export async function printAbonoReceipt(data: AbonoReceiptData, config: Record<string, unknown> | undefined | null): Promise<void> {
  if (typeof window !== "undefined" && localStorage.getItem("ERIKA_PRINTER_TYPE") === "bluetooth") {
    try {
      const chunkSize = Number(localStorage.getItem("ERIKA_PRINTER_BLE_CHUNK_SIZE")) || 20;
      const bytes = buildAbonoEscPosBytes(data, isDoubleCopyEnabled(config));
      const printResult = await printEscPosBytes(bytes, chunkSize, 20);
      if (!printResult.success) {
        showPrintFailureToast(printResult.error, () => printAbonoReceipt(data, config));
        LoggerService.logError("Print_AbonoApartado_Bluetooth", printResult.error);
      }
    } catch (err: any) {
      console.error(err);
      showPrintFailureToast(err.message, () => printAbonoReceipt(data, config));
      LoggerService.logError("Print_AbonoApartado_Bluetooth", err.message);
    }
    return;
  }

  const ticketWindow = window.open("", "_blank", "width=300,height=500");
  if (!ticketWindow) return;

  const html = buildAbonoReceiptHtml(data, isDoubleCopyEnabled(config));
  ticketWindow.document.write(html);
  ticketWindow.document.close();
  setTimeout(() => {
    ticketWindow.print();
    ticketWindow.close();
  }, 500);
}
