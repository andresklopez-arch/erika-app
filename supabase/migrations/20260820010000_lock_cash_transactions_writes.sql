-- ==========================================================
-- CIERRE DE POLÍTICA RLS ABIERTA: cash_transactions
-- ==========================================================
-- Última pieza de la caja: cash_transactions tenía "FOR ALL USING (true)",
-- así que cualquiera con la consola del navegador abierta podía forjar
-- ventas, ingresos o retiros directamente — incluyendo insertar una "venta"
-- falsa para inflar el total esperado del corte, o un "retiro" para sacar
-- dinero del registro contable sin que ese dinero saliera nunca de la caja
-- física.
--
-- Igual que con cash_sessions/credit_transactions: se usa un DO block que
-- borra TODAS las políticas existentes por nombre real (no se asume el
-- nombre exacto de la política vieja), y se deja solo lectura pública.
--
-- Las escrituras ahora pasan por /api/caja/transaction (usado por
-- registerMovement, el checkout del POS, la devolución, y la
-- sincronización de ventas offline vía src/lib/cashTransactionClient.ts).

DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cash_transactions' LOOP
    EXECUTE format('DROP POLICY %I ON cash_transactions', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE cash_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cash_transactions_select_publico" ON cash_transactions FOR SELECT USING (true);

SELECT policyname, cmd, roles FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cash_transactions';
