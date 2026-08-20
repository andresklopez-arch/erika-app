-- ==========================================================
-- FUNCIÓN REUTILIZABLE + CIERRE DE LAS ÚLTIMAS TABLAS ABIERTAS:
-- supplier_debts, supplier_payments, layaways, business_losses
-- ==========================================================
-- Mismo patrón usado en las 4 migraciones anteriores (cash_sessions,
-- cash_transactions, credit_transactions, customers), ahora extraído a una
-- función reutilizable para no repetir el bloque DO completo cada vez:
-- borra TODAS las políticas existentes de una tabla (sin depender de
-- adivinar su nombre exacto) y deja una sola política de solo lectura.
CREATE OR REPLACE FUNCTION admin_reset_table_to_select_only(target_table text)
RETURNS void AS $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = target_table LOOP
    EXECUTE format('DROP POLICY %I ON %I', pol.policyname, target_table);
  END LOOP;
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target_table);
  EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (true)', target_table || '_select_publico', target_table);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION admin_reset_table_to_select_only(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_reset_table_to_select_only(text) TO service_role;

-- supplier_debts y supplier_payments se cierran juntas: un abono
-- (supplier_payments) sin su deuda (supplier_debts) real detrás sería un
-- comprobante forjado sin dinero real de por medio, igual que se hizo con
-- credit_transactions + customers.
SELECT admin_reset_table_to_select_only('supplier_debts');
SELECT admin_reset_table_to_select_only('supplier_payments');
SELECT admin_reset_table_to_select_only('layaways');
SELECT admin_reset_table_to_select_only('business_losses');

-- Mismo problema que increment_customer_balance/points: estas dos
-- funciones son SECURITY DEFINER y Supabase les da EXECUTE directo a
-- anon/authenticated al crearlas.
REVOKE EXECUTE ON FUNCTION increment_layaway_balance(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_layaway_balance(uuid, numeric) TO service_role;

REVOKE EXECUTE ON FUNCTION increment_supplier_debt_balance(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_supplier_debt_balance(uuid, numeric) TO service_role;

SELECT policyname, cmd, roles, tablename FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('supplier_debts', 'supplier_payments', 'layaways', 'business_losses')
ORDER BY tablename;
