-- 1. Tabla de Sesiones de Caja (Turnos)
CREATE TABLE cash_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opened_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  closed_at TIMESTAMP WITH TIME ZONE,
  opened_by TEXT NOT NULL DEFAULT 'Admin',
  initial_balance NUMERIC NOT NULL,
  expected_balance NUMERIC,
  counted_balance NUMERIC,
  discrepancy NUMERIC,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed'))
);

-- 2. Tabla de Transacciones y Movimientos Físicos de Dinero
CREATE TABLE cash_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES cash_sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('sale', 'deposit', 'withdrawal')),
  amount NUMERIC NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar permisos públicos temporalmente para lectura/escritura sin login
ALTER TABLE cash_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir todo a anonimos en sesiones temporalmente" ON cash_sessions FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE cash_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir todo a anonimos en transacciones temporalmente" ON cash_transactions FOR ALL USING (true) WITH CHECK (true);
