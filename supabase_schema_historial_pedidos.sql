-- ==========================================
-- SCRIPT DE ACTUALIZACIÓN (FASE 8.5)
-- FERRETERÍA ERIKA POS - HISTORIAL DE PEDIDOS
-- ==========================================
--
-- Ejecuta este código en el "SQL Editor" de tu panel de Supabase.
-- (Este script asume que la tabla "suppliers" ya existe o la crea si la omites antes)

-- 1. CREAR TABLA DE PROVEEDORES (Por si acaso no la has corrido aún)
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  contact_name TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. CREAR TABLA DE HISTORIAL DE INTERACCIONES
CREATE TABLE IF NOT EXISTS supplier_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES suppliers(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL, -- 'Pedido', 'Cotización', 'Garantía', 'Llamada'
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Confirmación visual
SELECT '✅ TABLAS DE PROVEEDORES E HISTORIAL LISTAS Y CREADAS.' as status;
