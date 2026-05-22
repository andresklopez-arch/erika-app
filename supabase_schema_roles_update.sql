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
