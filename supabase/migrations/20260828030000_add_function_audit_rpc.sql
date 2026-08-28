-- ==========================================================
-- RPC de auditoría de funciones: para que scripts/check-rpc-drift.js
-- pueda comparar las funciones RPC que el código llama (`.rpc("nombre")`
-- en toda la app) contra las funciones que realmente existen en Postgres
-- -- mismo espíritu que admin_list_table_columns() (20260825030000) pero
-- para funciones en vez de columnas.
--
-- Nace de una sugerencia tras el incidente del 2026-08-25 (columnas
-- referenciadas por el código que nunca se crearon en la base real): el
-- mismo tipo de desfase puede pasar con una función RPC (renombrada,
-- borrada, o cuya firma de parámetros cambió) y hoy nada lo detecta
-- hasta que un endpoint falla en producción.
--
-- Mismo patrón que admin_list_table_columns / admin_list_rls_policies:
-- SECURITY DEFINER, solo ejecutable por service_role.
-- ==========================================================
CREATE OR REPLACE FUNCTION admin_list_functions()
RETURNS TABLE(function_name text, arguments text) AS $$
  SELECT p.proname::text, pg_get_function_identity_arguments(p.oid)::text
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
  ORDER BY p.proname;
$$ LANGUAGE sql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION admin_list_functions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_list_functions() TO service_role;
