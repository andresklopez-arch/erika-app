import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";

const VALID_ACTIONS = new Set(["soft", "restore", "hard"]);

// Papelera de proveedores: soft/restore/hard — mismo shape que
// customersClient/inventoryClient.
export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const { id, action } = await request.json();
    if (!id || !VALID_ACTIONS.has(action)) {
      return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
    }

    if (action === "hard") {
      const { error } = await supabaseAdmin.from("suppliers").delete().eq("id", id);
      if (error) return NextResponse.json({ error: "Error al eliminar proveedor: " + error.message }, { status: 400 });
    } else {
      const isSoft = action === "soft";
      const { error } = await supabaseAdmin
        .from("suppliers")
        .update({ deleted: isSoft, deleted_at: isSoft ? new Date().toISOString() : null })
        .eq("id", id);
      if (error) return NextResponse.json({ error: "Error al actualizar proveedor: " + error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error en /api/suppliers/delete:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
