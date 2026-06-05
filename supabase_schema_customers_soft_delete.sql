-- Alter table customers to add deleted column for soft deletes
ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT false;

-- Confirmación visual
SELECT '✅ COLUMNA deleted EN customers CREADA CON ÉXITO.' as status;
