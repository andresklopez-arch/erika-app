import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { z } from "zod";

// Zod schema for validating user input
const UserInputSchema = z.object({
  name: z.string().min(1, "El nombre es requerido."),
  pin: z.string().min(4, "El PIN debe tener al menos 4 dígitos."),
  role: z.string().min(1, "El rol es requerido."),
  permissions: z.record(z.boolean()).default({}),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { adminPin, user } = body;

    if (!adminPin) {
      return NextResponse.json({ error: "Se requiere el PIN de administrador." }, { status: 401 });
    }

    // Verificar en el servidor si el PIN pertenece a un administrador
    const { data: adminUser, error: adminError } = await supabase
      .from("users")
      .select("role")
      .eq("pin", adminPin)
      .single();

    if (adminError || !adminUser || adminUser.role !== "admin") {
      return NextResponse.json({ error: "Acceso Denegado. Solo administradores pueden gestionar usuarios." }, { status: 403 });
    }

    // Validar el payload con Zod
    const validationResult = UserInputSchema.safeParse(user);
    if (!validationResult.success) {
      return NextResponse.json({ error: "Datos de usuario inválidos.", details: validationResult.error.format() }, { status: 400 });
    }

    const { name, pin, role, permissions } = validationResult.data;

    // Crear en la base de datos
    const { data: newUser, error: dbError } = await supabase
      .from("users")
      .insert({
        name,
        pin,
        role,
        permissions,
      })
      .select()
      .single();

    if (dbError) {
      return NextResponse.json({ error: "Error al crear usuario. El PIN podría estar duplicado.", details: dbError.message }, { status: 400 });
    }

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

    // Verificar en el servidor si el PIN pertenece a un administrador
    const { data: adminUser, error: adminError } = await supabase
      .from("users")
      .select("role")
      .eq("pin", adminPin)
      .single();

    if (adminError || !adminUser || adminUser.role !== "admin") {
      return NextResponse.json({ error: "Acceso Denegado. Solo administradores pueden gestionar usuarios." }, { status: 403 });
    }

    // Validar el payload con Zod
    const validationResult = UserInputSchema.safeParse(user);
    if (!validationResult.success) {
      return NextResponse.json({ error: "Datos de usuario inválidos.", details: validationResult.error.format() }, { status: 400 });
    }

    const { name, pin, role, permissions } = validationResult.data;

    // Actualizar en la base de datos
    const { data: updatedUser, error: dbError } = await supabase
      .from("users")
      .update({
        name,
        pin,
        role,
        permissions,
      })
      .eq("id", userId)
      .select()
      .single();

    if (dbError) {
      return NextResponse.json({ error: "Error al actualizar usuario. El PIN podría estar duplicado.", details: dbError.message }, { status: 400 });
    }

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

    // Verificar en el servidor si el PIN pertenece a un administrador
    const { data: adminUser, error: adminError } = await supabase
      .from("users")
      .select("role")
      .eq("pin", adminPin)
      .single();

    if (adminError || !adminUser || adminUser.role !== "admin") {
      return NextResponse.json({ error: "Acceso Denegado. Solo administradores pueden gestionar usuarios." }, { status: 403 });
    }

    // Eliminar de la base de datos
    const { error: dbError } = await supabase
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
