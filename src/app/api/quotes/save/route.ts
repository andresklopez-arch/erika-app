import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";
import { pickAllowedQuoteFields } from "@/lib/quotesFields";

// Crea o edita una fila de `quotes` (cotización, ticket de venta, o el
// cambio de estado/notas de uno ya existente — todo vive en esta misma
// tabla). Antes esto se escribía directo desde el navegador con la llave
// pública en media docena de lugares distintos (guardar cotización, cobrar
// un ticket, editar su nota, marcarlo como cancelado o convertido, marcar
// el WhatsApp como enviado) — quotes es de las últimas tablas de negocio
// que seguían abiertas (ver AGENTS.md, sección de tablas pendientes).
// Sigue el mismo patrón que /api/inventory/save: un solo endpoint
// agrupado por la FORMA del cambio (crear/editar por id con lista blanca
// de columnas), no uno por pantalla.
export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const { id, fields } = await request.json();
    if (!fields || typeof fields !== "object") {
      return NextResponse.json({ error: "Datos de cotización inválidos." }, { status: 400 });
    }

    const cleanFields = pickAllowedQuoteFields(fields);
    if (Object.keys(cleanFields).length === 0) {
      return NextResponse.json({ error: "Ningún campo válido para guardar." }, { status: 400 });
    }

    let savedItem;
    if (id) {
      const { data, error } = await supabaseAdmin.from("quotes").update(cleanFields).eq("id", id).select("id").single();
      if (error) return NextResponse.json({ error: "Error al actualizar la cotización: " + error.message }, { status: 400 });
      savedItem = data;
    } else {
      const { data, error } = await supabaseAdmin.from("quotes").insert(cleanFields).select("id").single();
      if (error) return NextResponse.json({ error: "Error al crear la cotización: " + error.message }, { status: 400 });
      savedItem = data;
    }

    return NextResponse.json({ success: true, item: savedItem });
  } catch (error: any) {
    console.error("Error en /api/quotes/save:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
