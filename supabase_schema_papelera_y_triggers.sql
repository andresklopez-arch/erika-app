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
