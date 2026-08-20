import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";

// Registra un abono a un apartado. Antes el RPC increment_layaway_balance
// y el UPDATE de status se hacían directo desde el navegador.
export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const { layawayId, payment } = await request.json();
    if (!layawayId || typeof payment !== "number" || isNaN(payment) || payment <= 0) {
      return NextResponse.json({ error: "Datos de abono inválidos." }, { status: 400 });
    }

    const { data: layaway, error: layawayError } = await supabaseAdmin.from("layaways").select("*").eq("id", layawayId).single();
    if (layawayError || !layaway) {
      return NextResponse.json({ error: "Apartado no encontrado." }, { status: 404 });
    }
    if (payment > layaway.balance) {
      return NextResponse.json({ error: "El abono no puede superar el saldo pendiente." }, { status: 400 });
    }

    let newBalance = Number(layaway.balance) - payment;
    const { data: rpcBalance, error: rpcErr } = await supabaseAdmin.rpc("increment_layaway_balance", {
      p_layaway_id: layawayId,
      p_delta: -payment,
    });
    if (rpcErr) {
      const { error: balanceError } = await supabaseAdmin.from("layaways").update({ balance: newBalance }).eq("id", layawayId);
      if (balanceError) return NextResponse.json({ error: "Error al registrar el abono: " + balanceError.message }, { status: 500 });
    } else {
      newBalance = Number(rpcBalance);
    }

    const isCompleted = newBalance <= 0.01;
    const { error: statusError } = await supabaseAdmin
      .from("layaways")
      .update({ status: isCompleted ? "completed" : "pending" })
      .eq("id", layawayId);
    if (statusError) {
      return NextResponse.json({ error: "El abono se registró, pero no se pudo actualizar el estado del apartado." }, { status: 500 });
    }

    return NextResponse.json({ success: true, newBalance, isCompleted, customerName: layaway.customer_name });
  } catch (error: any) {
    console.error("Error en /api/layaways/pay:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
