-- ==========================================================
-- CORRECCIÓN: la migración anterior (20260819000000) no cerró
-- completamente cash_sessions ni el RPC increment_customer_balance.
-- ==========================================================
-- Verificado con `npm run check-rls` después de aplicar la migración
-- anterior: credit_transactions quedó bien cerrada, pero cash_sessions
-- seguía aceptando INSERT con la llave anon, y el RPC
-- increment_customer_balance seguía siendo ejecutable por cualquiera.
--
-- Causas:
-- 1. cash_sessions: el DROP POLICY anterior buscaba el nombre exacto
--    "Permitir todo a anonimos en sesiones temporalmente". Si esa política
--    ya tenía otro nombre (o algún carácter distinto) en la base real, el
--    DROP no hizo nada y la política vieja "FOR ALL USING (true)" se quedó
--    activa en paralelo a la nueva — y basta con que UNA política permita
--    la escritura para que se permita.
-- 2. increment_customer_balance: Supabase otorga EXECUTE directo a los
--    roles "anon" y "authenticated" al crear una función (no solo vía
--    PUBLIC). El REVOKE FROM PUBLIC no quita esos permisos directos.
--
-- Este script borra TODAS las políticas existentes en cash_sessions (sin
-- importar su nombre exacto) y las reemplaza por una sola de solo lectura,
-- y revoca el RPC explícitamente de anon/authenticated además de PUBLIC.

DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cash_sessions' LOOP
    EXECUTE format('DROP POLICY %I ON cash_sessions', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE cash_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cash_sessions_select_publico" ON cash_sessions FOR SELECT USING (true);

-- Por si acaso credit_transactions tuviera el mismo problema en otra base
-- (aquí no fue el caso, pero este bloque es seguro de re-correr: si ya solo
-- queda la política de solo-lectura, no hace nada distinto).
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'credit_transactions' LOOP
    IF pol.policyname <> 'credit_transactions_select_publico' THEN
      EXECUTE format('DROP POLICY %I ON credit_transactions', pol.policyname);
    END IF;
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION increment_customer_balance(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_customer_balance(uuid, numeric) TO service_role;

-- ==========================================================
-- RPC de auditoría: lista las políticas RLS reales de la base, para que
-- /api/admin/audit/rls-status pueda mostrar en el panel de administración
-- qué tablas siguen abiertas — sin depender de que alguien se acuerde de
-- correr un script a mano. Solo service_role puede ejecutarla.
-- ==========================================================
CREATE OR REPLACE FUNCTION admin_list_rls_policies()
RETURNS TABLE(table_name text, policy_name text, cmd text, roles text[], qual text, with_check text) AS $$
  SELECT tablename, policyname, cmd, roles::text[], qual, with_check
  FROM pg_policies
  WHERE schemaname = 'public'
  ORDER BY tablename, policyname;
$$ LANGUAGE sql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION admin_list_rls_policies() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_list_rls_policies() TO service_role;

SELECT policyname, cmd, roles FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('cash_sessions', 'credit_transactions');
