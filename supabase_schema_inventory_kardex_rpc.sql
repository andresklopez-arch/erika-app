-- 1. Crear tabla de Movimientos de Inventario (Kardex)
CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id UUID NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('sale', 'restock', 'adjustment', 'layaway', 'cancellation')),
  reference_id TEXT, -- e.g., Número de Ticket o ID de Venta
  created_by TEXT, -- e.g., Correo del cajero o 'Venta Mostrador'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Habilitar Seguridad RLS
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

-- 3. Crear política para permitir todo a anónimos temporalmente (de acuerdo a los estándares del proyecto)
CREATE POLICY "Permitir todo a anonimos en movimientos" ON inventory_movements FOR ALL USING (true) WITH CHECK (true);

-- 4. Crear función RPC para actualización por lotes (Bulk Update) y registro transaccional en Kardex
CREATE OR REPLACE FUNCTION reduce_inventory_stock(
  items jsonb,
  ref_id text,
  user_name text,
  move_type text
)
RETURNS void AS $$
DECLARE
  item record;
  current_stock int;
BEGIN
  FOR item IN SELECT * FROM jsonb_to_recordset(items) AS x(id uuid, qty int) LOOP
    -- Obtener stock actual
    SELECT stock INTO current_stock FROM inventory WHERE id = item.id;
    
    IF current_stock IS NOT NULL THEN
      -- Actualizar existencias en inventario
      UPDATE inventory
      SET stock = stock - item.qty
      WHERE id = item.id;

      -- Registrar movimiento de Kardex (cantidad negativa para salidas)
      INSERT INTO inventory_movements (inventory_id, quantity, movement_type, reference_id, created_by)
      VALUES (item.id, -item.qty, move_type, ref_id, user_name);
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Confirmación visual
SELECT '✅ MÓDULO KARDEX E INVENTARIO TRANSACCIONAL RPC LISTO PARA EJECUTAR EN EL EDITOR SQL.' as status;
