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

// Todo valor que el código alguna vez escribe en `quotes.status`. Debe
// coincidir exactamente con la restricción quotes_status_check de la base
// de datos (ver supabase/migrations/20260614000000_rls_security_corrections.sql
// y 20260828010000_allow_cancelled_quote_status.sql) -- scripts/test-quote-status-values.js
// prueba cada uno de estos valores contra la base real, así que si se
// agrega un status nuevo aquí sin ampliar también la restricción de la
// base, ese test lo atrapa antes de producción (el bug del 2026-08-24:
// 'cancelled' se usaba en el código desde hacía tiempo pero nunca se
// agregó a la restricción, y cada cancelación fallaba en silencio).
export const QUOTE_STATUS_VALUES = ["pending", "converted", "expired", "ticket", "cancelled"] as const;

export function pickAllowedQuoteFields(fields: Record<string, any>): Record<string, any> {
  const clean: Record<string, any> = {};
  for (const key of QUOTES_ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) clean[key] = fields[key];
  }
  return clean;
}
