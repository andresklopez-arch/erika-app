import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";

const VALID_ACTIONS = new Set(["soft", "restore", "hard"]);

// Papelera de productos: enviar a la papelera (soft), restaurar (restore)
// o eliminar definitivamente (hard) — mismo shape y mismo nivel de acceso
// que /api/customers/delete (solo exige sesión válida; ninguna de las tres
// acciones pedía PIN de administrador en el navegador).
// Acepta `id` o `code` (el deshacer de una importación busca por código,
// ya que un producto recién creado por el importador podría no tener el
// id todavía en el estado local del navegador).
export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const { id, code, action } = await request.json();
    if (!id && !code) {
      return NextResponse.json({ error: "Falta el producto a eliminar." }, { status: 400 });
    }
    if (!VALID_ACTIONS.has(action)) {
      return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
    }

    const matchColumn = id ? "id" : "code";
    const matchValue = id || code;

    if (action === "hard") {
      const { error } = await supabaseAdmin.from("inventory").delete().eq(matchColumn, matchValue);
      if (error) return NextResponse.json({ error: "Error al eliminar producto: " + error.message }, { status: 400 });
    } else {
      const isSoft = action === "soft";
      const { error } = await supabaseAdmin
        .from("inventory")
        .update({ deleted: isSoft, deleted_at: isSoft ? new Date().toISOString() : null })
        .eq(matchColumn, matchValue);
      if (error) return NextResponse.json({ error: "Error al actualizar producto: " + error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error en /api/inventory/delete:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
