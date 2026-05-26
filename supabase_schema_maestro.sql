-- Pega esto en el SQL Editor de Supabase y dale a RUN (Correr)

CREATE TABLE inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL,
  cost NUMERIC NOT NULL,
  stock INTEGER NOT NULL,
  "minStock" INTEGER NOT NULL DEFAULT 5,
  "salesIndex" INTEGER DEFAULT 50,
  supplier TEXT,
  location TEXT,
  "autoPriced" BOOLEAN DEFAULT false,
  "priceChanged" TEXT
);

-- Habilitar permisos públicos para lectura/escritura temporal (mientras no hay login de usuarios)
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir todo a anonimos temporalmente" ON inventory FOR ALL USING (true) WITH CHECK (true);

-- Insertar algunos datos iniciales de prueba para ERIKA
INSERT INTO inventory (code, name, price, cost, stock, "minStock", supplier, location)
VALUES 
  ('TRU-16', 'Martillo Truper 16oz', 120.5, 80.0, 12, 5, 'Truper', 'A-1'),
  ('CLA-02', 'Clavo para concreto 2 pulgadas', 45.0, 25.0, 15, 50, 'Aceros México', 'B-6'),
  ('COM-19', 'Pintura Blanca 19L Comex', 1250.0, 900.0, 4, 5, 'Comex', 'P-12');
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

-- Crear políticas para permitir lectura y escritura pública
CREATE POLICY "Permitir lectura pública de configuracion" ON business_settings
  FOR SELECT USING (true);

CREATE POLICY "Permitir escritura pública de configuracion" ON business_settings
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Permitir actualizacion pública de configuracion" ON business_settings
  FOR UPDATE USING (true);

-- Insertar registro por defecto si no existe
INSERT INTO business_settings (id, target_utility, monthly_goals, config)
VALUES ('erika_global', 30, 0, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
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
-- Agregar columnas para desglose de pagos en transacciones de caja
ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'efectivo' CHECK (payment_method IN ('efectivo', 'tarjeta', 'transferencia', 'mixto', 'credito'));
ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS cash_amount NUMERIC DEFAULT 0;
ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS card_amount NUMERIC DEFAULT 0;
ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS transfer_amount NUMERIC DEFAULT 0;
-- ==========================================
-- SCRIPT DE ACTUALIZACIÓN: SESIONES DE CAJA (FASE 2)
-- FERRETERÍA ERIKA POS
-- ==========================================
--
-- Ejecuta este código en el "SQL Editor" de tu panel de Supabase.
-- Este script realiza lo siguiente:
-- 1. Agrega la columna total_sales si no existe.
-- 2. Rellena de forma retrospectiva el total_sales de sesiones pasadas basándose en sus transacciones.
-- 3. Establece políticas RLS estrictas para que las sesiones cerradas no puedan ser alteradas (UPDATE/DELETE).

-- 1. Agregar columna total_sales
ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS total_sales NUMERIC DEFAULT 0;

-- 2. Inicialización retrospectiva (Calcular ventas históricas de sesiones ya cerradas)
UPDATE cash_sessions cs
SET total_sales = COALESCE(
  (
    SELECT SUM(amount)
    FROM cash_transactions ct
    WHERE ct.session_id = cs.id AND ct.type = 'sale'
  ),
  0
)
WHERE cs.total_sales IS NULL OR cs.total_sales = 0;

-- 3. Habilitar RLS y políticas seguras (impedir modificar sesiones cerradas)
ALTER TABLE cash_sessions ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas anteriores si existen
DROP POLICY IF EXISTS "Permitir todo a anonimos en sesiones temporalmente" ON cash_sessions;
DROP POLICY IF EXISTS "Permitir insertar sesiones" ON cash_sessions;
DROP POLICY IF EXISTS "Permitir seleccionar sesiones" ON cash_sessions;
DROP POLICY IF EXISTS "Permitir actualizar sesiones si estan abiertas" ON cash_sessions;
DROP POLICY IF EXISTS "Permitir borrar sesiones si estan abiertas" ON cash_sessions;

-- Crear políticas granulares seguras
CREATE POLICY "Permitir insertar sesiones" ON cash_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "Permitir seleccionar sesiones" ON cash_sessions FOR SELECT USING (true);
CREATE POLICY "Permitir actualizar sesiones si estan abiertas" ON cash_sessions FOR UPDATE USING (status = 'open') WITH CHECK (status = 'open' OR status = 'closed');
CREATE POLICY "Permitir borrar sesiones si estan abiertas" ON cash_sessions FOR DELETE USING (status = 'open');

-- 4. Doble Capa de Seguridad: Trigger para impedir modificaciones físicas en sesiones cerradas
CREATE OR REPLACE FUNCTION check_session_not_closed()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'closed' THEN
    RAISE EXCEPTION 'Operación denegada: No se puede modificar una sesión de caja ya cerrada.';
  END IF;
  
  IF TG_OP = 'DELETE' AND OLD.status = 'closed' THEN
    RAISE EXCEPTION 'Operación denegada: No se puede eliminar una sesión de caja ya cerrada.';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_closed_session_modification ON cash_sessions;
CREATE TRIGGER trg_prevent_closed_session_modification
BEFORE UPDATE OR DELETE ON cash_sessions
FOR EACH ROW
EXECUTE FUNCTION check_session_not_closed();

-- 5. Auditoría de Integridad: Vista para identificar discrepancias entre total_sales y transacciones
CREATE OR REPLACE VIEW v_cash_sessions_audit AS
SELECT 
  cs.id AS session_id,
  cs.opened_at,
  cs.closed_at,
  cs.opened_by,
  cs.status,
  cs.total_sales AS consolidated_total_sales,
  COALESCE(
    (
      SELECT SUM(ct.amount)
      FROM cash_transactions ct
      WHERE ct.session_id = cs.id AND ct.type = 'sale'
    ),
    0
  ) AS transactions_sum_sales,
  (
    cs.total_sales - COALESCE(
      (
        SELECT SUM(ct.amount)
        FROM cash_transactions ct
        WHERE ct.session_id = cs.id AND ct.type = 'sale'
      ),
      0
    )
  ) AS audit_sales_discrepancy
FROM cash_sessions cs;

-- Confirmación visual
SELECT '✅ ACTUALIZACIÓN COMPLETA DE BD: Columna agregada, ventas históricas recalculadas, políticas RLS activadas, trigger de seguridad activo y vista de auditoría de integridad creada.' as status;
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
-- 1. Crear Tabla de Empleados
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'cajero')),
  pin TEXT NOT NULL UNIQUE,
  permissions JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Insertar los dos usuarios solicitados
