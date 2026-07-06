-- Crear tabla de configuración global del negocio
CREATE TABLE IF NOT EXISTS business_settings (
  id TEXT PRIMARY KEY DEFAULT 'erika_global',
  target_utility NUMERIC DEFAULT 30,
  monthly_goals NUMERIC DEFAULT 0,
  config JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar Row Level Security (RLS)
ALTER TABLE business_settings ENABLE ROW LEVEL SECURITY;

-- Crear políticas para permitir lectura y escritura segura
CREATE POLICY "Permitir lectura pública de configuracion" ON business_settings
  FOR SELECT USING (true);

CREATE POLICY "Permitir escritura solo a administradores" ON business_settings
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role = 'admin'
    )
  );

CREATE POLICY "Permitir actualizacion solo a administradores" ON business_settings
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role = 'admin'
    )
  );

-- Insertar registro por defecto si no existe
INSERT INTO business_settings (id, target_utility, monthly_goals, config)
VALUES ('erika_global', 30, 0, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
