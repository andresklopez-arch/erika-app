-- ==========================================================
-- Código único por producto en `inventory`.
--
-- Nace del mismo bug del 2026-08-25 (POSModule.tsx emparejaba productos
-- por `name`, y 115+ productos del catálogo real comparten nombre a
-- propósito -- distintas presentaciones del mismo artículo, ej.
-- "X-TRONG BLANCO DIRECTO BRILLANTE" en 4 códigos con precio/stock
-- distintos). El fix (src/lib/posItemMatch.ts) ya empareja por `code` en
-- vez de `name` -- este constraint es la red de seguridad del lado de la
-- base de datos: si alguien captura o importa dos productos con el mismo
-- código por error, ESE par volvería a quedar expuesto al bug original
-- (matchesProduct cae de regreso a comparar por nombre cuando falta
-- código, no cuando el código está duplicado).
--
-- Se verificó contra producción antes de escribir esto: cero productos
-- (activos o eliminados) con code vacío/null, cero códigos duplicados
-- entre sí -- así que este índice se puede crear sin migrar datos.
--
-- Índice PARCIAL (no un UNIQUE de columna completo): si en el futuro un
-- producto se captura sin código todavía (el sistema lo permite y
-- matchesProduct() tiene un fallback a nombre justamente para ese caso),
-- un UNIQUE normal bloquearía el segundo producto sin código con un
-- error de "ya existe". La condición WHERE excluye esos casos del
-- constraint -- solo exige unicidad entre códigos que sí se llenaron.
-- ==========================================================
CREATE UNIQUE INDEX IF NOT EXISTS inventory_code_unique_idx
  ON inventory (code)
  WHERE code IS NOT NULL AND code <> '';
