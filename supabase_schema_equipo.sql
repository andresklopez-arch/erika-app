-- 1. Crear Tabla de Empleados
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'cajero')),
  pin TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Insertar los dos usuarios solicitados
INSERT INTO users (name, role, pin) VALUES 
('Administrador', 'admin', '1111'),
('Cajero Principal', 'cajero', '1234');

-- 3. Habilitar permisos de lectura para el login
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir lectura publica de usuarios" ON users FOR SELECT USING (true);
