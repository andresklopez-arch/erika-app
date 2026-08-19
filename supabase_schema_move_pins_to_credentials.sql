-- Separa los PIN de personal de la tabla 'users' hacia una tabla nueva
-- 'user_credentials' sin ningún acceso desde el cliente.
--
-- Por qué: 'users' tiene una política RLS "Permitir lectura pública"
-- (necesaria para que la app pueda mostrar nombres/roles/permisos sin
-- pasar por un login real de Supabase Auth). Como esa política es a nivel
-- de FILA, no de columna, cualquier visitante podía leer el PIN de TODOS
-- los usuarios (incluidos administradores) directamente vía la API REST
-- de Supabase con la llave pública (anon), sin necesidad de adivinar nada.
-- A partir de este cambio, el PIN solo se verifica del lado del servidor
-- (rutas /api/auth/login y /api/auth/verify-pin, con la Service Role Key),
-- que ignora RLS por completo — ningún cliente puede leer user_credentials.
--
-- IMPORTANTE: ejecuta este script DESPUÉS de que el código ya esté
-- desplegado (el que usa /api/auth/login y /api/auth/verify-pin), para
-- no dejar una ventana donde el login viejo (que leía users.pin
-- directamente) deje de funcionar antes de que el nuevo esté activo.

-- 1. Crear la tabla de credenciales
CREATE TABLE IF NOT EXISTS user_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pin text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- 2. RLS habilitado, SIN ninguna política = acceso denegado a cualquier
--    cliente autenticado con la llave anon/pública. Solo la Service Role
--    Key (usada exclusivamente en rutas de servidor) puede leer/escribir.
ALTER TABLE user_credentials ENABLE ROW LEVEL SECURITY;

-- 3. Migrar los PIN existentes de 'users' hacia 'user_credentials'
INSERT INTO user_credentials (user_id, pin)
SELECT id, pin FROM users WHERE pin IS NOT NULL
ON CONFLICT (user_id) DO UPDATE SET pin = EXCLUDED.pin;

-- 4. Quitar el PIN de la tabla pública 'users' — a partir de aquí, leer
--    "select * from users" con la llave anon YA NO devuelve ningún PIN.
ALTER TABLE users DROP COLUMN IF EXISTS pin;

-- Confirmación visual
SELECT '✅ PINES MIGRADOS A user_credentials Y RETIRADOS DE users.' as status;
