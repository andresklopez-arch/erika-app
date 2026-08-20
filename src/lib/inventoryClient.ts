// Ajusta existencias vía /api/inventory/reduce-stock en vez de llamar al
// RPC reduce_inventory_stock directo desde el navegador. Un `qty` positivo
// resta stock (venta), uno negativo lo suma (cancelación/recepción) — el
// mismo signo que ya usaba el RPC original.
export async function reduceInventoryStock(
  items: { id: string; qty: number }[],
  moveType: "sale" | "restock" | "adjustment" | "layaway" | "cancellation",
  refId?: string,
): Promise<{ data: { success: true } | null; error: { message: string } | null }> {
  try {
    const res = await fetch("/api/inventory/reduce-stock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, refId, moveType }),
    });
    const json = await res.json();
    if (!res.ok) {
      return { data: null, error: { message: json.error || "Error al ajustar el inventario." } };
    }
    return { data: json, error: null };
  } catch (e: any) {
    return { data: null, error: { message: e.message || "Error de red al ajustar el inventario." } };
  }
}
