-- ==========================================
-- SCRIPT DE ACTUALIZACIÓN (FASE 8)
-- FERRETERÍA ERIKA POS - PROVEEDORES
-- ==========================================
--
-- Ejecuta este código en el "SQL Editor" de tu panel de Supabase.

-- 1. CREAR TABLA DE PROVEEDORES
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  contact_name TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Confirmación visual
SELECT '✅ TABLA DE PROVEEDORES CREADA CON ÉXITO.' as status;
