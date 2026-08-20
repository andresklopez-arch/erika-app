import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";

// Abre un turno de caja. Antes el INSERT en cash_sessions se hacía
// directo desde el navegador con la llave pública (RLS "USING true"),
// así que cualquiera podía abrir una caja fantasma o declarar el fondo
// inicial que quisiera sin haber iniciado sesión siquiera. Ahora requiere
// una sesión de usuario válida (cookie firmada) y el nombre de quien abre
// se toma fresco de la base de datos, no de lo que mande el cliente.
export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const { initialBalance } = await request.json();
    if (typeof initialBalance !== "number" || isNaN(initialBalance) || initialBalance < 0) {
      return NextResponse.json({ error: "El fondo inicial no puede ser negativo." }, { status: 400 });
    }

    const { data: user } = await supabaseAdmin.from("users").select("id, name").eq("id", userId).single();
    if (!user) {
      return NextResponse.json({ error: "Usuario no encontrado." }, { status: 401 });
    }

    // Revalidar en el servidor: si dos dispositivos abren la caja casi al
    // mismo tiempo, sin este chequeo ambos inserts pasarían y quedarían
    // dos sesiones "open" simultáneas descuadrando la caja.
    const { data: existing } = await supabaseAdmin
      .from("cash_sessions")
      .select("id")
      .eq("status", "open")
      .limit(1)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: "Ya hay una caja abierta." }, { status: 409 });
    }

    const { data: session, error } = await supabaseAdmin
      .from("cash_sessions")
      .insert({ initial_balance: initialBalance, opened_by: user.name })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: "Error al abrir caja: " + error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, session });
  } catch (error: any) {
    console.error("Error en /api/caja/open:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
