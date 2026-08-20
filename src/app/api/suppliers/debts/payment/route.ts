import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";

// Registra un abono a una deuda con proveedor. Antes el INSERT en
// supplier_payments y el ajuste de supplier_debts se hacían directo desde
// el navegador. El interés por mora también se recalcula aquí (no se
// confía en el valor que calculó el navegador) usando la misma fórmula que
// ya existía en AccountsPayableModal.tsx.
function calculateInterest(balance: number, dueDate: string, penaltyRatePercent: number | null | undefined): number {
  const today = new Date();
  const due = new Date(dueDate);
  if (today <= due || !penaltyRatePercent || penaltyRatePercent <= 0) return 0;
  const diffTime = Math.abs(today.getTime() - due.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const dailyRate = (penaltyRatePercent / 100) / 30;
  return balance * dailyRate * diffDays;
}

export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const { debtId, amount, notes } = await request.json();
    if (!debtId || typeof amount !== "number" || isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: "Datos de abono inválidos." }, { status: 400 });
    }

    const { data: debt, error: debtError } = await supabaseAdmin
      .from("supplier_debts")
      .select("*, suppliers(name)")
      .eq("id", debtId)
      .single();
    if (debtError || !debt) {
      return NextResponse.json({ error: "Deuda no encontrada." }, { status: 404 });
    }

    const interest = calculateInterest(Number(debt.balance), debt.due_date, debt.penalty_rate_percent);
    const totalDue = Number(debt.balance) + interest;
    if (amount > totalDue + 0.05) {
      return NextResponse.json({ error: "El monto del abono no puede exceder el saldo pendiente + intereses." }, { status: 400 });
    }

    const { error: payError } = await supabaseAdmin.from("supplier_payments").insert({
      debt_id: debtId,
      amount,
      notes: (notes || "") + (interest > 0 ? ` (Incluye mora: $${interest.toFixed(2)})` : ""),
    });
    if (payError) {
      return NextResponse.json({ error: "Error al registrar el abono: " + payError.message }, { status: 500 });
    }

    let newBalance = Math.max(0, totalDue - amount);
    const { data: rpcBalance, error: rpcErr } = await supabaseAdmin.rpc("increment_supplier_debt_balance", {
      p_debt_id: debtId,
      p_delta: interest - amount,
    });
    if (rpcErr) {
      const { error: balanceError } = await supabaseAdmin.from("supplier_debts").update({ balance: newBalance }).eq("id", debtId);
      if (balanceError) {
        return NextResponse.json({ error: "Se registró el abono, pero no se pudo actualizar el saldo: " + balanceError.message }, { status: 500 });
      }
    } else {
      newBalance = Number(rpcBalance);
    }

    const newStatus = newBalance === 0 ? "paid" : debt.status;
    const { error: statusError } = await supabaseAdmin.from("supplier_debts").update({ status: newStatus }).eq("id", debtId);
    if (statusError) {
      console.error("No se pudo actualizar el estado de la deuda:", statusError);
    }

    return NextResponse.json({
      success: true,
      newBalance,
      interest,
      supplierName: debt.suppliers?.name || "Desconocido",
      concept: debt.concept,
    });
  } catch (error: any) {
    console.error("Error en /api/suppliers/debts/payment:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
