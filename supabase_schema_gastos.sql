-- ==========================================
-- SCRIPT DE ACTUALIZACIÓN (FASE 12)
-- FERRETERÍA ERIKA POS - GASTOS Y MERMAS
-- ==========================================
--
-- Ejecuta este código en el "SQL Editor" de tu panel de Supabase.

CREATE TABLE IF NOT EXISTS business_losses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loss_type TEXT NOT NULL, -- 'Gasto', 'Merma', 'Cambio Fisico'
  amount NUMERIC NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Confirmación visual
SELECT '✅ TABLA DE GASTOS Y MERMAS CREADA CON ÉXITO.' as status;
