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

type InventoryAuditEntry = { field: string; oldValue: any; newValue: any; note?: string };

async function postJson(url: string, body: any) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: { message: json.error || "Error al guardar." } };
    return { data: json, error: null };
  } catch (e: any) {
    return { data: null, error: { message: e.message || "Error de red." } };
  }
}

// Crea o edita un producto (id presente = editar, ausente = crear).
// requireAdminPin: pásalo en true solo si esta pantalla ya le pedía PIN de
// administrador a un usuario no-admin antes de este cambio.
export async function saveInventoryItem(payload: {
  id?: string;
  fields: Record<string, any>;
  adminPin?: string;
  requireAdminPin?: boolean;
  auditLog?: InventoryAuditEntry[];
}) {
  return postJson("/api/inventory/save", payload);
}

// Actualiza varios productos a la vez por proveedor, ubicación o lista de ids.
export async function bulkUpdateInventory(payload: {
  filter: { supplier?: string; location?: string; ids?: string[] };
  fields: Record<string, any>;
  adminPin?: string;
  requireAdminPin?: boolean;
  auditLog?: (InventoryAuditEntry & { id: string })[];
}) {
  return postJson("/api/inventory/bulk-update", payload);
}

// Importación masiva (SmartImporter): el navegador arma `inserts`/`updates`
// leyendo el archivo y comparando contra el catálogo ya cargado; esta
// llamada solo hace la escritura real en la base de datos.
export async function bulkImportInventory(payload: {
  inserts: Record<string, any>[];
  updates: Record<string, any>[];
  accumulateStock: boolean;
  importedDeltaById: Record<string, number>;
}): Promise<{
  data: { success: true; newCount: number; failedInserts: number; updateErrorMessage: string | null } | null;
  error: { message: string } | null;
}> {
  return postJson("/api/inventory/bulk-import", payload) as any;
}

// Papelera de productos: soft (enviar a papelera), restore, hard (borrar definitivo).
export async function deleteInventoryItem(payload: {
  id?: string;
  code?: string;
  action: "soft" | "restore" | "hard";
  adminPin?: string;
}) {
  return postJson("/api/inventory/delete", payload);
}
