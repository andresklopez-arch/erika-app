-- ==========================================
-- SCRIPT DE ACTUALIZACIÓN (FASE 10)
-- FERRETERÍA ERIKA POS - CUENTAS POR PAGAR
-- ==========================================
--
-- Ejecuta este código en el "SQL Editor" de tu panel de Supabase.

-- 1. CREAR TABLA DE DEUDAS A PROVEEDORES
CREATE TABLE IF NOT EXISTS supplier_debts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES suppliers(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  balance NUMERIC NOT NULL,
  due_date DATE NOT NULL,
  concept TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending', 'paid', 'overdue'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. CREAR TABLA DE ABONOS A PROVEEDORES (Historial de Pagos)
CREATE TABLE IF NOT EXISTS supplier_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id UUID REFERENCES supplier_debts(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  payment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  notes TEXT
);

-- Confirmación visual
SELECT '✅ MÓDULO DE CUENTAS POR PAGAR CREADO CON ÉXITO.' as status;
