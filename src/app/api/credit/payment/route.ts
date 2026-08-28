import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";

// Registra un abono a la cuenta de un cliente. Antes el INSERT en
// credit_transactions y el descuento de customers.balance se hacían
// directo desde el navegador con la llave pública — cualquiera podía
// forjar abonos a cualquier cliente (borrando deuda real sin que el dinero
// hubiera entrado nunca a la caja).
export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const { customerId, amount, notes } = await request.json();
    if (!customerId || typeof amount !== "number" || isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: "Cantidad inválida." }, { status: 400 });
    }

    const { data: customer, error: customerError } = await supabaseAdmin
      .from("customers")
      .select("id, name, phone, balance")
      .eq("id", customerId)
      .single();
    if (customerError || !customer) {
      return NextResponse.json({ error: "Cliente no encontrado." }, { status: 404 });
    }

    const { error: txError } = await supabaseAdmin.from("credit_transactions").insert({
      customer_id: customerId,
      type: "payment",
      amount,
      notes: notes || "Abono a cuenta",
    });
    if (txError) {
      return NextResponse.json({ error: "Error: " + txError.message }, { status: 500 });
    }

    let newBalance = Number(customer.balance || 0) - amount;
    const { data: rpcBalance, error: rpcError } = await supabaseAdmin.rpc("increment_customer_balance", {
      p_customer_id: customerId,
      p_delta: -amount,
    });
    if (rpcError) {
      const { error: fallbackError } = await supabaseAdmin
        .from("customers")
        .update({ balance: newBalance })
        .eq("id", customerId);
      if (fallbackError) {
        return NextResponse.json(
          { error: "Se registró el abono en el historial, pero falló la actualización del saldo del cliente: " + fallbackError.message },
          { status: 500 },
        );
      }
    } else {
      newBalance = Number(rpcBalance);
    }

    // Antes un abono a crédito solo movía credit_transactions/customers.balance
    // y nunca aparecía en Arqueo de Caja -- el cajero tenía que ir aparte a
    // registrar un "Ingreso" manual para que el efectivo recibido contara en
    // el corte del día, un paso separado que no tenía nada que ver con
    // registrar el abono en sí. Si hay una caja abierta, se registra aquí
    // mismo. Si no hay caja abierta no se bloquea el abono (la deuda ya se
    // redujo legítimamente) -- solo se avisa al frontend para que el cajero
    // sepa que ese efectivo no quedó en ningún corte.
    let cashRegistered = false;
    try {
      const { data: session } = await supabaseAdmin
        .from("cash_sessions")
        .select("id")
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (session) {
        const { error: cashError } = await supabaseAdmin.from("cash_transactions").insert({
          session_id: session.id,
          type: "deposit",
          amount,
          description: `Abono a cuenta - ${customer.name}`,
        });
        cashRegistered = !cashError;
        if (cashError) console.error("Error al registrar abono en caja:", cashError.message);
      }
    } catch (e) {
      console.error("Error al registrar abono en caja:", e);
    }

    return NextResponse.json({ success: true, newBalance, customerName: customer.name, customerPhone: customer.phone, cashRegistered });
  } catch (error: any) {
    console.error("Error en /api/credit/payment:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
