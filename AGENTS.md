<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Patrón: cerrar una tabla de Supabase con RLS abierta

Todas las tablas de negocio (dinero: cajas, créditos, apartados, deudas a
proveedores, gastos) ya están cerradas — ver `supabase/migrations/2026082*`.
Si se agrega una tabla nueva con datos financieros, seguir este mismo
patrón (no crear políticas nuevas a mano ni copiar el bloque completo):

1. Escribir la escritura (INSERT/UPDATE/DELETE) en una ruta de servidor
   bajo `src/app/api/**`, usando `supabaseAdmin` (Service Role Key,
   `src/lib/supabaseAdmin.ts`) y `getSessionUserId()`
   (`src/lib/session.ts`) para exigir una sesión válida. Nunca escribir la
   tabla directo desde un componente `"use client"`.
2. Crear un helper en `src/lib/*Client.ts` que imite el shape `{data,
   error}` de supabase-js, para poder cambiar cada sitio del navegador
   con una sola línea sin tocar el resto de su lógica (ver
   `cashTransactionClient.ts`, `customersClient.ts`, etc. como ejemplo).
3. En Supabase (SQL Editor), correr:
   ```sql
   SELECT admin_reset_table_to_select_only('nombre_de_la_tabla');
   ```
   Esta función (definida en `supabase/migrations/20260821000000_*.sql`)
   borra TODAS las políticas existentes de la tabla —sin depender de
   adivinar su nombre exacto— y deja solo una política de lectura pública
   (`FOR SELECT USING (true)`). Las escrituras quedan bloqueadas para
   `anon`/`authenticated`; solo `service_role` (que ignora RLS) puede
   escribir, es decir, solo las rutas del paso 1.
4. Si la tabla tiene una función RPC `SECURITY DEFINER` asociada (saldos,
   puntos, etc.), revocar su ejecución también — Supabase le da EXECUTE
   directo a `anon`/`authenticated` al crearla, así que sigue siendo
   forjable aunque la tabla ya esté cerrada:
   ```sql
   REVOKE EXECUTE ON FUNCTION nombre_funcion(tipos) FROM PUBLIC, anon, authenticated;
   GRANT EXECUTE ON FUNCTION nombre_funcion(tipos) TO service_role;
   ```
5. Agregar la tabla/RPC a `mustBeBlocked` en `scripts/check-rls-lockdown.js`
   y correr `npm run check-rls` para confirmar.

