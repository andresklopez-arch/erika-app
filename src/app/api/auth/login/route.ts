import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getClientKey, getLockRemainingMs, recordFailedAttempt, clearAttempts } from "@/lib/rateLimit";

// Login principal por PIN. Antes esto se hacía consultando directamente
// `users` desde el navegador con la llave pública (anon): como esa tabla
// tenía lectura pública (necesaria para mostrar nombres/roles en el resto
// de la app), cualquier visitante podía leer el PIN de TODOS los usuarios
// sin pasar por este endpoint en absoluto. Ahora el PIN se verifica aquí,
// del lado del servidor, con la Service Role Key (ignora RLS), contra la
// tabla protegida `user_credentials` — sin acceso desde ningún cliente.
export async function POST(request: Request) {
  try {
    const { pin } = await request.json();
    if (!pin || typeof pin !== "string") {
      return NextResponse.json({ error: "Falta el PIN." }, { status: 400 });
    }

    const rateLimitKey = getClientKey(request, "login");
    const lockRemainingMs = getLockRemainingMs(rateLimitKey);
    if (lockRemainingMs > 0) {
      return NextResponse.json(
        { error: `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(lockRemainingMs / 60000)} minuto(s).` },
        { status: 429 },
      );
    }

    const { data: cred } = await supabaseAdmin
      .from("user_credentials")
      .select("user_id")
      .eq("pin", pin)
      .maybeSingle();

    const userId = cred?.user_id;

    if (!userId) {
      recordFailedAttempt(rateLimitKey);
      return NextResponse.json({ error: "PIN Incorrecto" }, { status: 401 });
    }

    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      recordFailedAttempt(rateLimitKey);
      return NextResponse.json({ error: "PIN Incorrecto" }, { status: 401 });
    }

    clearAttempts(rateLimitKey);

    // Se devuelve el PIN propio del usuario junto con su registro (lo
    // necesita el cliente para su sesión offline) — esto es distinto de
    // exponer los PIN de TODOS los usuarios: aquí solo se revela el PIN
    // que la propia persona ya tecleó para autenticarse.
    return NextResponse.json({ success: true, user: { ...user, pin } });
  } catch (error: any) {
    console.error("Error en /api/auth/login:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
