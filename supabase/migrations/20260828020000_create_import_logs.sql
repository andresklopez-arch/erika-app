-- ==========================================================
-- Crea `import_logs` (bitácora de "Carga Inteligente de Inventario").
--
-- Hallazgo del 2026-08-26 (investigando el reporte de Ferretería Erika
-- sobre la importación de pijas): esta tabla NUNCA existió en producción
-- -- SmartImporter.tsx la usa desde hace tiempo (insertUna fila por cada
-- importación, y el botón "Ver Historial" la lee), pero cada intento
-- fallaba con PGRST205 "table not found", atrapado en silencio por su
-- propio try/catch (por diseño: la bitácora es solo informativa, nunca
-- debía bloquear una importación real). Existía un archivo de migración
-- huérfano (create_import_logs.sql, sin el prefijo de fecha de las demás,
-- nunca corrido) con una columna `total_articles` que NO coincide con lo
-- que el código realmente escribe y lee (`total_count`) -- de haberse
-- corrido tal cual, el INSERT habría fallado de todos modos por desfase
-- de esquema. Esta migración lo reemplaza con las columnas exactas que
-- usa el código hoy.
-- ==========================================================
CREATE TABLE IF NOT EXISTS import_logs (
  id                  BIGSERIAL PRIMARY KEY,
  total_count         INT NOT NULL DEFAULT 0,
  new_count           INT NOT NULL DEFAULT 0,
  update_count        INT NOT NULL DEFAULT 0,
  suppliers_breakdown JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_logs_created_at ON import_logs (created_at DESC);

ALTER TABLE import_logs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'import_logs' LOOP
    EXECUTE format('DROP POLICY %I ON import_logs', pol.policyname);
  END LOOP;
END $$;

-- Igual que el resto de tablas "abiertas por diseño" documentadas en
-- AGENTS.md: solo guarda conteos/resumen de proveedores, sin precios ni
-- datos de clientes, y SmartImporter.tsx la escribe/lee directo desde el
-- navegador con la llave pública.
CREATE POLICY "import_logs_select_publico" ON import_logs FOR SELECT USING (true);
CREATE POLICY "import_logs_insert_publico" ON import_logs FOR INSERT WITH CHECK (true);
