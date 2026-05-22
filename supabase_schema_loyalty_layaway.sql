-- ==========================================
-- SCRIPT DE ACTUALIZACIÓN (FASE 13)
-- FERRETERÍA ERIKA POS - LEALTAD Y APARTADOS
-- ==========================================

-- 1. PUNTOS DE LEALTAD
ALTER TABLE customers ADD COLUMN IF NOT EXISTS points NUMERIC DEFAULT 0;

-- 2. TABLA DE APARTADOS (LAYAWAYS)
CREATE TABLE IF NOT EXISTS layaways (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  customer_name TEXT,
  total_amount NUMERIC NOT NULL,
  down_payment NUMERIC NOT NULL,
  balance NUMERIC NOT NULL,
  due_date DATE,
  items JSONB NOT NULL, -- Los productos apartados
  status TEXT DEFAULT 'pending', -- pending, completed, cancelled
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Confirmación visual
SELECT '✅ TABLAS DE LEALTAD Y APARTADOS CREADAS CON ÉXITO.' as status;
