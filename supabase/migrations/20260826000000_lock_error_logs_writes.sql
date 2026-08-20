-- ==========================================================
-- Cierra `error_logs`. Casi todos los puntos de escritura ya pasaban por
-- un único helper compartido (src/services/loggerService.ts,
-- LoggerService.logError) usado en decenas de pantallas — se movió solo
-- ESE archivo a /api/logs/error en vez de tocar cada llamador uno por
-- uno. Los 4 sitios que escribían error_logs directo sin pasar por el
-- helper (2 en SettingsModule.tsx, 2 en InventoryModule.tsx) ahora
-- también usan LoggerService.logError.
-- ==========================================================
SELECT admin_reset_table_to_select_only('error_logs');

SELECT policyname, cmd, roles, tablename FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'error_logs';
