-- Tabla para auditar y reclamar facturas a partir de los códigos QR generados
CREATE TABLE IF NOT EXISTS invoice_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID REFERENCES quotes(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  claimed BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar seguridad de nivel de fila (RLS)
ALTER TABLE invoice_claims ENABLE ROW LEVEL SECURITY;

-- Crear políticas para permitir operaciones públicas (necesario ya que la facturación es anónima)
CREATE POLICY "Permitir todo a anonimos en reclamos de factura" ON invoice_claims FOR ALL USING (true) WITH CHECK (true);
