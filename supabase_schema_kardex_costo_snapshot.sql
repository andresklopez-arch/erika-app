-- Guarda el costo y precio del producto EN EL MOMENTO del movimiento
-- (antes el reporte de "Ventas por Unidad" calculaba costo/utilidad con el
-- costo/precio ACTUAL del producto, así que si el precio cambiaba después,
-- el reporte de meses pasados quedaba distorsionado retroactivamente).

ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,2);

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
  current_cost numeric;
  current_price numeric;
BEGIN
  FOR item IN SELECT * FROM jsonb_to_recordset(items) AS x(id uuid, qty numeric) LOOP
    SELECT stock, cost, price INTO current_stock, current_cost, current_price
    FROM inventory WHERE id = item.id;

    IF current_stock IS NOT NULL THEN
      UPDATE inventory
      SET stock = stock - item.qty
      WHERE id = item.id;

      INSERT INTO inventory_movements (inventory_id, quantity, movement_type, reference_id, created_by, unit_cost, unit_price)
      VALUES (item.id, -item.qty, move_type, ref_id, user_name, current_cost, current_price);
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT '✅ KARDEX AHORA GUARDA COSTO/PRECIO AL MOMENTO DE CADA MOVIMIENTO.' as status;
