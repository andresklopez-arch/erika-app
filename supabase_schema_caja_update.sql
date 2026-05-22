-- ==========================================
-- SCRIPT DE ACTUALIZACIÓN: SESIONES DE CAJA (FASE 2)
-- FERRETERÍA ERIKA POS
-- ==========================================
--
-- Ejecuta este código en el "SQL Editor" de tu panel de Supabase.
-- Este script realiza lo siguiente:
-- 1. Agrega la columna total_sales si no existe.
-- 2. Rellena de forma retrospectiva el total_sales de sesiones pasadas basándose en sus transacciones.
-- 3. Establece políticas RLS estrictas para que las sesiones cerradas no puedan ser alteradas (UPDATE/DELETE).

-- 1. Agregar columna total_sales
ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS total_sales NUMERIC DEFAULT 0;

-- 2. Inicialización retrospectiva (Calcular ventas históricas de sesiones ya cerradas)
UPDATE cash_sessions cs
SET total_sales = COALESCE(
  (
    SELECT SUM(amount)
    FROM cash_transactions ct
    WHERE ct.session_id = cs.id AND ct.type = 'sale'
  ),
  0
)
WHERE cs.total_sales IS NULL OR cs.total_sales = 0;

-- 3. Habilitar RLS y políticas seguras (impedir modificar sesiones cerradas)
ALTER TABLE cash_sessions ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas anteriores si existen
DROP POLICY IF EXISTS "Permitir todo a anonimos en sesiones temporalmente" ON cash_sessions;
DROP POLICY IF EXISTS "Permitir insertar sesiones" ON cash_sessions;
DROP POLICY IF EXISTS "Permitir seleccionar sesiones" ON cash_sessions;
DROP POLICY IF EXISTS "Permitir actualizar sesiones si estan abiertas" ON cash_sessions;
DROP POLICY IF EXISTS "Permitir borrar sesiones si estan abiertas" ON cash_sessions;

-- Crear políticas granulares seguras
CREATE POLICY "Permitir insertar sesiones" ON cash_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "Permitir seleccionar sesiones" ON cash_sessions FOR SELECT USING (true);
CREATE POLICY "Permitir actualizar sesiones si estan abiertas" ON cash_sessions FOR UPDATE USING (status = 'open') WITH CHECK (status = 'open' OR status = 'closed');
CREATE POLICY "Permitir borrar sesiones si estan abiertas" ON cash_sessions FOR DELETE USING (status = 'open');

-- 4. Doble Capa de Seguridad: Trigger para impedir modificaciones físicas en sesiones cerradas
CREATE OR REPLACE FUNCTION check_session_not_closed()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'closed' THEN
    RAISE EXCEPTION 'Operación denegada: No se puede modificar una sesión de caja ya cerrada.';
  END IF;
  
  IF TG_OP = 'DELETE' AND OLD.status = 'closed' THEN
    RAISE EXCEPTION 'Operación denegada: No se puede eliminar una sesión de caja ya cerrada.';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_closed_session_modification ON cash_sessions;
CREATE TRIGGER trg_prevent_closed_session_modification
BEFORE UPDATE OR DELETE ON cash_sessions
FOR EACH ROW
EXECUTE FUNCTION check_session_not_closed();

-- 5. Auditoría de Integridad: Vista para identificar discrepancias entre total_sales y transacciones
CREATE OR REPLACE VIEW v_cash_sessions_audit AS
SELECT 
  cs.id AS session_id,
  cs.opened_at,
  cs.closed_at,
  cs.opened_by,
  cs.status,
  cs.total_sales AS consolidated_total_sales,
  COALESCE(
    (
      SELECT SUM(ct.amount)
      FROM cash_transactions ct
      WHERE ct.session_id = cs.id AND ct.type = 'sale'
    ),
    0
  ) AS transactions_sum_sales,
  (
    cs.total_sales - COALESCE(
      (
        SELECT SUM(ct.amount)
        FROM cash_transactions ct
        WHERE ct.session_id = cs.id AND ct.type = 'sale'
      ),
      0
    )
  ) AS audit_sales_discrepancy
FROM cash_sessions cs;

-- Confirmación visual
SELECT '✅ ACTUALIZACIÓN COMPLETA DE BD: Columna agregada, ventas históricas recalculadas, políticas RLS activadas, trigger de seguridad activo y vista de auditoría de integridad creada.' as status;
