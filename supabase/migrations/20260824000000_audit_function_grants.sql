-- ==========================================================
-- El panel de Auditoría de Seguridad solo mostraba tablas (RLS), nunca
-- funciones RPC — un RPC como reduce_inventory_stock puede seguir abierto
-- a anon/authenticated aunque su tabla ya esté cerrada (exactamente el
-- problema que se encontró y cerró hoy). Esta función expone qué RPCs de
-- `public` siguen siendo ejecutables por anon/authenticated.
-- ==========================================================
-- Incluye la firma completa (tipos de parámetros) en `signature`, no solo
-- el nombre — REVOKE/GRANT ON FUNCTION necesitan la firma exacta, y así el
-- panel puede armar el SQL de cierre completo sin que el usuario tenga que
-- ir a buscarla aparte.
CREATE OR REPLACE FUNCTION admin_list_function_grants()
RETURNS TABLE(routine_name text, signature text, grantee text) AS $$
  SELECT p.proname::text,
         (p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')::text,
         r.grantee::text
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN information_schema.routine_privileges r
    ON r.routine_name = p.proname AND r.routine_schema = 'public'
  WHERE n.nspname = 'public'
    AND r.privilege_type = 'EXECUTE'
    AND r.grantee IN ('anon', 'authenticated')
  ORDER BY p.proname, r.grantee;
$$ LANGUAGE sql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION admin_list_function_grants() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_list_function_grants() TO service_role;

SELECT * FROM admin_list_function_grants();
