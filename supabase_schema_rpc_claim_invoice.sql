-- Función RPC para marcar de forma atómica una factura como reclamada y cambiar el estado del ticket
CREATE OR REPLACE FUNCTION claim_invoice(p_token TEXT, p_ticket_id UUID)
RETURNS VOID AS $$
BEGIN
  -- 1. Actualizar el estado de reclamo del QR a reclamado
  UPDATE invoice_claims SET claimed = TRUE WHERE token = p_token;

  -- 2. Cambiar el estado del ticket en quotes a convertido/facturado
  UPDATE quotes SET status = 'converted' WHERE id = p_ticket_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
