-- Habilita vender productos por peso (kg/g), longitud (m) o volumen (L),
-- no solo por pieza. Antes `stock` era INTEGER y el RPC reduce_inventory_stock
-- forzaba un cast a `int`, así que cualquier cantidad fraccionaria (ej. 0.25
-- kg, 1.5 m) se truncaba al descontar inventario (0.25 -> 0, venta sin
-- descontar nada de stock).

ALTER TABLE inventory
  ALTER COLUMN stock TYPE NUMERIC(12,3) USING stock::numeric,
  ALTER COLUMN "minStock" TYPE NUMERIC(12,3) USING "minStock"::numeric;

ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS sale_unit TEXT NOT NULL DEFAULT 'pieza';

DO $$ BEGIN
  ALTER TABLE inventory ADD CONSTRAINT inventory_sale_unit_check
    CHECK (sale_unit IN ('pieza', 'kg', 'g', 'm', 'l'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE inventory_movements
  ALTER COLUMN quantity TYPE NUMERIC(12,3) USING quantity::numeric;

-- Reemplaza el RPC para que acepte cantidades decimales (antes: qty int).
CREATE OR REPLACE FUNCTION reduce_inventory_stock(
  items jsonb,
  ref_id text,
  user_name text,
  move_type text
)
RETURNS void AS $$
DECLARE
  item record;
  current_stock numeric;
BEGIN
  FOR item IN SELECT * FROM jsonb_to_recordset(items) AS x(id uuid, qty numeric) LOOP
    SELECT stock INTO current_stock FROM inventory WHERE id = item.id;

    IF current_stock IS NOT NULL THEN
      UPDATE inventory
      SET stock = stock - item.qty
      WHERE id = item.id;

      INSERT INTO inventory_movements (inventory_id, quantity, movement_type, reference_id, created_by)
      VALUES (item.id, -item.qty, move_type, ref_id, user_name);
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT '✅ VENTA POR PESO/LONGITUD/VOLUMEN LISTA (stock decimal + sale_unit).' as status;
