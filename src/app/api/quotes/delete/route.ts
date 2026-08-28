import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";

// Borra una o varias cotizaciones (hard delete -- a diferencia de
// customers/delete, aquí no hace falta soft-delete/papelera: una
// cotización no es un registro de venta real (esos viven en la misma
// tabla pero con status="ticket", nunca se ofrecen aquí para depurar), es
// solo una propuesta que el cliente puede que nunca haya aceptado. Usado
// por el botón "🗑️" individual y por "🧹 Depurar antiguas" en
// QuotesModule.tsx.
export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const { ids } = await request.json();
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string" && typeof id !== "number")) {
      return NextResponse.json({ error: "Debes indicar al menos una cotización válida." }, { status: 400 });
    }

    // Nunca se borra un ticket real (venta ya cobrada) por este camino,
    // aunque alguien mande su id por error -- es la misma tabla, pero un
    // "ticket" es un registro de venta, no una propuesta descartable.
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("quotes")
      .select("id, status")
      .in("id", ids);
    if (fetchError) {
      return NextResponse.json({ error: "Error al verificar las cotizaciones: " + fetchError.message }, { status: 500 });
    }
    const deletableIds = (existing || []).filter((q) => q.status !== "ticket").map((q) => q.id);
    if (deletableIds.length === 0) {
      return NextResponse.json({ error: "Ninguna de las cotizaciones indicadas se puede eliminar (¿ya es un ticket de venta?)." }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from("quotes").delete().in("id", deletableIds);
    if (error) {
      return NextResponse.json({ error: "Error al eliminar: " + error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, deletedCount: deletableIds.length });
  } catch (error: any) {
    console.error("Error en /api/quotes/delete:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
