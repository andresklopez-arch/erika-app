import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";

// Marca un apartado como cancelado. La restauración de inventario físico
// sigue ocurriendo del lado del cliente (tabla `inventory`, fuera de
// alcance de este cierre) — este endpoint solo cubre el status de layaways.
export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const { layawayId } = await request.json();
    if (!layawayId) {
      return NextResponse.json({ error: "Falta el ID del apartado." }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from("layaways").update({ status: "cancelled" }).eq("id", layawayId);
    if (error) return NextResponse.json({ error: "Error al cancelar: " + error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error en /api/layaways/cancel:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
