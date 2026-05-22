-- ==========================================
-- SCRIPT DE ACTUALIZACIÓN (FASE 9)
-- FERRETERÍA ERIKA POS - STORAGE (INVOICES)
-- ==========================================
--
-- Ejecuta este código en el "SQL Editor" de tu panel de Supabase.

-- 1. CREAR EL BUCKET "invoices"
INSERT INTO storage.buckets (id, name, public) 
VALUES ('invoices', 'invoices', true)
ON CONFLICT (id) DO NOTHING;

-- 2. CONFIGURAR POLÍTICAS DE ACCESO (Permitir todo de forma temporal para facilidad)
-- Permite lectura pública
CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING (bucket_id = 'invoices');
-- Permite subidas
CREATE POLICY "Public Upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'invoices');
-- Permite actualizaciones
CREATE POLICY "Public Update" ON storage.objects FOR UPDATE USING (bucket_id = 'invoices');

-- Confirmación visual
SELECT '✅ ALMACENAMIENTO DE FACTURAS (STORAGE) CREADO CON ÉXITO.' as status;
