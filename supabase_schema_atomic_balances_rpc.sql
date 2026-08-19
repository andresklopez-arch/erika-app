-- Funciones RPC para incrementar/decrementar saldos de forma ATÓMICA
-- (una sola sentencia UPDATE en el servidor de Postgres), en vez del patrón
-- lectura-modificación-escritura usado hasta ahora en el cliente
-- (leer balance -> calcular nuevo valor en JS -> UPDATE con el valor
-- calculado). Ese patrón pierde silenciosamente actualizaciones cuando dos
-- operaciones casi simultáneas (dos cajas, dos pestañas, o el mismo cajero
-- con doble clic) parten del mismo valor "viejo" en memoria: la segunda
-- escritura sobreescribe a la primera en vez de sumarse/restarse a ella.
--
-- Cada función retorna el nuevo saldo ya calculado por el propio Postgres,
-- para que el cliente pueda mostrarlo sin tener que volver a leerlo.

-- 1. Saldo de crédito de clientes (customers.balance)
CREATE OR REPLACE FUNCTION increment_customer_balance(p_customer_id uuid, p_delta numeric)
RETURNS numeric AS $$
DECLARE
  new_balance numeric;
BEGIN
  UPDATE customers
  SET balance = COALESCE(balance, 0) + p_delta
  WHERE id = p_customer_id
  RETURNING balance INTO new_balance;
  RETURN new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Puntos de lealtad de clientes (customers.points)
CREATE OR REPLACE FUNCTION increment_customer_points(p_customer_id uuid, p_delta numeric)
RETURNS numeric AS $$
DECLARE
  new_points numeric;
BEGIN
  UPDATE customers
  SET points = GREATEST(0, COALESCE(points, 0) + p_delta)
  WHERE id = p_customer_id
  RETURNING points INTO new_points;
  RETURN new_points;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Saldo pendiente de un apartado (layaways.balance)
CREATE OR REPLACE FUNCTION increment_layaway_balance(p_layaway_id uuid, p_delta numeric)
RETURNS numeric AS $$
DECLARE
  new_balance numeric;
BEGIN
  UPDATE layaways
  SET balance = GREATEST(0, COALESCE(balance, 0) + p_delta)
  WHERE id = p_layaway_id
  RETURNING balance INTO new_balance;
  RETURN new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Saldo pendiente de una cuenta por pagar a proveedor (supplier_debts.balance)
CREATE OR REPLACE FUNCTION increment_supplier_debt_balance(p_debt_id uuid, p_delta numeric)
RETURNS numeric AS $$
DECLARE
  new_balance numeric;
BEGIN
  UPDATE supplier_debts
  SET balance = GREATEST(0, COALESCE(balance, 0) + p_delta)
  WHERE id = p_debt_id
  RETURNING balance INTO new_balance;
  RETURN new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Confirmación visual
SELECT '✅ FUNCIONES RPC DE SALDOS ATÓMICOS LISTAS.' as status;
