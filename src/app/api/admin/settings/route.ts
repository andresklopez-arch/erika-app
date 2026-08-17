import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { BusinessSettingsSchema } from "@/lib/settingsSchema";
import { getClientKey, getLockRemainingMs, recordFailedAttempt, clearAttempts } from "@/lib/rateLimit";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { adminPin, settings } = body;

    if (!adminPin) {
      return NextResponse.json({ error: "Se requiere el PIN de administrador." }, { status: 401 });
    }

    const rateLimitKey = getClientKey(request, "admin-settings");
    const lockRemainingMs = getLockRemainingMs(rateLimitKey);
    if (lockRemainingMs > 0) {
      return NextResponse.json(
        { error: `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(lockRemainingMs / 60000)} minuto(s).` },
        { status: 429 },
      );
    }

    // Verificar en el servidor si el PIN pertenece a un administrador
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("role")
      .eq("pin", adminPin)
      .single();

    if (userError || !user || user.role !== "admin") {
      recordFailedAttempt(rateLimitKey);
      return NextResponse.json({ error: "Acceso Denegado. Solo administradores pueden cambiar configuraciones." }, { status: 403 });
    }
    clearAttempts(rateLimitKey);

    // Validar el payload con Zod
    const validationResult = BusinessSettingsSchema.safeParse(settings);
    if (!validationResult.success) {
      return NextResponse.json({ error: "Datos de configuración inválidos.", details: validationResult.error.format() }, { status: 400 });
    }

    const validatedSettings = validationResult.data;

    // Guardar en la base de datos
    const { error: dbError } = await supabase
      .from("business_settings")
      .upsert({
        id: "erika_global",
        target_utility: validatedSettings.target_utility,
        monthly_goals: validatedSettings.monthly_goals,
        config: validatedSettings.config,
        updated_at: new Date().toISOString()
      });

    if (dbError) {
      return NextResponse.json({ error: "Error en base de datos al guardar configuración.", details: dbError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, settings: validatedSettings });
  } catch (error: any) {
    console.error("Error en API de configuracion:", error);
    return NextResponse.json({ error: "Error interno del servidor", details: error.message }, { status: 500 });
  }
}
