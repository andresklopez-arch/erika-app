-- ==========================================
-- SCRIPT DE ACTUALIZACIÓN (FASE 6)
-- FERRETERÍA ERIKA POS
-- ==========================================
--
-- Ejecuta este código en el "SQL Editor" de tu panel de Supabase.
-- Este script crea las tablas faltantes si no existen y agrega los campos de facturación.

-- 1. CREAR TABLA DE CLIENTES (Si no existe)
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  credit_limit NUMERIC DEFAULT 0,
  balance NUMERIC DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. CREAR TABLA DE TRANSACCIONES A CRÉDITO (Si no existe)
CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  type TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. AGREGAR CAMPOS DE FACTURACIÓN (Si no existen)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS rfc TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_name TEXT;

-- 4. AGREGAR CAMPOS DE TELEMETRÍA Y CATÁLOGO
ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS device_info TEXT;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 5. ASIGNAR VALORES POR DEFECTO PARA EVITAR ERRORES
UPDATE customers SET rfc = 'XAXX010101000' WHERE rfc IS NULL;
UPDATE customers SET email = 'sin_correo@erika.com' WHERE email IS NULL;
UPDATE customers SET company_name = name WHERE company_name IS NULL;

-- Confirmación visual
SELECT '✅ ACTUALIZACIÓN EXITOSA. Tablas y Facturación listas.' as status;
