-- Tabla de Clientes (con Cuentas por Cobrar)
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  rfc TEXT,
  email TEXT,
  company_name TEXT,
  credit_limit NUMERIC NOT NULL DEFAULT 0,
  balance NUMERIC NOT NULL DEFAULT 0, -- Positivo significa que nos deben dinero
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabla de Transacciones de Crédito (Cargos por ventas y Abonos)
CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('charge', 'payment')),
  amount NUMERIC NOT NULL,
  order_id UUID, -- Referencia opcional a un ticket de venta en el POS
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar permisos públicos temporalmente para lectura/escritura sin login
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir todo a anonimos en clientes" ON customers FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir todo a anonimos en transacciones de credito" ON credit_transactions FOR ALL USING (true) WITH CHECK (true);

-- Datos de prueba
INSERT INTO customers (name, phone, credit_limit, balance) VALUES
('Arquitecto Luis Gómez', '5512345678', 15000, 0),
('Taller El Jarocho', '5598765432', 5000, 0);
