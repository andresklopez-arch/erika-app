-- ==========================================================
-- SCRIPT DE CORRECCIÓN: COLUMNAS DE SOFT DELETE (DELETED)
-- FERRETERÍA ERIKA POS
-- ==========================================================
-- Ejecuta este código en el "SQL Editor" de tu panel de Supabase.
-- Este script agrega las columnas 'deleted' y 'deleted_at' a las
-- tablas 'customers', 'inventory' y 'suppliers' si no existen,
-- y las inicializa en false para los registros actuales.

-- 1. CORRECCIÓN EN TABLA CLIENTES (CUSTOMERS)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
UPDATE customers SET deleted = false WHERE deleted IS NULL;

-- 2. CORRECCIÓN EN TABLA INVENTARIO (INVENTORY)
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT false;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
UPDATE inventory SET deleted = false WHERE deleted IS NULL;

-- 3. CORRECCIÓN EN TABLA PROVEEDORES (SUPPLIERS)
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT false;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
UPDATE suppliers SET deleted = false WHERE deleted IS NULL;

-- Confirmación visual
SELECT '✅ COLUMNAS DE SOFT DELETE (deleted, deleted_at) AGREGADAS E INICIALIZADAS CON ÉXITO.' as status;
