-- ==========================================================
-- RPC de auditoría de columnas: para que scripts/check-schema-drift.js
-- pueda comparar, tabla por tabla, las columnas reales de Postgres contra
-- las listas blancas de src/lib/*Fields.ts (quotesFields.ts,
-- inventoryFields.ts, suppliersFields.ts, servicesFields.ts).
--
-- Nace del bug de producción del 2026-08-25: el código de POSModule.tsx
-- y quotesFields.ts asumían columnas de `quotes` (customer_id,
-- discount_pct, apply_iva, notes) que nunca se crearon en la base real.
-- Este RPC es lo que le habría permitido a `npm run check-schema`
-- detectar ese desfase antes de que llegara a producción.
--
-- Mismo patrón que admin_list_rls_policies (20260820000000): SECURITY
-- DEFINER, solo ejecutable por service_role, nunca por anon/authenticated.
-- ==========================================================
CREATE OR REPLACE FUNCTION admin_list_table_columns()
RETURNS TABLE(table_name text, column_name text, data_type text) AS $$
  SELECT table_name, column_name, data_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
  ORDER BY table_name, ordinal_position;
$$ LANGUAGE sql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION admin_list_table_columns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_list_table_columns() TO service_role;
