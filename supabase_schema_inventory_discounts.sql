-- Ejecuta este script en el SQL Editor de Supabase para habilitar la columna de descuentos en el inventario.
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS discount_pct INTEGER DEFAULT 0;
