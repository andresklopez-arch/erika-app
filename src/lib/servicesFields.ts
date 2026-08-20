export const SERVICE_ALLOWED_FIELDS = [
  "customer_name", "customer_phone", "technician_name", "service_type",
  "scheduled_at", "cost", "notes", "status", "deleted", "deleted_at",
];

export function pickServiceFields(fields: Record<string, any>): Record<string, any> {
  const clean: Record<string, any> = {};
  for (const key of SERVICE_ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) clean[key] = fields[key];
  }
  return clean;
}
