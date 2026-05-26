-- ==========================================
-- SCRIPT DE ACTUALIZACIÓN: RADAR DE DEMANDA
-- ==========================================
-- Ejecuta esto en el "SQL Editor" de tu Supabase.

CREATE TABLE IF NOT EXISTS lost_sales_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    term TEXT NOT NULL,
    type TEXT NOT NULL, -- 'AGOTADO' o 'NUEVO_PRODUCTO'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar RLS (Seguridad)
ALTER TABLE lost_sales_requests ENABLE ROW LEVEL SECURITY;

-- Permitir inserts y selects (Básico para operaciones internas)
CREATE POLICY "Permitir inserts a todos en lost_sales_requests" 
ON lost_sales_requests FOR INSERT WITH CHECK (true);

CREATE POLICY "Permitir select a todos en lost_sales_requests" 
ON lost_sales_requests FOR SELECT USING (true);
