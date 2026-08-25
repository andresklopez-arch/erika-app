-- ==========================================================
-- discount_pct / apply_iva en `layaways`.
--
-- Auditoría tras el bug real de cotizaciones del 2026-08-25 (ver
-- 20260825020000_fix_missing_quotes_columns.sql): se revisó si los
-- apartados tenían el mismo riesgo -- guardar `total_amount` ya con el
-- ajuste aplicado, pero sin persistir CON QUÉ ajuste se calculó.
--
-- Conclusión: NO es un bug activo como el de cotizaciones. Un apartado
-- nunca vuelve a recalcular su total desde `items` (a diferencia de una
-- cotización que se "recarga" al carrito para cobrarse) -- el abono
-- descuenta directo de `balance`, así que `total_amount` se queda
-- correcto para siempre una vez creado. Aun así, se agregan estas
-- columnas por consistencia con `quotes` y para no perder esa
-- trazabilidad si en el futuro se agrega una función de "editar/recargar
-- apartado al carrito".
-- ==========================================================
ALTER TABLE layaways ADD COLUMN IF NOT EXISTS discount_pct numeric DEFAULT 0;
ALTER TABLE layaways ADD COLUMN IF NOT EXISTS apply_iva boolean DEFAULT false;
