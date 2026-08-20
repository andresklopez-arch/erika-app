import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";

// Crea un apartado (layaway). Antes el INSERT se hacía directo desde el
// navegador con la llave pública.
export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const { customer_id, customer_name, total_amount, down_payment, balance, due_date, items } = await request.json();
    if (typeof total_amount !== "number" || typeof down_payment !== "number" || typeof balance !== "number") {
      return NextResponse.json({ error: "Datos de apartado inválidos." }, { status: 400 });
    }

    const { data: layaway, error } = await supabaseAdmin
      .from("layaways")
      .insert({
        customer_id: customer_id || null,
        customer_name: customer_name || "Desconocido",
        total_amount,
        down_payment,
        balance,
        due_date,
        items,
        status: "pending",
      })
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: "Error al crear apartado: " + error.message }, { status: 500 });
    return NextResponse.json({ success: true, layaway });
  } catch (error: any) {
    console.error("Error en /api/layaways/create:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
