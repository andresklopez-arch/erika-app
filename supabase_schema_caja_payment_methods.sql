-- Agregar columnas para desglose de pagos en transacciones de caja
ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'efectivo' CHECK (payment_method IN ('efectivo', 'tarjeta', 'transferencia', 'mixto', 'credito'));
ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS cash_amount NUMERIC DEFAULT 0;
ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS card_amount NUMERIC DEFAULT 0;
ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS transfer_amount NUMERIC DEFAULT 0;
