-- ==========================================
-- SCRIPT DE ACTUALIZACIÓN: SESIONES DE CAJA
-- FERRETERÍA ERIKA POS
-- ==========================================
--
-- Ejecuta este código en el "SQL Editor" de tu panel de Supabase.
-- Este script agrega la columna total_sales para registrar las ventas consolidadas.

ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS total_sales NUMERIC DEFAULT 0;

-- Confirmación visual
SELECT '✅ COLUMNA total_sales AGREGADA EXITOSAMENTE A cash_sessions.' as status;
