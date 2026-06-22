-- Tabla de historial de importaciones ERIKA
-- Ejecutar este SQL en el editor SQL de Supabase Dashboard

CREATE TABLE IF NOT EXISTS import_logs (
  id                  BIGSERIAL PRIMARY KEY,
  imported_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  filename            TEXT,
  total_articles      INT NOT NULL DEFAULT 0,
  new_count           INT NOT NULL DEFAULT 0,
  update_count        INT NOT NULL DEFAULT 0,
  import_option       TEXT,
  suppliers_breakdown JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice por fecha para consultas rápidas de historial
CREATE INDEX IF NOT EXISTS idx_import_logs_imported_at ON import_logs (imported_at DESC);

-- Habilitar RLS (Row Level Security)
ALTER TABLE import_logs ENABLE ROW LEVEL SECURITY;

-- Política: todos los usuarios autenticados pueden leer e insertar
CREATE POLICY "Lectura libre import_logs"
  ON import_logs FOR SELECT USING (true);

CREATE POLICY "Inserción libre import_logs"
  ON import_logs FOR INSERT WITH CHECK (true);
