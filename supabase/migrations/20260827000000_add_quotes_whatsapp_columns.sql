-- Agrega columnas para el envio de presupuestos por WhatsApp:
-- customer_phone: snapshot del telefono del cliente al crear la cotizacion
--   (protege contra un telefono que cambio o un cliente borrado despues).
-- whatsapp_sent_at: marca de tiempo del ultimo envio, para dar seguimiento
--   a presupuestos que se enviaron pero nunca se convirtieron en venta.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS customer_phone text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS whatsapp_sent_at timestamptz;
