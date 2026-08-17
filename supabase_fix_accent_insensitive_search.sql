-- Corrige la búsqueda de inventario para que ignore acentos.
-- Antes: el texto que escribe el usuario se le quitan los acentos en el
-- cliente (normalizeString) pero se compara contra la columna "name" tal cual
-- está guardada en la base de datos (con acentos). Buscar "valvula" nunca
-- encontraba "Válvula".
--
-- Esta migración agrega una columna generada "name_search" (nombre en
-- minúsculas y sin acentos) con un índice de trigramas, y el código de la app
-- ya está actualizado para buscar contra esa columna en vez de "name".
--
-- Ejecuta este script completo en el SQL Editor de tu proyecto de Supabase.

-- 1. Extensión para quitar acentos (unaccent) y para búsquedas parciales rápidas (pg_trgm)
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. unaccent() no está marcada IMMUTABLE por defecto, y Postgres exige que
--    las columnas generadas usen solo funciones IMMUTABLE. Este wrapper lo resuelve.
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text AS $$
  SELECT unaccent('unaccent', $1)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- 3. Columna generada: se recalcula sola cada vez que cambia "name", no hay
--    que mantenerla a mano ni tocar el código que hace INSERT/UPDATE de productos.
ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS name_search text GENERATED ALWAYS AS (lower(immutable_unaccent(name))) STORED;

-- 4. Índice de trigramas para que la búsqueda parcial (ilike '%texto%') siga siendo rápida.
CREATE INDEX IF NOT EXISTS idx_inventory_name_search_trgm ON inventory USING gin (name_search gin_trgm_ops);
