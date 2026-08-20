import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyAdminPin, getUserByPin } from "@/lib/verifyAdminPin";
import { z } from "zod";
import { getClientKey, getLockRemainingMs, recordFailedAttempt, clearAttempts } from "@/lib/rateLimit";

// Zod schema for validating user input
const UserInputSchema = z.object({
  name: z.string().min(1, "El nombre es requerido."),
  pin: z.string().min(4, "El PIN debe tener al menos 4 dígitos."),
  role: z.string().min(1, "El rol es requerido."),
  permissions: z.record(z.string(), z.boolean()).default({}),
});

function getHelpfulErrorMessage(dbError: any, action: "crear" | "actualizar"): string {
  if (dbError.code === "23505") {
    return `El PIN ya está asignado a otro usuario. Por seguridad, cada usuario debe tener un PIN único.`;
  }
  if (dbError.code === "23514" && dbError.message?.includes("users_role_check")) {
    return `El rol seleccionado no está permitido por la base de datos. Debes ejecutar el script SQL en Supabase para permitir roles personalizados.`;
  }
  return `Error de base de datos: ${dbError.message}`;
}

// Escribe el PIN en user_credentials (tabla protegida, sin acceso desde
// ningún cliente). `users.pin` ya no existe (migración confirmada), así
// que un error aquí debe reportarse — antes se ignoraba silenciosamente y
// el admin creía que el PIN se había guardado cuando en realidad no.
async function writePin(userId: string, pin: string) {
  const { error } = await supabaseAdmin
    .from("user_credentials")
    .upsert({ user_id: userId, pin, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error(`No se pudo guardar el PIN: ${error.message}`);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { adminPin, user } = body;

    if (!adminPin) {
      return NextResponse.json({ error: "Se requiere el PIN de administrador." }, { status: 401 });
    }

    const rateLimitKey = getClientKey(request, "admin-users");
    const lockRemainingMs = getLockRemainingMs(rateLimitKey);
    if (lockRemainingMs > 0) {
      return NextResponse.json(
        { error: `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(lockRemainingMs / 60000)} minuto(s).` },
        { status: 429 },
      );
    }

    if (!(await verifyAdminPin(adminPin))) {
      recordFailedAttempt(rateLimitKey);
      return NextResponse.json({ error: "Acceso Denegado. Solo administradores pueden gestionar usuarios." }, { status: 403 });
    }
    clearAttempts(rateLimitKey);

    const validationResult = UserInputSchema.safeParse(user);
    if (!validationResult.success) {
      return NextResponse.json({ error: "Datos de usuario inválidos.", details: validationResult.error.format() }, { status: 400 });
    }

    const { name, pin, role, permissions } = validationResult.data;

    // Crear en la base de datos (users ya NO tiene columna pin — se
    // guarda por separado en user_credentials).
    const { data: newUser, error: dbError } = await supabaseAdmin
      .from("users")
      .insert({ name, role, permissions })
      .select()
      .single();

    if (dbError) {
      return NextResponse.json({ error: getHelpfulErrorMessage(dbError, "crear"), details: dbError.message }, { status: 400 });
    }

    await writePin(newUser.id, pin);

    return NextResponse.json({ success: true, user: newUser });
  } catch (error: any) {
    console.error("Error en POST /api/admin/users:", error);
    return NextResponse.json({ error: "Error interno del servidor", details: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { adminPin, userId, user } = body;

    if (!adminPin || !userId) {
      return NextResponse.json({ error: "Parámetros incompletos." }, { status: 400 });
    }

    const rateLimitKey = getClientKey(request, "admin-users");
    const lockRemainingMs = getLockRemainingMs(rateLimitKey);
    if (lockRemainingMs > 0) {
      return NextResponse.json(
        { error: `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(lockRemainingMs / 60000)} minuto(s).` },
        { status: 429 },
      );
    }

    const requestingAdmin = await getUserByPin(adminPin);
    if (requestingAdmin?.role !== "admin") {
      recordFailedAttempt(rateLimitKey);
      return NextResponse.json({ error: "Acceso Denegado. Solo administradores pueden gestionar usuarios." }, { status: 403 });
    }
    clearAttempts(rateLimitKey);

    const validationResult = UserInputSchema.safeParse(user);
    if (!validationResult.success) {
      return NextResponse.json({ error: "Datos de usuario inválidos.", details: validationResult.error.format() }, { status: 400 });
    }

    const { name, pin, role, permissions } = validationResult.data;

    // Un admin no puede quitarse a sí mismo el rol de administrador —
    // podría dejar la cuenta que está usando ahora mismo sin acceso a
    // Gestión de Personal, sin ningún otro admin de por medio para
    // revertirlo.
    if (requestingAdmin.id === userId && role !== "admin") {
      return NextResponse.json({ error: "No puedes quitarte a ti mismo el rol de administrador." }, { status: 400 });
    }

    const { data: updatedUser, error: dbError } = await supabaseAdmin
      .from("users")
      .update({ name, role, permissions })
      .eq("id", userId)
      .select()
      .single();

    if (dbError) {
      return NextResponse.json({ error: getHelpfulErrorMessage(dbError, "actualizar"), details: dbError.message }, { status: 400 });
    }

    await writePin(userId, pin);

    return NextResponse.json({ success: true, user: updatedUser });
  } catch (error: any) {
    console.error("Error en PUT /api/admin/users:", error);
    return NextResponse.json({ error: "Error interno del servidor", details: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const adminPin = searchParams.get("adminPin");
    const userId = searchParams.get("userId");

    if (!adminPin || !userId) {
      return NextResponse.json({ error: "Parámetros incompletos." }, { status: 400 });
    }

    const rateLimitKey = getClientKey(request, "admin-users");
    const lockRemainingMs = getLockRemainingMs(rateLimitKey);
    if (lockRemainingMs > 0) {
      return NextResponse.json(
        { error: `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(lockRemainingMs / 60000)} minuto(s).` },
        { status: 429 },
      );
    }

    const requestingAdmin = await getUserByPin(adminPin);
    if (requestingAdmin?.role !== "admin") {
      recordFailedAttempt(rateLimitKey);
      return NextResponse.json({ error: "Acceso Denegado. Solo administradores pueden gestionar usuarios." }, { status: 403 });
    }
    clearAttempts(rateLimitKey);

    // Un admin no puede eliminar su propia cuenta desde aquí — evita que
    // se quede sin acceso a mitad de una sesión, o que borre por error la
    // única cuenta de administrador que existe.
    if (requestingAdmin.id === userId) {
      return NextResponse.json({ error: "No puedes eliminar tu propia cuenta." }, { status: 400 });
    }

    const { error: dbError } = await supabaseAdmin
      .from("users")
      .delete()
      .eq("id", userId);

    if (dbError) {
      return NextResponse.json({ error: "Error al eliminar usuario de la base de datos.", details: dbError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error en DELETE /api/admin/users:", error);
    return NextResponse.json({ error: "Error interno del servidor", details: error.message }, { status: 500 });
  }
}
