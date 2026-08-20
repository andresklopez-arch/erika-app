import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";
import { pickSupplierFields } from "@/lib/suppliersFields";

// Crea o edita un proveedor. Antes se escribía directo en `suppliers`
// desde el navegador con la llave pública — sin sesión siquiera.
export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const { id, fields } = await request.json();
    if (!fields || typeof fields !== "object") {
      return NextResponse.json({ error: "Datos de proveedor inválidos." }, { status: 400 });
    }

    const cleanFields = pickSupplierFields(fields);
    if (Object.keys(cleanFields).length === 0) {
      return NextResponse.json({ error: "Ningún campo válido para guardar." }, { status: 400 });
    }

    let savedSupplier;
    if (id) {
      const { data, error } = await supabaseAdmin.from("suppliers").update(cleanFields).eq("id", id).select().single();
      if (error) return NextResponse.json({ error: "Error al actualizar proveedor: " + error.message }, { status: 400 });
      savedSupplier = data;
    } else {
      if (!cleanFields.name) {
        return NextResponse.json({ error: "El nombre es requerido para crear un proveedor." }, { status: 400 });
      }
      const { data, error } = await supabaseAdmin.from("suppliers").insert(cleanFields).select().single();
      if (error) return NextResponse.json({ error: "Error al crear proveedor: " + error.message }, { status: 400 });
      savedSupplier = data;
    }

    return NextResponse.json({ success: true, supplier: savedSupplier });
  } catch (error: any) {
    console.error("Error en /api/suppliers/save:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
