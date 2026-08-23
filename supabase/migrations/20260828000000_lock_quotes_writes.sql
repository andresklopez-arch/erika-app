-- ==========================================================
-- Cierra `quotes` (cotizaciones, tickets de venta y su estado de
-- facturación/cancelación viven todos en esta tabla, distinguidos por
-- `status`) — la última de las tablas "pendientes" listadas en AGENTS.md.
--
-- Los escritores directos desde el navegador con la llave pública se
-- movieron todos a /api/quotes/save (POST { id?, fields } — crea si no
-- hay id, edita por id si lo hay, con lista blanca de columnas en
-- src/lib/quotesFields.ts):
--   - POSModule.tsx: guardar cotización, insertar ticket al cobrar,
--     editar nota de ticket, cancelar ticket, marcar cotización vendida.
--   - QuotesModule.tsx: marcar whatsapp_sent_at.
--   - src/app/facturacion/[id]/page.tsx: marcar ticket como "converted"
--     (fallback de la ruta RPC claim_invoice, que sigue intacta).
--
-- El webhook de Facturama (src/app/api/webhooks/facturama/route.ts) ya
-- usaba supabaseAdmin (service role) — no necesita cambios.
--
-- IMPORTANTE: esta migración NO se ha corrido contra producción todavía.
-- `quotes` es la tabla más usada de toda la app (cobro en caja, historial
-- de clientes, apartados-a-crédito, cotizaciones activas); antes de
-- correr esto en el SQL Editor de Supabase, confirma que el deploy con
-- los cambios de arriba ya está en producción y que un ciclo normal de
-- cobro/cotización/cancelación sigue funcionando de punta a punta.
-- ==========================================================
SELECT admin_reset_table_to_select_only('quotes');

SELECT policyname, cmd, roles, tablename FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'quotes';
