-- Habilitar la extension pg_trgm para soporte de indices de trigramas si no esta habilitada
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Crear indices GIN de trigrama para busquedas rapidas parciales con ilike
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON customers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_phone_trgm ON customers USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_rfc_trgm ON customers USING gin (rfc gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_layaways_customer_name_trgm ON layaways USING gin (customer_name gin_trgm_ops);
