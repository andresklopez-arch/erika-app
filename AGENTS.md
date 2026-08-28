<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Patrón: cerrar una tabla de Supabase con RLS abierta

Todas las tablas de dinero (cajas, créditos, apartados, deudas a
proveedores, gastos), `users`, `inventory` (+ el RPC
`reduce_inventory_stock`) y `quotes` ya están cerradas — ver
`supabase/migrations/2026082*`. Quedan 8 tablas de menor riesgo sin cerrar
(`services`, `suppliers`, `supplier_orders`, `business_settings`,
`error_logs`, `internal_tasks`, `inventory_audit_logs`,
`inventory_movements` — ver `knownOpenPending` en
`scripts/check-rls-lockdown.js`). Si se agrega una tabla nueva con datos
sensibles, o se retoma alguna de las 8 pendientes, seguir este mismo
patrón (no crear políticas nuevas a mano ni copiar el bloque completo):

**Para una tabla con MUCHOS puntos de escritura distintos** (como
`inventory`, con 22 sitios en 8 archivos): no hace falta una ruta de
servidor por sitio. Agrupar por la FORMA del cambio, no por quién lo pide:
`/api/<tabla>/save` (crear/editar un registro por id, con una lista blanca
de columnas — ver `src/lib/inventoryFields.ts`), `/api/<tabla>/bulk-update`
(igual pero filtrando por una columna en vez de por id), `/api/<tabla>/delete`
(soft/restore/hard, mismo shape que `customersClient`), y si aplica un
`/api/<tabla>/bulk-import` aparte para cargas masivas (con un límite de
filas por request). La lógica de PREPARAR los datos (parsear un Excel,
detectar duplicados, decidir qué va en cada lote) puede quedarse en el
navegador tal cual — ahí no hay ningún problema de seguridad; lo único que
se mueve es la escritura final a la base de datos.

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

# Tablas nuevas con id `uuid DEFAULT gen_random_uuid()`

`gen_random_uuid()` ya funcionó sin problema en este proyecto de Supabase
(tabla `deploy_checkpoints`, migración `20260822010000`), así que la
extensión `pgcrypto` ya está habilitada aquí — no hace falta activarla de
nuevo. Si en el futuro se usa este mismo patrón en un proyecto de Supabase
distinto y la migración falla con "function gen_random_uuid() does not
exist", agregar `CREATE EXTENSION IF NOT EXISTS pgcrypto;` al inicio de esa
migración antes del `CREATE TABLE`.

# Qué llaves pueden ir en un workflow de GitHub Actions

- **Seguras de escribir directo en el YAML** (`.github/workflows/*.yml`),
  sin usar GitHub Secrets: `NEXT_PUBLIC_SUPABASE_URL` y
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Son públicas por diseño — el navegador
  de cualquier cliente ya las expone, y su único poder es lo que las
  políticas RLS le permitan a `anon` (que, después de este lockdown, es
  solo lectura en las tablas de negocio).
- **Nunca deben ir en un workflow** (ni siquiera como GitHub Secret, salvo
  decisión explícita del dueño del proyecto): `SUPABASE_SERVICE_ROLE_KEY`
  (ignora RLS por completo — acceso total de lectura/escritura a toda la
  base) y `SESSION_SECRET` (firma las cookies de sesión; con ella se puede
  forjar una sesión válida de cualquier usuario, como hace
  `scripts/test-caja-checkout-flow.js` a propósito solo contra
  `localhost`). Por esto `npm run test-caja` y el chequeo genérico de
  políticas RLS con estas llaves se quedaron como scripts manuales
  (`npm run check-rls` usa solo la llave pública y sí corre en CI).

# `quotes`: ya cerrada (lockdown corrido y confirmado)

Todas las escrituras directas a `quotes` desde el navegador (había 8, no 2
— la nota vieja de esta sección estaba desactualizada) ya se movieron a
`/api/quotes/save` (lista blanca en `src/lib/quotesFields.ts`, helper en
`src/lib/quotesClient.ts`, mismo shape `{data, error}` que el resto):

- `POSModule.tsx` — guardar cotización, insertar el ticket al cobrar,
  editar la nota de un ticket, cancelar un ticket (status + nota),
  marcar una cotización como vendida (`status: "converted"`).
- `QuotesModule.tsx` — `sendWhatsApp` marca `whatsapp_sent_at`.
- `src/app/facturacion/[id]/page.tsx` — fallback que marca el ticket como
  `"converted"` si el RPC `claim_invoice` falla.

El webhook de Facturama (`src/app/api/webhooks/facturama/route.ts`) ya
usaba `supabaseAdmin`, no necesitó cambios.

La migración SQL (`supabase/migrations/20260828000000_lock_quotes_writes.sql`,
`SELECT admin_reset_table_to_select_only('quotes')`) ya se corrió contra
producción y `npm run check-rls` confirma `quotes (INSERT)` como bloqueado
para la llave pública — por eso ya aparece en `mustBeBlocked`, no en
`knownOpenPending`, en `scripts/check-rls-lockdown.js`. Esta nota se quedó
desactualizada un tiempo (seguía diciendo "falta correr el lockdown"
después de que ya se había corrido) — si vuelve a pasar, `npm run
check-rls` es la fuente de verdad, no esta nota.

# Avisos operativos con OPERATIONAL_WARNING_EVENT

`OPERATIONAL_WARNING_EVENT` (`src/lib/customersClient.ts`) es un
`CustomEvent` de `window` para avisos de "esto va a fallar pronto si no se
atiende" que **no** son de seguridad RLS (esos usan su propio mecanismo:
`/api/admin/audit/rls-status` + el punto rojo en Sidebar). Hoy solo tiene
un emisor: `warnAboutCustomerListSize` (tamaño de la lista de clientes).
Lo escuchan `Sidebar.tsx` (punto naranja/rojo en "⚙️ Configuración") y
`SettingsModule.tsx` (detalle del aviso, botón "descartar" y acceso directo
a Clientes, junto a la Auditoría de Seguridad).

El `detail` lleva `{ type, count, severity }` — `severity` es `"warn"` o
`"danger"` (naranja vs. rojo, según qué tan cerca esté del límite duro) y
ya se usa tanto en el punto del Sidebar como en el color del panel de
Configuración.

Si se agrega un segundo aviso operativo (ej. otra tabla creciendo mucho,
otro límite acercándose):
1. Reutilizar el mismo evento, no crear uno nuevo — el punto naranja del
   Sidebar ya está cableado a este nombre.
2. Darle a `detail.type` un valor distinto a `"customer_list_size"` para
   que cada listener sepa distinguirlos (ver el `if (detail?.type === ...)`
   en `SettingsModule.tsx`).
3. Si el aviso necesita persistir para pantallas que montan después de que
   el evento ya se disparó (como pasa con Configuración), guardar el dato
   en `sessionStorage` también, no solo disparar el evento en vivo.
4. Si el aviso admite un botón "descartar", usar su propia llave de
   `sessionStorage` (ej. `ERIKA_CUSTOMER_WARNING_DISMISSED`) — no reutilizar
   la de otro aviso, o descartar uno ocultaría el otro sin querer.

