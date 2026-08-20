import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";
import { verifyAdminPin } from "@/lib/verifyAdminPin";
import { getClientKey, getLockRemainingMs, recordFailedAttempt, clearAttempts } from "@/lib/rateLimit";

// Registra un cargo a crédito (venta a cuenta de un cliente). Antes el
// INSERT en credit_transactions y el ajuste de customers.balance se hacían
// directo desde el navegador con la llave pública — cualquiera podía
// forjar cargos a nombre de cualquier cliente, o saltarse por completo la
// autorización de sobregiro tecleando el request a mano. El servidor
// vuelve a validar aquí el límite de crédito (no confía en que el cliente
// ya lo haya verificado en pantalla) antes de escribir.
export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const { customerId, amount, ticketId, adminPin } = await request.json();
    if (!customerId || typeof amount !== "number" || isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: "Datos de cargo inválidos." }, { status: 400 });
    }

    const { data: customer, error: customerError } = await supabaseAdmin
      .from("customers")
      .select("id, name, balance, credit_limit")
      .eq("id", customerId)
      .single();
    if (customerError || !customer) {
      return NextResponse.json({ error: "Cliente no encontrado." }, { status: 404 });
    }

    if (Number(customer.balance || 0) + amount > Number(customer.credit_limit || 0)) {
      const rateLimitKey = getClientKey(request, "credit-charge-overdraft");
      const lockRemainingMs = getLockRemainingMs(rateLimitKey);
      if (lockRemainingMs > 0) {
        return NextResponse.json(
          { error: `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(lockRemainingMs / 60000)} minuto(s).` },
          { status: 429 },
        );
      }
      if (!adminPin || !(await verifyAdminPin(adminPin))) {
        recordFailedAttempt(rateLimitKey);
        return NextResponse.json(
          { error: "Límite de crédito excedido. Se requiere PIN de Administrador para autorizar el sobregiro." },
          { status: 403 },
        );
      }
      clearAttempts(rateLimitKey);
    }

    const { error: txError } = await supabaseAdmin.from("credit_transactions").insert({
      customer_id: customerId,
      type: "charge",
      amount,
      notes: `Venta a Crédito Ticket #${ticketId ?? ""}`.trim(),
    });
    if (txError) {
      return NextResponse.json({ error: "Error al cobrar a crédito: " + txError.message }, { status: 500 });
    }

    let newBalance = Number(customer.balance || 0) + amount;
    const { data: rpcBalance, error: rpcError } = await supabaseAdmin.rpc("increment_customer_balance", {
      p_customer_id: customerId,
      p_delta: amount,
    });
    if (rpcError) {
      const { error: fallbackError } = await supabaseAdmin
        .from("customers")
        .update({ balance: newBalance })
        .eq("id", customerId);
      if (fallbackError) {
        return NextResponse.json(
          { error: "Se registró el cargo pero falló la actualización del saldo del cliente: " + fallbackError.message },
          { status: 500 },
        );
      }
    } else {
      newBalance = Number(rpcBalance);
    }

    return NextResponse.json({ success: true, newBalance, customerName: customer.name });
  } catch (error: any) {
    console.error("Error en /api/credit/charge:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
