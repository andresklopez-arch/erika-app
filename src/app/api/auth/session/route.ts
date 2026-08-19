import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";

// Reemplaza la confianza ciega en `ERIKA_USER` de localStorage (forjable
// desde la consola del navegador). AuthProvider llama aquí al cargar la app
// para obtener el usuario real desde la cookie firmada por el servidor, con
// rol/permisos frescos de la base de datos — así un cambio de permisos
// hecho por un admin aplica de inmediato en vez de hasta el siguiente login.
export async function GET() {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ user: null }, { status: 401 });
    }

    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("id, name, role, permissions")
      .eq("id", userId)
      .single();

    if (error || !user) {
      return NextResponse.json({ user: null }, { status: 401 });
    }

    return NextResponse.json({ user });
  } catch (error: any) {
    console.error("Error en /api/auth/session:", error);
    return NextResponse.json({ user: null, error: "Error interno del servidor" }, { status: 500 });
  }
}
