-- ==========================================================
-- FIX DE PRODUCCIÓN (2026-08-25): columnas faltantes en `quotes`.
--
-- Diagnóstico: desde el 21/8/2026 23:46 UTC, TODO checkout del POS falla
-- al guardar su ticket en `quotes` (el checkout mismo, el dinero en
-- cash_transactions y el descuento de inventario sí funcionan bien —
-- son caminos aislados). Confirmado insertando directo contra la tabla
-- con la Service Role Key: Postgres devuelve "column ... does not exist"
-- para customer_id, discount_pct, apply_iva, notes, description,
-- customer_phone y whatsapp_sent_at. El código (POSModule.tsx,
-- QuotesModule.tsx, quotesFields.ts, /api/quotes/save) ya asumía estas
-- columnas, pero la migración que debía crearlas nunca se corrió contra
-- producción — ni siquiera existía como archivo para customer_id/
-- discount_pct/apply_iva/notes (solo customer_phone/whatsapp_sent_at
-- tenían un archivo, 20260827000000_add_quotes_whatsapp_columns.sql,
-- fechado a futuro y tampoco corrido).
--
-- Efecto del bug: ningún dato de dinero/inventario se perdió (esos
-- caminos son independientes), pero el detalle de artículos de cada
-- ticket vendido en esos días NO se puede reconstruir — solo vivía en
-- la sesión del navegador del cajero, nunca llegó a la base de datos.
--
-- Esta migración reemplaza (con las mismas columnas, mismos tipos) a
-- 20260827000000_add_quotes_whatsapp_columns.sql — correr aquella
-- después de esta es seguro (usa IF NOT EXISTS, no hace nada).
-- ==========================================================

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS discount_pct numeric DEFAULT 0;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS apply_iva boolean DEFAULT false;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS customer_phone text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS whatsapp_sent_at timestamptz;

-- PostgREST cachea el esquema en memoria; sin este NOTIFY las columnas
-- nuevas existirían en Postgres pero /api/quotes/save (que pasa por la
-- API REST de Supabase) seguiría viendo el error "column ... does not
-- exist" hasta el próximo reinicio automático del cache (hasta unos
-- minutos). Este NOTIFY lo fuerza al instante.
NOTIFY pgrst, 'reload schema';

-- Verificación: confirma que las 7 columnas ya existen.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'quotes'
ORDER BY ordinal_position;
