-- Función RPC para marcar de forma atómica una factura como reclamada y cambiar el estado del ticket, validando existencia previa
CREATE OR REPLACE FUNCTION claim_invoice(p_token TEXT, p_ticket_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  -- Verificar si existe el reclamo con el token y ticket correspondientes, y no ha sido reclamado aún
  SELECT EXISTS (
    SELECT 1 FROM invoice_claims
    WHERE token = p_token AND ticket_id = p_ticket_id AND claimed = FALSE
  ) INTO v_exists;

  IF NOT v_exists THEN
    -- Retornar falso si no existe o ya está reclamado
    RETURN FALSE;
  END IF;

  -- 1. Actualizar el estado de reclamo del QR a reclamado
  UPDATE invoice_claims SET claimed = TRUE WHERE token = p_token;

  -- 2. Cambiar el estado del ticket en quotes a convertido/facturado
  UPDATE quotes SET status = 'converted' WHERE id = p_ticket_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
