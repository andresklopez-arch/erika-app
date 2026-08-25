import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyAdminPin } from "@/lib/verifyAdminPin";
import { getClientKey, getLockRemainingMs, recordFailedAttempt, clearAttempts } from "@/lib/rateLimit";

// Muestra en el panel de administración qué tan expuesto sigue el catálogo
// al bug del 2026-08-25 (POSModule.tsx emparejaba productos por `name`;
// 160 grupos de nombre duplicado en producción -- distintas presentaciones
// del mismo artículo -- colapsaban mal en el carrito). El fix real vive en
// src/lib/posItemMatch.ts (empareja por `code`); esto es solo visibilidad,
// mismo patrón que /api/admin/audit/rls-status para no depender de que
// alguien corra `npm run check-schema` a mano desde su computadora.
// Requiere PIN de administrador porque expone nombres/precios internos del
// catálogo completo.
async function fetchAllInventoryRows(select: string) {
  let all: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("inventory")
      .select(select)
      .or("deleted.is.null,deleted.eq.false")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export async function POST(request: Request) {
  try {
    const { adminPin } = await request.json();

    const rateLimitKey = getClientKey(request, "admin-catalog-health-audit");
    const lockRemainingMs = getLockRemainingMs(rateLimitKey);
    if (lockRemainingMs > 0) {
      return NextResponse.json(
        { error: `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(lockRemainingMs / 60000)} minuto(s).` },
        { status: 429 },
      );
    }
    if (!adminPin || !(await verifyAdminPin(adminPin))) {
      recordFailedAttempt(rateLimitKey);
      return NextResponse.json({ error: "Acceso Denegado. Solo administradores pueden ver esta auditoría." }, { status: 403 });
    }
    clearAttempts(rateLimitKey);

    const items = await fetchAllInventoryRows("id, name, code, price, stock");

    const byName = new Map<string, typeof items>();
    for (const item of items) {
      if (!byName.has(item.name)) byName.set(item.name, []);
      byName.get(item.name)!.push(item);
    }
    const duplicateNameGroups = [...byName.entries()]
      .filter(([, arr]) => arr.length > 1)
      .map(([name, arr]) => ({
        name,
        variants: arr.map((v: any) => ({ code: v.code || "", price: v.price, stock: v.stock })),
      }));

    const emptyCodeItems = items
      .filter((i) => !i.code || String(i.code).trim() === "")
      .map((i) => ({ name: i.name, price: i.price, stock: i.stock }));

    return NextResponse.json({
      success: true,
      totalActiveProducts: items.length,
      duplicateNameGroups,
      emptyCodeItems,
    });
  } catch (error: any) {
    console.error("Error en /api/admin/audit/catalog-health:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
