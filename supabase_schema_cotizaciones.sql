-- Tabla de Cotizaciones
CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number SERIAL,
  customer_name TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'converted', 'expired')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar permisos públicos temporalmente para lectura/escritura sin login
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir todo a anonimos en cotizaciones" ON quotes FOR ALL USING (true) WITH CHECK (true);
