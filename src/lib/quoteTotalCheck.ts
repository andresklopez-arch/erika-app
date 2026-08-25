// Detecta si el `total` guardado de una cotización coincide con lo que
// realmente suman sus artículos + el % de descuento/aumento + IVA con los
// que se guardó. Nace del bug real del 2026-08-25: la cotización #113 se
// guardó con total $46.80 (4% de aumento) pero `discount_pct`/`apply_iva`
// no se persistían -- al mandarla a caja se perdía el ajuste y se cobraban
// $45.00. Ver POSModule.tsx (guardar/restaurar cotización) para el fix del
// lado de guardado; esto es la verificación del lado de lectura.
//
// A propósito NO usa getItemFinalPrice/wholesaleRules/smartVolumeRules
// (las reglas de mayoreo/volumen vigentes AHORA) -- esas reglas cambian
// con el tiempo, así que compararlas contra una cotización vieja daría
// falsos positivos cada vez que el negocio ajuste sus reglas de precio.
// `item.price` ya es el precio unitario que quedó fijo en el momento en
// que se guardó la cotización, así que es lo único confiable para esta
// comparación.
export interface QuoteItemLike {
  price: number;
  qty: number;
}

export function computeQuoteExpectedTotal(
  items: QuoteItemLike[],
  discountPct: number,
  applyIva: boolean,
  ivaRate: number = 0.16,
): number {
  const increaseFactor = discountPct < 0 ? 1 + Math.abs(discountPct) / 100 : 1;
  const rawTotal = items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0) * increaseFactor, 0);
  const discountAmount = discountPct < 0 ? 0 : rawTotal * (discountPct / 100);
  const subtotalNeto = rawTotal - discountAmount;
  const iva = applyIva ? subtotalNeto * ivaRate : 0;
  return Math.round(subtotalNeto + iva);
}

export interface QuoteMismatchResult {
  expectedTotal: number;
  storedTotal: number;
  mismatch: boolean;
}

export function getQuoteTotalMismatch(
  quote: { total: number; items: QuoteItemLike[]; discount_pct?: number | null; apply_iva?: boolean | null },
  ivaRate: number = 0.16,
): QuoteMismatchResult {
  const expectedTotal = computeQuoteExpectedTotal(quote.items || [], quote.discount_pct || 0, Boolean(quote.apply_iva), ivaRate);
  const storedTotal = Number(quote.total || 0);
  return {
    expectedTotal,
    storedTotal,
    mismatch: Math.abs(expectedTotal - storedTotal) >= 1,
  };
}
