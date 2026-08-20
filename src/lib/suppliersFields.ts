export const SUPPLIER_ALLOWED_FIELDS = ["name", "contact_name", "phone", "email", "notes", "deleted", "deleted_at"];

export function pickSupplierFields(fields: Record<string, any>): Record<string, any> {
  const clean: Record<string, any> = {};
  for (const key of SUPPLIER_ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) clean[key] = fields[key];
  }
  return clean;
}
