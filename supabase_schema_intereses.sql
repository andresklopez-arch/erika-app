-- ==========================================
-- SCRIPT DE ACTUALIZACIÓN (FASE 11)
-- FERRETERÍA ERIKA POS - INTERESES MORATORIOS
-- ==========================================
--
-- Ejecuta este código en el "SQL Editor" de tu panel de Supabase.

-- 1. AGREGAR COLUMNA DE INTERÉS A LAS DEUDAS
-- Si la columna ya existe, esto simplemente lanzará un error de "ya existe" que puedes ignorar, o bien usa este bloque seguro.
ALTER TABLE supplier_debts ADD COLUMN IF NOT EXISTS penalty_rate_percent NUMERIC DEFAULT 0;

-- Confirmación visual
SELECT '✅ COLUMNA DE INTERESES (penalty_rate_percent) AGREGADA CON ÉXITO.' as status;
