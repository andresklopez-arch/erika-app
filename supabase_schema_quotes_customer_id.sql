-- Alter table quotes to add customer_id referencing customers(id)
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

-- Confirmación visual
SELECT '✅ COLUMNA customer_id EN quotes CREADA CON ÉXITO.' as status;
