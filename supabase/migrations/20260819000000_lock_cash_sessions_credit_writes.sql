-- ==========================================================
-- CIERRE DE POLÍTICAS RLS ABIERTAS: cash_sessions y credit_transactions
-- FERRETERÍA ERIKA POS
-- ==========================================================
-- Antes, ambas tablas tenían "FOR ALL USING (true) WITH CHECK (true)":
-- cualquiera con la llave pública (anon), incluyendo alguien que abra la
-- consola del navegador en la app, podía INSERTAR/ACTUALIZAR/BORRAR
-- directamente — por ejemplo, forjar un cierre de caja con descuadre=0
-- para ocultar un faltante, o insertar/editar abonos y cargos de crédito
-- de cualquier cliente sin pasar por ningún PIN.
--
-- La LECTURA se deja abierta a propósito (mismo alcance de siempre): estos
-- datos ya son visibles para cualquier empleado logueado en la propia UI de
-- la app, cash_sessions además alimenta una suscripción Realtime que
-- depende de que el rol anon pueda hacer SELECT. Lo que se cierra es la
-- ESCRITURA, que es donde vivía el riesgo real de manipulación de dinero.
--
-- Las escrituras ahora solo pasan por /api/caja/open, /api/caja/close,
-- /api/credit/charge y /api/credit/payment, que usan la Service Role Key
-- del servidor (ignora RLS) y validan sesión de usuario / PIN de admin.

ALTER TABLE cash_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo a anonimos en sesiones temporalmente" ON cash_sessions;
DROP POLICY IF EXISTS "cash_sessions_select_publico" ON cash_sessions;
CREATE POLICY "cash_sessions_select_publico" ON cash_sessions FOR SELECT USING (true);
-- Sin política de INSERT/UPDATE/DELETE: bloqueado para anon/authenticated.
-- Solo service_role (usado por las rutas /api/caja/*) puede escribir, ya
-- que ese rol ignora RLS por completo en Supabase.

ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo a anonimos en transacciones de credito" ON credit_transactions;
DROP POLICY IF EXISTS "credit_transactions_select_publico" ON credit_transactions;
CREATE POLICY "credit_transactions_select_publico" ON credit_transactions FOR SELECT USING (true);
-- Igual que arriba: solo /api/credit/charge y /api/credit/payment (Service
-- Role Key) pueden insertar cargos/abonos de ahora en adelante.

-- El saldo de crédito (customers.balance) se movía con la función RPC
-- increment_customer_balance, que es SECURITY DEFINER (ignora RLS de la
-- tabla customers) y por default es ejecutable por CUALQUIERA (PUBLIC),
-- incluyendo anon. Esto significa que aunque credit_transactions quedara
-- perfectamente cerrada, cualquiera podía seguir llamando
-- supabase.rpc('increment_customer_balance', {p_customer_id: <cualquiera>,
-- p_delta: -999999}) directo desde la consola del navegador y descuadrar
-- el saldo real de un cliente sin dejar ningún registro en el historial de
-- transacciones. Se revoca el permiso público y se deja solo para
-- service_role (las nuevas rutas /api/credit/* siguen pudiendo llamarlo).
REVOKE EXECUTE ON FUNCTION increment_customer_balance(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_customer_balance(uuid, numeric) TO service_role;

SELECT '✅ cash_sessions y credit_transactions: escritura cerrada, lectura abierta.' as status;
