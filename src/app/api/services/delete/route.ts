import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";

const VALID_ACTIONS = new Set(["soft", "restore", "hard"]);

// Papelera de citas de servicio: soft/restore/hard.
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
      const { error } = await supabaseAdmin.from("services").delete().eq("id", id);
      if (error) return NextResponse.json({ error: "Error al eliminar la cita: " + error.message }, { status: 400 });
    } else {
      const isSoft = action === "soft";
      const { error } = await supabaseAdmin
        .from("services")
        .update({ deleted: isSoft, deleted_at: isSoft ? new Date().toISOString() : null })
        .eq("id", id);
      if (error) return NextResponse.json({ error: "Error al actualizar la cita: " + error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error en /api/services/delete:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
