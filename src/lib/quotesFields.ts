// Columnas editables de `quotes` (cotizaciones, tickets de venta y
// abonos-a-crédito viven todos en esta misma tabla, distinguidos por
// `status`) compartidas por /api/quotes/save. Vive fuera de src/app/api
// porque los archivos route.ts de Next.js solo pueden exportar handlers
// HTTP — cualquier otro export ahí rompe el build.
export const QUOTES_ALLOWED_FIELDS = [
  "customer_name", "customer_id", "customer_phone", "items", "total",
  "status", "discount_pct", "apply_iva", "notes", "description",
  "whatsapp_sent_at",
];

export function pickAllowedQuoteFields(fields: Record<string, any>): Record<string, any> {
  const clean: Record<string, any> = {};
  for (const key of QUOTES_ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) clean[key] = fields[key];
  }
  return clean;
}
