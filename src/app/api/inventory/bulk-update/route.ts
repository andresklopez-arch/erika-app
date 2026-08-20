import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";
import { verifyAdminPin } from "@/lib/verifyAdminPin";
import { pickAllowedFields } from "@/lib/inventoryFields";

// Actualiza varios productos a la vez filtrando por proveedor, ubicación o
// una lista de ids — usado por descuentos promocionales masivos y por el
// renombrado en cascada cuando cambia el nombre de un proveedor. Ninguno
// de los dos flujos pedía PIN de administrador en el navegador (se
// preserva ese mismo comportamiento); lo que faltaba era exigir sesión
// válida, que es lo que cierra el hueco real.
export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const { filter, fields, adminPin, requireAdminPin, auditLog } = await request.json();
    if (!filter || typeof filter !== "object") {
      return NextResponse.json({ error: "Falta el filtro de productos a actualizar." }, { status: 400 });
    }
    if (!fields || typeof fields !== "object") {
      return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
    }

    const { data: requester } = await supabaseAdmin.from("users").select("name, role").eq("id", userId).single();
    if (!requester) {
      return NextResponse.json({ error: "Usuario no encontrado." }, { status: 401 });
    }
    if (requireAdminPin && requester.role !== "admin" && !(adminPin && (await verifyAdminPin(adminPin)))) {
      return NextResponse.json({ error: "Esta acción requiere PIN de Administrador." }, { status: 403 });
    }

    const cleanFields = pickAllowedFields(fields);
    if (Object.keys(cleanFields).length === 0) {
      return NextResponse.json({ error: "Ningún campo válido para actualizar." }, { status: 400 });
    }

    let query = supabaseAdmin.from("inventory").update(cleanFields);
    if (filter.supplier) {
      query = query.eq("supplier", filter.supplier);
    } else if (filter.location) {
      query = query.eq("location", filter.location);
    } else if (Array.isArray(filter.ids) && filter.ids.length > 0) {
      query = query.in("id", filter.ids);
    } else {
      return NextResponse.json({ error: "El filtro debe traer proveedor, ubicación o una lista de ids." }, { status: 400 });
    }

    const { data, error } = await query.select("id");
    if (error) {
      return NextResponse.json({ error: "Error al actualizar productos: " + error.message }, { status: 400 });
    }

    // auditLog trae una entrada POR PRODUCTO (cada uno con su propio valor
    // anterior, ej. cada producto podía tener un discount_pct distinto
    // antes del descuento masivo) — no un valor genérico repetido para
    // todos los productos afectados.
    if (Array.isArray(auditLog) && auditLog.length > 0) {
      const affectedIds = new Set((data || []).map((r: any) => r.id));
      const rows = auditLog
        .filter((l: any) => l && affectedIds.has(l.id))
        .map((l: any) => ({
          inventory_id: l.id,
          field: l.field,
          old_value: l.oldValue != null ? String(l.oldValue) : "",
          new_value: l.newValue != null ? String(l.newValue) : "",
          changed_by: requester.name,
        }));
      if (rows.length > 0) await supabaseAdmin.from("inventory_audit_logs").insert(rows);
    }

    return NextResponse.json({ success: true, count: data?.length || 0 });
  } catch (error: any) {
    console.error("Error en /api/inventory/bulk-update:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
