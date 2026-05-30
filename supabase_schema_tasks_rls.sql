-- ==========================================================
-- FERRETERÍA ERIKA - CONFIGURACIÓN DE SEGURIDAD (RLS) DE TAREAS
-- ==========================================================
--
-- Ejecuta este script en el "SQL Editor" de tu panel de Supabase.
-- Este script realiza lo siguiente:
-- 1. Habilita RLS (Row Level Security) en la tabla 'internal_tasks'.
-- 2. Crea una política para permitir lectura, inserción, actualización
--    y eliminación a clientes públicos/anónimos para que el widget
--    de tareas guarde y liste las tareas correctamente en todas las páginas.

-- 1. Asegurar que RLS esté habilitado
ALTER TABLE public.internal_tasks ENABLE ROW LEVEL SECURITY;

-- 2. Eliminar la política si ya existía para evitar colisiones
DROP POLICY IF EXISTS "Permitir todo a anonimos en tareas" ON public.internal_tasks;

-- 3. Crear política para acceso completo (Lectura, Escritura, Borrado)
CREATE POLICY "Permitir todo a anonimos en tareas" 
ON public.internal_tasks 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Confirmación visual
SELECT '✅ Políticas RLS de internal_tasks configuradas con éxito. Las tareas ya pueden guardarse desde cualquier dispositivo.' as status;
