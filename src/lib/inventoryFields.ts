// Columnas editables de `inventory` compartidas por /api/inventory/save y
// /api/inventory/bulk-update. Vive fuera de src/app/api porque los
// archivos route.ts de Next.js solo pueden exportar handlers HTTP
// (GET/POST/...) y un puñado de configuraciones especiales — cualquier
// otro export ahí rompe el build.
export const INVENTORY_ALLOWED_FIELDS = [
  "code", "name", "cost", "price", "stock", "minStock", "location", "supplier",
  "sale_unit", "autoPriced", "priceChanged", "discount_pct", "discount_start_at",
  "discount_end_at", "deleted", "deleted_at",
];

export function pickAllowedFields(fields: Record<string, any>): Record<string, any> {
  const clean: Record<string, any> = {};
  for (const key of INVENTORY_ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) clean[key] = fields[key];
  }
  return clean;
}
