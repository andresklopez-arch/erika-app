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
