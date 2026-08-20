-- ==========================================================
-- CIERRE DE POLÍTICA RLS ABIERTA: customers
-- ==========================================================
-- customers tenía "FOR ALL USING (true)": cualquiera con la consola del
-- navegador abierta podía crear clientes falsos, o peor, subirle el
-- credit_limit a cualquier cliente real directamente — lo cual además
-- hacía inútil la validación de sobregiro que ya se agregó a
-- /api/credit/charge, porque ese límite se podía inflar desde fuera antes
-- de intentar el cargo.
--
-- Mismo patrón que las migraciones anteriores: se borran TODAS las
-- políticas existentes por su nombre real y se deja solo lectura pública
-- (usada en toda la UI para listar/buscar clientes). Las escrituras ahora
-- pasan por /api/customers/save, /api/customers/delete y
-- /api/customers/points.

DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'customers' LOOP
    EXECUTE format('DROP POLICY %I ON customers', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers_select_publico" ON customers FOR SELECT USING (true);

-- Igual que con increment_customer_balance: increment_customer_points es
-- SECURITY DEFINER y Supabase le da EXECUTE directo a anon/authenticated
-- al crearla, así que cualquiera podía regalarse puntos de lealtad
-- infinitos sin pasar por ninguna compra real.
REVOKE EXECUTE ON FUNCTION increment_customer_points(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_customer_points(uuid, numeric) TO service_role;

SELECT policyname, cmd, roles FROM pg_policies WHERE schemaname = 'public' AND tablename = 'customers';
