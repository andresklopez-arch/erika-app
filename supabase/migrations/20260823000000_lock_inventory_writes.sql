-- ==========================================================
-- CIERRA la tabla `inventory` — Etapa 2 del proyecto de inventario. Los 22
-- puntos del navegador que escribían esta tabla directo con la llave
-- pública (alta/edición/borrado de productos, descuentos, fusión de
-- duplicados, deshacer cambios, recepción de mercancía, importación
-- masiva) ya se movieron a /api/inventory/save, /bulk-update, /delete y
-- /bulk-import.
--
-- La Etapa 1 (RPC reduce_inventory_stock, el mecanismo detrás de cada
-- venta/devolución/apartado) ya se cerró en la migración
-- 20260822030000 — este es el cierre final de la tabla en sí.
SELECT admin_reset_table_to_select_only('inventory');

SELECT policyname, cmd, roles, tablename FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'inventory';
