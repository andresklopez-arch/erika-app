-- ==========================================================
-- CIERRA users: la tabla más crítica encontrada en la auditoría general
-- de esta sesión. Su escritura (INSERT/UPDATE/DELETE) seguía abierta a
-- cualquiera con la llave pública ("USING true"), a pesar de que
-- /api/admin/users/route.ts (creado hace tiempo) ya hace todo el CRUD de
-- personal del lado del servidor con verificación de PIN de Administrador,
-- validación con zod y rate limiting.
--
-- Es decir: la app ya no necesitaba la escritura pública desde hace rato,
-- pero la base de datos la seguía permitiendo por fuera de la app —
-- cualquiera con la consola del navegador abierta podía, sin ningún PIN:
--   * crear un usuario nuevo con role: "admin" (acceso total al sistema)
--   * cambiarle el role a "admin" a un usuario existente
--   * borrar cualquier empleado, incluyendo administradores
--
-- No se necesita ningún cambio de código para este cierre — solo la
-- política RLS. La lectura pública se mantiene (equipo/page.tsx, saludos
-- con nombre de usuario, checks de rol en distintas pantallas la usan), y
-- `users` ya no tiene columna `pin` desde hace tiempo (vive en
-- user_credentials, tabla sin acceso desde ningún cliente), así que la
-- lectura pública no expone credenciales.
SELECT admin_reset_table_to_select_only('users');

SELECT policyname, cmd, roles, tablename FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'users';
