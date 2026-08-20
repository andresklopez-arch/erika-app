-- ==========================================================
-- CORRECCIÓN: admin_list_function_grants() (creada en 20260824000000)
-- devolvía también las funciones internas de las extensiones pg_trgm y
-- unaccent (gin_trgm_*, gtrgm_*, similarity, unaccent, etc.) — ~35
-- funciones que Supabase deja ejecutables por anon/authenticated de
-- fábrica en TODO proyecto, sin ningún riesgo (son funciones puras de
-- texto, sin acceso a tablas). Se colaban como "ruido" en el panel de
-- Auditoría de Seguridad, ahogando cualquier RPC de negocio real que sí
-- necesite atención.
--
-- Las funciones de extensión están escritas en C; las funciones propias
-- de esta app (reduce_inventory_stock, increment_customer_balance, etc.)
-- están en SQL o plpgsql. Filtrar por lenguaje separa unas de otras sin
-- tener que mantener una lista de nombres a mano.
CREATE OR REPLACE FUNCTION admin_list_function_grants()
RETURNS TABLE(routine_name text, signature text, grantee text) AS $$
  SELECT p.proname::text,
         (p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')::text,
         r.grantee::text
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  JOIN information_schema.routine_privileges r
    ON r.routine_name = p.proname AND r.routine_schema = 'public'
  WHERE n.nspname = 'public'
    AND l.lanname IN ('sql', 'plpgsql')
    AND r.privilege_type = 'EXECUTE'
    AND r.grantee IN ('anon', 'authenticated')
  ORDER BY p.proname, r.grantee;
$$ LANGUAGE sql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION admin_list_function_grants() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_list_function_grants() TO service_role;

SELECT * FROM admin_list_function_grants();
