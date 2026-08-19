-- El webhook de cancelación de Facturama (/api/webhooks/facturama) asumía
-- que el "Id" que manda Facturama es igual al id interno de `quotes` — nunca
-- lo es, son sistemas distintos. Se agrega esta columna para guardar el Id
-- real de Facturama en cuanto se genere una factura (pendiente: la
-- integración con Facturama todavía no está activa, ver
-- src/app/api/facturacion/route.ts), y el webhook ya busca por aquí.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS facturama_invoice_id text;
CREATE INDEX IF NOT EXISTS quotes_facturama_invoice_id_idx ON quotes (facturama_invoice_id);
