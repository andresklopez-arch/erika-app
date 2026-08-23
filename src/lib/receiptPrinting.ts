// Ticket de abono de apartado, compartido entre LayawaysModule.tsx (vista de
// página) y LayawayModal.tsx (modal embebido) — antes vivía duplicado byte
// por byte en ambos archivos, así que cualquier ajuste al formato del
// comprobante (o a la config de copia doble) había que hacerlo dos veces.

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

// Abre la ventana de impresión y dispara print()/close() tras el mismo
// medio segundo de espera que ya usaban ambos componentes (deja tiempo a
// que el navegador termine de pintar el HTML antes del diálogo de impresión).
export function printAbonoReceipt(data: AbonoReceiptData, config: Record<string, unknown> | undefined | null): void {
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
