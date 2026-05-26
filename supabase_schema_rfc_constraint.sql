-- ==========================================
-- SCRIPT DE ACTUALIZACIÓN: VALIDACIÓN ESTRICTA DE RFC
-- ==========================================
--
-- Ejecuta este código en el "SQL Editor" de tu panel de Supabase.
-- Este script agrega una regla a nivel de base de datos que impedirá
-- guardar cualquier registro en la tabla de clientes si el RFC
-- no cumple con el formato estándar del SAT (México).

-- 1. Asegurarnos que la extensión de expresiones regulares esté activa (por lo general lo está en Supabase)
-- 2. Agregamos el CONSTRAINT a la tabla "customers"
-- Expresión regular para RFC: 
-- 3 o 4 letras mayúsculas (incluyendo Ñ y &), seguidas de 6 números (AAMMDD),
-- y opcionalmente 3 caracteres alfanuméricos de homoclave.

ALTER TABLE customers 
ADD CONSTRAINT rfc_format_check 
CHECK (
  rfc IS NULL 
  OR rfc = '' 
  OR rfc ~ '^[A-ZÑ&]{3,4}\d{6}([A-Z0-9]{3})?$'
);

-- Confirmación visual
SELECT '✅ RESTRICCIÓN DE SEGURIDAD PARA RFC AÑADIDA CON ÉXITO.' as status;
