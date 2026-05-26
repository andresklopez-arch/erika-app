-- ==========================================
-- SCRIPT PARA SOLUCIONAR ERROR AL GUARDAR PROVEEDOR
-- FERRETERÍA ERIKA POS
-- ==========================================
-- El error sucede porque la seguridad a nivel de filas (RLS) bloquea la escritura.
-- Ejecuta esto en el "SQL Editor" de Supabase:

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo proveedores" ON suppliers;
CREATE POLICY "Permitir todo proveedores" ON suppliers FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE supplier_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo historial proveedores" ON supplier_orders;
CREATE POLICY "Permitir todo historial proveedores" ON supplier_orders FOR ALL USING (true) WITH CHECK (true);

SELECT '✅ POLÍTICAS RLS DE PROVEEDORES CREADAS Y CORREGIDAS.' as status;
