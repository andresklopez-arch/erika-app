-- 1. AGREGAR COLUMNAS PARA EL SOFT DELETE Y PAPELERA
ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE inventory ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT false;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT false;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- 2. TRIGGER DE SEGURIDAD EN CLIENTES (BALANCE > 0)
CREATE OR REPLACE FUNCTION check_customer_balance_before_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.deleted = true AND OLD.balance > 0 THEN
    RAISE EXCEPTION 'No se puede eliminar un cliente con saldo deudor activo ($%)', OLD.balance;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_customer_balance_before_delete ON customers;
CREATE TRIGGER trg_check_customer_balance_before_delete
BEFORE UPDATE ON customers
FOR EACH ROW
EXECUTE FUNCTION check_customer_balance_before_delete();

-- 3. CREACIÓN DE ÍNDICES PARCIALES PARA REGISTROS ACTIVOS
CREATE INDEX IF NOT EXISTS idx_inventory_active ON inventory(id) WHERE deleted IS NOT TRUE;
CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(id) WHERE deleted IS NOT TRUE;
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(id) WHERE deleted IS NOT TRUE;

-- 4. HABILITAR pg_cron Y PROGRAMAR PURGA AUTOMÁTICA EN LA NUBE (A LAS 00:00 DIARIAS)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Eliminar tarea previa si existe para evitar duplicación
SELECT cron.unschedule('erika-recycle-bin-purge');

-- Programar nueva tarea
SELECT cron.schedule(
  'erika-recycle-bin-purge',
  '0 0 * * *', -- Cada medianoche
  $$
  DELETE FROM inventory WHERE deleted = true AND deleted_at < NOW() - INTERVAL '33 days';
  DELETE FROM customers WHERE deleted = true AND deleted_at < NOW() - INTERVAL '33 days';
  DELETE FROM suppliers WHERE deleted = true AND deleted_at < NOW() - INTERVAL '33 days';
  $$
);
