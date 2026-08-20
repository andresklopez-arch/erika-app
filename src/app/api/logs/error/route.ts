import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";

// Registra una fila en error_logs (bitácora de auditoría/errores de toda
// la app). Antes se escribía directo desde el navegador con la llave
// pública — cualquiera podía fabricar entradas falsas o, peor, BORRAR el
// historial completo (incluyendo los intentos de PIN rechazados que el
// propio panel de seguridad muestra). Solo exige sesión válida: `usuario`
// se deja tal cual lo manda el llamador (no siempre es "quien actúa" —
// varios sitios lo usan para contexto, ej. nombre de cliente), igual que
// antes.
export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida." }, { status: 401 });
    }

    const { module, error_details, usuario } = await request.json();
    if (!module) {
      return NextResponse.json({ error: "Falta el módulo." }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from("error_logs").insert({
      module,
      error_details: error_details != null ? String(error_details) : "",
      usuario: usuario || "Desconocido",
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error en /api/logs/error:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