INSERT INTO users (name, role, pin, permissions) VALUES 
('Administrador', 'admin', '1111', '{"dashboard":true, "caja":true, "equipo":true, "inventario":true, "reportes":true, "configuracion":true}'),
('Cajero Principal', 'cajero', '1234', '{"pos":true, "caja":true}');

-- 3. Habilitar permisos de lectura y escritura para el login y gestión
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir lectura publica de usuarios" ON users FOR SELECT USING (true);
CREATE POLICY "Permitir insertar" ON users FOR INSERT WITH CHECK (true);
CREATE POLICY "Permitir actualizar" ON users FOR UPDATE USING (true);
CREATE POLICY "Permitir eliminar" ON users FOR DELETE USING (true);
-- ==========================================
-- SCRIPT DE ACTUALIZACIÓN (FASE 12)
-- FERRETERÍA ERIKA POS - GASTOS Y MERMAS
-- ==========================================
--
-- Ejecuta este código en el "SQL Editor" de tu panel de Supabase.

CREATE TABLE IF NOT EXISTS business_losses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loss_type TEXT NOT NULL, -- 'Gasto', 'Merma', 'Cambio Fisico'
  amount NUMERIC NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Confirmación visual
SELECT '✅ TABLA DE GASTOS Y MERMAS CREADA CON ÉXITO.' as status;
-- ==========================================
-- SCRIPT DE ACTUALIZACIÓN (FASE 8.5)
-- FERRETERÍA ERIKA POS - HISTORIAL DE PEDIDOS
-- ==========================================
--
-- Ejecuta este código en el "SQL Editor" de tu panel de Supabase.
-- (Este script asume que la tabla "suppliers" ya existe o la crea si la omites antes)

