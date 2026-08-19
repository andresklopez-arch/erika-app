import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getClientKey, getLockRemainingMs, recordFailedAttempt, clearAttempts } from "@/lib/rateLimit";

// Endpoint genérico de verificación de PIN, usado por todas las
// autorizaciones puntuales dispersas por la app (retiro de caja alto,
// sobregiro de crédito, cierre de caja, apartados con stock insuficiente,
// enviar cotización a cobrar, etc.). Antes CADA una de esas pantallas
// consultaba `users`/`pin` directamente desde el navegador con la llave
// pública — ahora todas pasan por aquí, del lado del servidor, con la
// Service Role Key. `requireRole` es opcional: si se manda, el PIN debe
// pertenecer a un usuario con ese rol exacto para considerarse válido.
export async function POST(request: Request) {
  try {
    const { pin, requireRole } = await request.json();
    if (!pin || typeof pin !== "string") {
      return NextResponse.json({ valid: false, error: "Falta el PIN." }, { status: 400 });
    }

    const rateLimitKey = getClientKey(request, "verify-pin");
    const lockRemainingMs = getLockRemainingMs(rateLimitKey);
    if (lockRemainingMs > 0) {
      return NextResponse.json(
        { valid: false, error: `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(lockRemainingMs / 60000)} minuto(s).` },
        { status: 429 },
      );
    }

    let userId: string | undefined;

    const { data: cred } = await supabaseAdmin
      .from("user_credentials")
      .select("user_id")
      .eq("pin", pin)
      .maybeSingle();
    userId = cred?.user_id;

    // Respaldo mientras no se haya corrido la migración de PINes.
    if (!userId) {
      const { data: legacyUser } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("pin", pin)
        .maybeSingle();
      userId = legacyUser?.id;
    }

    if (!userId) {
      recordFailedAttempt(rateLimitKey);
      return NextResponse.json({ valid: false, error: "PIN incorrecto." }, { status: 401 });
    }

    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("id, name, role, permissions")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      recordFailedAttempt(rateLimitKey);
      return NextResponse.json({ valid: false, error: "PIN incorrecto." }, { status: 401 });
    }

    if (requireRole && user.role !== requireRole) {
      recordFailedAttempt(rateLimitKey);
      return NextResponse.json(
        { valid: false, error: `El PIN no pertenece a un usuario con rol "${requireRole}".` },
        { status: 403 },
      );
    }

    clearAttempts(rateLimitKey);
    return NextResponse.json({ valid: true, user });
  } catch (error: any) {
    console.error("Error en /api/auth/verify-pin:", error);
    return NextResponse.json({ valid: false, error: "Error interno del servidor" }, { status: 500 });
  }
}
