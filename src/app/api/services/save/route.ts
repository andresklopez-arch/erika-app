import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";
import { pickServiceFields } from "@/lib/servicesFields";

// Crea o edita una cita de servicio. Antes se escribía directo en
// `services` desde el navegador con la llave pública — sin sesión.
export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const { id, fields } = await request.json();
    if (!fields || typeof fields !== "object") {
      return NextResponse.json({ error: "Datos de servicio inválidos." }, { status: 400 });
    }

    const cleanFields = pickServiceFields(fields);
    if (Object.keys(cleanFields).length === 0) {
      return NextResponse.json({ error: "Ningún campo válido para guardar." }, { status: 400 });
    }

    let savedService;
    if (id) {
      const { data, error } = await supabaseAdmin.from("services").update(cleanFields).eq("id", id).select().single();
      if (error) return NextResponse.json({ error: "Error al actualizar la cita: " + error.message }, { status: 400 });
      savedService = data;
    } else {
      if (!cleanFields.customer_name) {
        return NextResponse.json({ error: "El nombre del cliente es requerido." }, { status: 400 });
      }
      if (!cleanFields.status) cleanFields.status = "pending";
      const { data, error } = await supabaseAdmin.from("services").insert(cleanFields).select().single();
      if (error) return NextResponse.json({ error: "Error al crear la cita: " + error.message }, { status: 400 });
      savedService = data;
    }

    return NextResponse.json({ success: true, service: savedService });
  } catch (error: any) {
    console.error("Error en /api/services/save:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
