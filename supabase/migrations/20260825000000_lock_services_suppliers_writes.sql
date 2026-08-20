-- ==========================================================
-- Cierra `services` y `suppliers` — los 14 puntos del navegador que
-- escribían estas tablas directo con la llave pública (alta/edición/
-- papelera de citas de servicio y proveedores, más el renombrado en
-- cascada de suppliers.name -> inventory.supplier) ya se movieron a
-- /api/services/save, /api/services/delete, /api/suppliers/save y
-- /api/suppliers/delete.
-- ==========================================================
SELECT admin_reset_table_to_select_only('services');
SELECT admin_reset_table_to_select_only('suppliers');

SELECT policyname, cmd, roles, tablename FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('services', 'suppliers');