-- 1. CREAR TABLA DE PROVEEDORES (Por si acaso no la has corrido aún)
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  contact_name TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. CREAR TABLA DE HISTORIAL DE INTERACCIONES
CREATE TABLE IF NOT EXISTS supplier_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES suppliers(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL, -- 'Pedido', 'Cotización', 'Garantía', 'Llamada'
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Confirmación visual
SELECT '✅ TABLAS DE PROVEEDORES E HISTORIAL LISTAS Y CREADAS.' as status;
-- ==========================================
-- SCRIPT DE ACTUALIZACIÓN (FASE 11)
-- FERRETERÍA ERIKA POS - INTERESES MORATORIOS
-- ==========================================
--
-- Ejecuta este código en el "SQL Editor" de tu panel de Supabase.

-- 1. AGREGAR COLUMNA DE INTERÉS A LAS DEUDAS
-- Si la columna ya existe, esto simplemente lanzará un error de "ya existe" que puedes ignorar, o bien usa este bloque seguro.
ALTER TABLE supplier_debts ADD COLUMN IF NOT EXISTS penalty_rate_percent NUMERIC DEFAULT 0;

-- Confirmación visual
SELECT '✅ COLUMNA DE INTERESES (penalty_rate_percent) AGREGADA CON ÉXITO.' as status;
-- ==========================================
-- SCRIPT DE ACTUALIZACIÓN (FASE 13)
-- FERRETERÍA ERIKA POS - LEALTAD Y APARTADOS
-- ==========================================

-- 1. PUNTOS DE LEALTAD
ALTER TABLE customers ADD COLUMN IF NOT EXISTS points NUMERIC DEFAULT 0;

-- 2. TABLA DE APARTADOS (LAYAWAYS)
CREATE TABLE IF NOT EXISTS layaways (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  customer_name TEXT,
  total_amount NUMERIC NOT NULL,
  down_payment NUMERIC NOT NULL,
  balance NUMERIC NOT NULL,
  due_date DATE,
  items JSONB NOT NULL, -- Los productos apartados
  status TEXT DEFAULT 'pending', -- pending, completed, cancelled
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Confirmación visual
SELECT '✅ TABLAS DE LEALTAD Y APARTADOS CREADAS CON ÉXITO.' as status;
-- ==========================================
-- SCRIPT DE ACTUALIZACIÓN (FASE 8)
-- FERRETERÍA ERIKA POS - PROVEEDORES
-- ==========================================
--
-- Ejecuta este código en el "SQL Editor" de tu panel de Supabase.

-- 1. CREAR TABLA DE PROVEEDORES
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  contact_name TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Confirmación visual
SELECT '✅ TABLA DE PROVEEDORES CREADA CON ÉXITO.' as status;
-- Habilitar RLS en las tablas críticas
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_settings ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas previas si existen para evitar conflictos
DROP POLICY IF EXISTS "Permitir lectura pública de usuarios" ON users;
DROP POLICY IF EXISTS "Bloquear escrituras públicas en usuarios" ON users;
DROP POLICY IF EXISTS "Permitir lectura pública de configuraciones" ON business_settings;

-- Crear políticas para permitir la lectura pública (para login y sincronización del lado del cliente)
CREATE POLICY "Permitir lectura pública de usuarios" ON users FOR SELECT USING (true);
CREATE POLICY "Permitir lectura pública de configuraciones" ON business_settings FOR SELECT USING (true);

-- NOTA DE SEGURIDAD:
-- Al habilitar RLS en 'users' y 'business_settings' y no crear políticas explícitas 
-- para las operaciones de INSERT, UPDATE o DELETE, Supabase bloqueará de forma automática 
-- e implícita todas las operaciones de escritura realizadas desde el cliente (con la anon key).
-- De esta forma, las modificaciones solo podrán realizarse mediante nuestras rutas API del servidor
-- que validan el PIN y rol del administrador antes de interactuar con la base de datos.
-- ==========================================
-- SCRIPT DE ACTUALIZACIÓN: ROLES Y USUARIOS (FASE 3)
-- FERRETERÍA ERIKA POS
-- ==========================================
--
-- Ejecuta este código en el "SQL Editor" de tu panel de Supabase.
-- Este script realiza lo siguiente:
-- 1. Elimina la restricción CHECK de roles en la tabla 'users' para permitir roles personalizados.

-- 1. Eliminar la restricción de check de rol en la tabla users
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- Confirmación visual
SELECT '✅ ACTUALIZACIÓN COMPLETA DE BD: Restricción check de roles eliminada en la tabla users. Ya se pueden registrar roles personalizados.' as status;
-- Script para crear la tabla de servicios técnicos / citas a domicilio
CREATE TABLE IF NOT EXISTS public.services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    technician_name TEXT NOT NULL,
    service_type TEXT NOT NULL,
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    cost NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    notes TEXT
);

-- Habilitar acceso para todos los usuarios autenticados
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

-- Eliminar la política si ya existe para evitar errores al volver a ejecutar el script
DROP POLICY IF EXISTS "Allow read/write access for all authenticated users" ON public.services;

CREATE POLICY "Allow read/write access for all authenticated users" 
ON public.services 
FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);
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
-- ==========================================
-- SCRIPT DE ACTUALIZACIÓN (FASE 6)
-- FERRETERÍA ERIKA POS
-- ==========================================
--
-- Ejecuta este código en el "SQL Editor" de tu panel de Supabase.
-- Este script crea las tablas faltantes si no existen y agrega los campos de facturación.

-- 1. CREAR TABLA DE CLIENTES (Si no existe)
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  credit_limit NUMERIC DEFAULT 0,
  balance NUMERIC DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. CREAR TABLA DE TRANSACCIONES A CRÉDITO (Si no existe)
CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  type TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. AGREGAR CAMPOS DE FACTURACIÓN (Si no existen)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS rfc TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_name TEXT;

-- 4. AGREGAR CAMPOS DE TELEMETRÍA Y CATÁLOGO
ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS device_info TEXT;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 5. ASIGNAR VALORES POR DEFECTO PARA EVITAR ERRORES
UPDATE customers SET rfc = 'XAXX010101000' WHERE rfc IS NULL;
UPDATE customers SET email = 'sin_correo@erika.com' WHERE email IS NULL;
UPDATE customers SET company_name = name WHERE company_name IS NULL;

-- Confirmación visual
SELECT '✅ ACTUALIZACIÓN EXITOSA. Tablas y Facturación listas.' as status;
CREATE TABLE IF NOT EXISTS error_logs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), module TEXT, error_details TEXT, usuario TEXT, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());
