import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";

// Registra una nueva deuda con un proveedor. Antes el INSERT se hacía
// directo desde el navegador con la llave pública.
export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const { supplier_id, amount, due_date, concept, penalty_rate_percent } = await request.json();
    if (!supplier_id || typeof amount !== "number" || isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: "Datos de deuda inválidos." }, { status: 400 });
    }

    const { data: debt, error } = await supabaseAdmin
      .from("supplier_debts")
      .insert({
        supplier_id,
        amount,
        balance: amount,
        due_date,
        concept,
        penalty_rate_percent: penalty_rate_percent || 0,
      })
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: "Error al registrar la deuda: " + error.message }, { status: 500 });
    return NextResponse.json({ success: true, debt });
  } catch (error: any) {
    console.error("Error en /api/suppliers/debts/save:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
