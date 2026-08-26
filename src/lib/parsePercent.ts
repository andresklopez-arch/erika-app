// Parseo compartido para campos de % (discount_pct) capturados como texto.
// Antes cada uno de los 3 sitios que capturan este campo (modal de
// descuento individual, descuento masivo, edición en la tabla de
// InventoryModule.tsx) usaba `parseInt`, que truncaba 10.5% -> 10% aunque
// la columna en la base ya es `numeric` -- ver
// scripts/test-decimal-discount.js para la regresión.
export function parsePercentInput(raw: string): number {
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
