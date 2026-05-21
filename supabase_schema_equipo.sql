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
