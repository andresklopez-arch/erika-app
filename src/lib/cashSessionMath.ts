// Lógica de desglose de una venta en efectivo/tarjeta/transferencia,
// compartida entre el cliente (vista de movimientos) y el servidor
// (/api/caja/close, que ahora calcula el corte en vez del navegador).
// Portada tal cual desde caja/page.tsx para no alterar el resultado del
// corte de caja al mover el cálculo al servidor.

export interface CashTransactionLike {
  type: string;
  amount: number;
  cash_amount?: number | null;
  card_amount?: number | null;
  transfer_amount?: number | null;
  description?: string | null;
}

export function getCashAmount(t: CashTransactionLike): number {
  if (t.cash_amount !== undefined && t.cash_amount !== null) {
    return Number(t.cash_amount);
  }
  if (t.description) {
    const match = t.description.match(/\[CASH:([\d.]+)\]/);
    if (match) return parseFloat(match[1]);
    if (t.description.includes("[METODO:tarjeta]") || t.description.includes("[METODO:transferencia]")) {
      return 0;
    }
  }
  return Number(t.amount || 0);
}

export function getCardAmount(t: CashTransactionLike): number {
  if (t.card_amount !== undefined && t.card_amount !== null) {
    return Number(t.card_amount);
  }
  if (t.description) {
    const match = t.description.match(/\[CARD:([\d.]+)\]/);
    if (match) return parseFloat(match[1]);
    if (t.description.includes("[METODO:tarjeta]")) {
      return Number(t.amount || 0);
    }
  }
  return 0;
}

export function getTransferAmount(t: CashTransactionLike): number {
  if (t.transfer_amount !== undefined && t.transfer_amount !== null) {
    return Number(t.transfer_amount);
  }
  if (t.description) {
    const match = t.description.match(/\[TRANS:([\d.]+)\]/);
    if (match) return parseFloat(match[1]);
    if (t.description.includes("[METODO:transferencia]")) {
      return Number(t.amount || 0);
    }
  }
  return 0;
}
