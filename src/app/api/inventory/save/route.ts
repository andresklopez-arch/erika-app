import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";
import { verifyAdminPin } from "@/lib/verifyAdminPin";
import { INVENTORY_ALLOWED_FIELDS, pickAllowedFields } from "@/lib/inventoryFields";

// Crea o edita un producto. Antes esto se escribía directo en `inventory`
// desde el navegador con la llave pública en más de una decena de lugares
// distintos (alta de producto, edición de celda en línea, descuentos,
// deshacer cambios, fusión de duplicados, recepción de mercancía...) —
// cualquiera, sin necesidad de haber iniciado sesión siquiera, podía
// cambiar el precio/costo/existencias de cualquier producto. Ahora exige
// una sesión válida, igual que el resto de rutas de esta sesión de trabajo
// (/api/caja/*, /api/credit/*, etc.).
//
// requireAdminPin: la app solo pedía PIN de administrador en UN flujo
// (editar una celda ya existente si quien edita no es admin) — el resto
// (alta, borrar, descuentos, fusionar duplicados) nunca lo pidió. Para no
// cambiar ese comportamiento ya conocido por el equipo, el PIN solo se
// exige aquí cuando el propio llamador lo marca explícitamente.
export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const { id, fields, adminPin, requireAdminPin, auditLog } = await request.json();
    if (!fields || typeof fields !== "object") {
      return NextResponse.json({ error: "Datos de producto inválidos." }, { status: 400 });
    }

    const { data: requester } = await supabaseAdmin.from("users").select("name, role").eq("id", userId).single();
    if (!requester) {
      return NextResponse.json({ error: "Usuario no encontrado." }, { status: 401 });
    }
    if (requireAdminPin && requester.role !== "admin") {
      if (!adminPin || !(await verifyAdminPin(adminPin))) {
        return NextResponse.json({ error: "Esta acción requiere PIN de Administrador." }, { status: 403 });
      }
    }

    const cleanFields = pickAllowedFields(fields);
    if (Object.keys(cleanFields).length === 0) {
      return NextResponse.json({ error: "Ningún campo válido para guardar." }, { status: 400 });
    }

    let savedItem;
    if (id) {
      const { data, error } = await supabaseAdmin.from("inventory").update(cleanFields).eq("id", id).select().single();
      if (error) return NextResponse.json({ error: "Error al actualizar producto: " + error.message }, { status: 400 });
      savedItem = data;
    } else {
      if (!cleanFields.name) {
        return NextResponse.json({ error: "El nombre es requerido para crear un producto." }, { status: 400 });
      }
      const { data, error } = await supabaseAdmin.from("inventory").insert(cleanFields).select().single();
      if (error) return NextResponse.json({ error: "Error al crear producto: " + error.message }, { status: 400 });
      savedItem = data;
    }

    // El nombre de quien hizo el cambio se toma de la sesión verificada,
    // nunca de lo que mande el cliente (antes cada pantalla mandaba
    // `currentUser?.name || "Administrador"` desde el navegador).
    if (Array.isArray(auditLog) && auditLog.length > 0) {
      const rows = auditLog
        .filter((l: any) => l && INVENTORY_ALLOWED_FIELDS.includes(l.field))
        .map((l: any) => ({
          inventory_id: savedItem.id,
          field: l.field,
          old_value: l.oldValue != null ? String(l.oldValue) : "",
          new_value: l.newValue != null ? String(l.newValue) : "",
          // `note` es solo una etiqueta de contexto ("Reversión", etc.) —
          // el nombre real siempre viene de la sesión verificada, nunca del
          // cliente, así que no se puede suplantar a otra persona con esto.
          changed_by: l.note ? `${l.note} por ${requester.name}` : requester.name,
        }));
      if (rows.length > 0) {
        await supabaseAdmin.from("inventory_audit_logs").insert(rows);
      }
    }

    return NextResponse.json({ success: true, item: savedItem });
  } catch (error: any) {
    console.error("Error en /api/inventory/save:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
