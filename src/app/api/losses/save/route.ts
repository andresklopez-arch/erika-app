import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";

// Registra un gasto/merma. Antes el INSERT se hacía directo desde el
// navegador con la llave pública.
export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const { loss_type, amount, description } = await request.json();
    if (!loss_type || typeof amount !== "number" || isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
    }

    const { data: loss, error } = await supabaseAdmin
      .from("business_losses")
      .insert({ loss_type, amount, description })
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: "Error al registrar la salida de dinero: " + error.message }, { status: 500 });
    return NextResponse.json({ success: true, loss });
  } catch (error: any) {
    console.error("Error en /api/losses/save:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
