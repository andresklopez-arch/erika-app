-- Pega esto en el SQL Editor de Supabase y dale a RUN (Correr)

CREATE TABLE inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL,
  cost NUMERIC NOT NULL,
  stock INTEGER NOT NULL,
  "minStock" INTEGER NOT NULL DEFAULT 5,
  "salesIndex" INTEGER DEFAULT 50,
  supplier TEXT,
  location TEXT,
  "autoPriced" BOOLEAN DEFAULT false,
  "priceChanged" TEXT
);

-- Habilitar permisos públicos para lectura/escritura temporal (mientras no hay login de usuarios)
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir todo a anonimos temporalmente" ON inventory FOR ALL USING (true) WITH CHECK (true);

-- Insertar algunos datos iniciales de prueba para ERIKA
INSERT INTO inventory (code, name, price, cost, stock, "minStock", supplier, location)
VALUES 
  ('TRU-16', 'Martillo Truper 16oz', 120.5, 80.0, 12, 5, 'Truper', 'A-1'),
  ('CLA-02', 'Clavo para concreto 2 pulgadas', 45.0, 25.0, 15, 50, 'Aceros México', 'B-6'),
  ('COM-19', 'Pintura Blanca 19L Comex', 1250.0, 900.0, 4, 5, 'Comex', 'P-12');
