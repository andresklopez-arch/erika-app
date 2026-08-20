-- ==========================================================
-- CIERRA el RPC reduce_inventory_stock — el mecanismo real que usa casi
-- toda la app para mover existencias (checkout, devoluciones, apartados,
-- venta a crédito, recepción de mercancía, sincronización offline). Hoy
-- es invocable directo por cualquiera con la llave pública: cualquiera
-- podía inflar o vaciar el stock de cualquier producto, o fabricar
-- movimientos de Kardex con el "user_name" que quisiera.
--
-- Ya se movieron los 9 puntos del navegador que lo llamaban directo a
-- /api/inventory/reduce-stock (que sí verifica sesión y toma el nombre
-- real de quien mueve el inventario desde la base de datos, no de lo que
-- mande el cliente).
--
-- IMPORTANTE: esto NO cierra todavía la tabla `inventory` en sí (alta,
-- edición y borrado de productos, importación masiva, etc. siguen
-- escribiéndose directo desde el navegador) — esa es la Etapa 2, todavía
-- pendiente. Cerrar la tabla ahora rompería esas pantallas antes de
-- migrarlas.
REVOKE EXECUTE ON FUNCTION reduce_inventory_stock(jsonb, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reduce_inventory_stock(jsonb, text, text, text) TO service_role;

SELECT routine_name, security_type FROM information_schema.routines WHERE routine_name = 'reduce_inventory_stock';
