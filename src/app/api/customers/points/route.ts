import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";

// Ajusta (suma o resta) los puntos de lealtad de un cliente. Antes se
// llamaba al RPC increment_customer_points directo desde el navegador con
// la llave pública — esa función es SECURITY DEFINER (ignora RLS de
// customers) y por default Supabase la deja ejecutable por cualquiera, así
// que cualquiera podía regalarse puntos infinitos desde la consola sin
// pasar por ninguna compra real.
export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const { customerId, delta } = await request.json();
    if (!customerId || typeof delta !== "number" || isNaN(delta) || delta === 0) {
      return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
    }

    const { data: customer, error: customerError } = await supabaseAdmin
      .from("customers")
      .select("id, points")
      .eq("id", customerId)
      .single();
    if (customerError || !customer) {
      return NextResponse.json({ error: "Cliente no encontrado." }, { status: 404 });
    }

    if (delta < 0 && Number(customer.points || 0) + delta < 0) {
      return NextResponse.json({ error: "El cliente no tiene suficientes puntos." }, { status: 400 });
    }

    let newPoints = Math.max(0, Number(customer.points || 0) + delta);
    const { data: rpcPoints, error: rpcError } = await supabaseAdmin.rpc("increment_customer_points", {
      p_customer_id: customerId,
      p_delta: delta,
    });
    if (rpcError) {
      const { error: fallbackError } = await supabaseAdmin.from("customers").update({ points: newPoints }).eq("id", customerId);
      if (fallbackError) {
        return NextResponse.json({ error: "Error al actualizar puntos: " + fallbackError.message }, { status: 500 });
      }
    } else {
      newPoints = Number(rpcPoints);
    }

    return NextResponse.json({ success: true, newPoints });
  } catch (error: any) {
    console.error("Error en /api/customers/points:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
