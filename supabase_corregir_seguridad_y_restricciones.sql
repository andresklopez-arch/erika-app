-- ==========================================================
-- SCRIPT DE CORRECCIÓN GENERAL DE SEGURIDAD (RLS) Y RESTRICCIONES
-- FERRETERÍA ERIKA POS
-- ==========================================================
-- Ejecuta este código en el "SQL Editor" de tu panel de Supabase.

-- 1. CORRECCIÓN DE LA RESTRICCIÓN DE ESTADO EN COTIZACIONES
-- Permite guardar tickets en la tabla 'quotes' durante la venta en caja
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_status_check CHECK (status IN ('pending', 'converted', 'expired', 'ticket'));

-- 2. HABILITAR SEGURIDAD Y PERMISOS PÚBLICOS PARA DEUDAS A PROVEEDORES (CUENTAS POR PAGAR)
ALTER TABLE supplier_debts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo a anonimos en supplier_debts" ON supplier_debts;
CREATE POLICY "Permitir todo a anonimos en supplier_debts" ON supplier_debts FOR ALL USING (true) WITH CHECK (true);

-- 3. HABILITAR SEGURIDAD Y PERMISOS PÚBLICOS PARA ABONOS A PROVEEDORES
ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo a anonimos en supplier_payments" ON supplier_payments;
CREATE POLICY "Permitir todo a anonimos en supplier_payments" ON supplier_payments FOR ALL USING (true) WITH CHECK (true);

-- 4. HABILITAR SEGURIDAD Y PERMISOS PÚBLICOS PARA GASTOS Y MERMAS
ALTER TABLE business_losses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo a anonimos en business_losses" ON business_losses;
CREATE POLICY "Permitir todo a anonimos en business_losses" ON business_losses FOR ALL USING (true) WITH CHECK (true);

-- 5. HABILITAR SEGURIDAD Y PERMISOS PÚBLICOS PARA SERVICIOS TÉCNICOS Y VISITAS
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read/write access for all authenticated users" ON services;
DROP POLICY IF EXISTS "Permitir todo a anonimos en servicios" ON services;
CREATE POLICY "Permitir todo a anonimos en servicios" ON services FOR ALL USING (true) WITH CHECK (true);

-- 6. HABILITAR SEGURIDAD Y PERMISOS PÚBLICOS PARA CLIENTES Y CRÉDITOS
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo a anonimos en clientes" ON customers;
CREATE POLICY "Permitir todo a anonimos en clientes" ON customers FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo a anonimos en transacciones de credito" ON credit_transactions;
CREATE POLICY "Permitir todo a anonimos en transacciones de credito" ON credit_transactions FOR ALL USING (true) WITH CHECK (true);

SELECT '✅ TODAS LAS TABLAS Y POLÍTICAS RLS FUERON CORREGIDAS CON ÉXITO.' as status;
