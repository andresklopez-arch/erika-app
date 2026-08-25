-- ==========================================================
-- Crea `invoice_claims` y el RPC `claim_invoice`.
--
-- Hallazgo del 2026-08-25 (al construir "Ver Ticket Original"): la tabla
-- invoice_claims NUNCA EXISTIÓ -- ninguna migración la creó jamás. Cada
-- venta (efectivo, tarjeta y ahora también crédito) intenta guardar un
-- "invoice claim" ahí para el link de Auto-Facturación Express que se
-- manda al cliente por WhatsApp/ticket impreso, y SIEMPRE falla
-- (PGRST205 "table not found"), cayendo en silencio al respaldo local en
-- IndexedDB del navegador -- que nunca se sincroniza a ningún lado. El
-- RPC claim_invoice tampoco existe (PGRST202), así que el timbrado
-- también caía siempre al camino secuencial de respaldo.
--
-- Esto no arregla la facturación electrónica en sí (el timbrado con
-- Facturama sigue sin configurarse -- ver el aviso "no disponible por el
-- momento" en /facturacion/[id]/page.tsx), pero sin esta tabla, ni
-- siquiera se podía ENCONTRAR el ticket original al abrir el link: tanto
-- la búsqueda por token en invoice_claims como el respaldo (buscar
-- directo en quotes.id con el token de la URL, que nunca coincide -- el
-- token tiene formato "FAC-{id}-{uuid}", no es un uuid real) fallaban
-- siempre. Un cliente que le diera clic al link SIEMPRE veía "Ticket no
-- encontrado", aunque el ticket sí existiera.
--
-- `token` es público por diseño (viaja en la URL que se le manda al
-- cliente sin que inicie sesión) -- el control de acceso real es que el
-- token es un uuid random impredecible, no las políticas RLS. Mismo
-- patrón que otras tablas públicas-por-token de este proyecto.
-- ==========================================================
CREATE TABLE IF NOT EXISTS invoice_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid,
  token text UNIQUE NOT NULL,
  claimed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE invoice_claims ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'invoice_claims' LOOP
    EXECUTE format('DROP POLICY %I ON invoice_claims', pol.policyname);
  END LOOP;
END $$;

-- Select: necesario para que /facturacion/[id] (visita anónima, sin
-- sesión) busque el ticket por token.
CREATE POLICY "invoice_claims_select_publico" ON invoice_claims FOR SELECT USING (true);
-- Insert: el checkout del POS lo hace con la llave pública (el login de
-- la app es una cookie propia, no Supabase Auth -- para RLS es "anon"
-- igual que un visitante cualquiera).
CREATE POLICY "invoice_claims_insert_publico" ON invoice_claims FOR INSERT WITH CHECK (
  token IS NOT NULL AND length(token) > 0
);
-- Update: solo para marcar `claimed` -- el cliente anónimo en
-- /facturacion/[id] lo hace tras timbrar (camino secuencial de respaldo
-- si el RPC claim_invoice no aplica).
CREATE POLICY "invoice_claims_update_publico" ON invoice_claims FOR UPDATE USING (true) WITH CHECK (true);

-- RPC para reclamar un token de forma atómica (evita que el mismo token
-- se use dos veces por una condición de carrera entre dos pestañas).
CREATE OR REPLACE FUNCTION claim_invoice(p_token text, p_ticket_id uuid)
RETURNS boolean AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE invoice_claims
  SET claimed = true
  WHERE token = p_token AND ticket_id = p_ticket_id AND claimed = false;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION claim_invoice(text, uuid) TO anon, authenticated;
