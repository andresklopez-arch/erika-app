import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";

// Mueve un cliente a la papelera, lo restaura, o lo borra definitivamente.
// Antes cualquiera de las tres operaciones se hacía directo desde el
// navegador con la llave pública.
const ACTIONS = new Set(["soft", "restore", "hard"]);

export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const { id, action } = await request.json();
    if (!id || !ACTIONS.has(action)) {
      return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
    }

    if (action === "soft") {
      const { error } = await supabaseAdmin.from("customers").update({ deleted: true, deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) return NextResponse.json({ error: "Error al eliminar cliente: " + error.message }, { status: 500 });
    } else if (action === "restore") {
      const { error } = await supabaseAdmin.from("customers").update({ deleted: false, deleted_at: null }).eq("id", id);
      if (error) return NextResponse.json({ error: "Error al restaurar: " + error.message }, { status: 500 });
    } else {
      const { error } = await supabaseAdmin.from("customers").delete().eq("id", id);
      if (error) return NextResponse.json({ error: "Error al eliminar permanentemente: " + error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error en /api/customers/delete:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
