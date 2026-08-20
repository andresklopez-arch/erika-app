import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";
import { verifyAdminPin } from "@/lib/verifyAdminPin";
import { getCashAmount, getCardAmount, getTransferAmount } from "@/lib/cashSessionMath";

// Cierra el turno de caja (Corte de Caja Ciego). Antes el UPDATE en
// cash_sessions (incluyendo expected_balance/discrepancy, los campos que
// prueban si hubo un faltante) se hacía directo desde el navegador con la
// llave pública — cualquiera con la consola abierta podía "cerrar" la caja
// con descuadre=0 para ocultar un robo, sin que el PIN de admin verificado
// en pantalla tuviera ningún efecto real sobre lo que se guardaba en la
// base de datos. Ahora el propio servidor recalcula el corte desde las
// transacciones reales (ignora lo que mande el cliente) y vuelve a
// verificar el PIN de administrador antes de escribir.
export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const { sessionId, countedTotal, adminPin } = await request.json();
    if (!sessionId || typeof countedTotal !== "number" || isNaN(countedTotal)) {
      return NextResponse.json({ error: "Datos de cierre inválidos." }, { status: 400 });
    }
    if (!adminPin || !(await verifyAdminPin(adminPin))) {
      return NextResponse.json({ error: "Acceso Denegado. PIN inválido o sin privilegios de administrador." }, { status: 403 });
    }

    const { data: session, error: sessionError } = await supabaseAdmin
      .from("cash_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();
    if (sessionError || !session) {
      return NextResponse.json({ error: "Sesión de caja no encontrada." }, { status: 404 });
    }
    if (session.status !== "open") {
      return NextResponse.json({ error: "Esta caja ya está cerrada." }, { status: 409 });
    }

    const { data: transactions } = await supabaseAdmin
      .from("cash_transactions")
      .select("*")
      .eq("session_id", sessionId);
    const txs = transactions || [];

    const expectedCashSales = txs.filter((t) => t.type === "sale").reduce((sum, t) => sum + getCashAmount(t), 0);
    const expectedCardSales = txs.filter((t) => t.type === "sale").reduce((sum, t) => sum + getCardAmount(t), 0);
    const expectedTransferSales = txs.filter((t) => t.type === "sale").reduce((sum, t) => sum + getTransferAmount(t), 0);
    const expectedDeposits = txs.filter((t) => t.type === "deposit").reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const expectedWithdrawals = txs.filter((t) => t.type === "withdrawal").reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const expectedTotal = Number(session.initial_balance) + expectedCashSales + expectedDeposits - expectedWithdrawals;
    const discrepancy = countedTotal - expectedTotal;
    const totalSales = expectedCashSales + expectedCardSales + expectedTransferSales;

    const { error: updateError } = await supabaseAdmin
      .from("cash_sessions")
      .update({
        closed_at: new Date().toISOString(),
        expected_balance: expectedTotal,
        counted_balance: countedTotal,
        discrepancy,
        status: "closed",
        total_sales: totalSales,
      })
      .eq("id", sessionId);

    if (updateError) {
      return NextResponse.json({ error: "Error al cerrar caja: " + updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      ticket: {
        fondo: session.initial_balance,
        ventas: totalSales,
        ventasEfectivo: expectedCashSales,
        ventasTarjeta: expectedCardSales,
        ventasTransferencia: expectedTransferSales,
        ingresos: expectedDeposits,
        retiros: expectedWithdrawals,
        esperado: expectedTotal,
        fisico: countedTotal,
        descuadre: discrepancy,
      },
    });
  } catch (error: any) {
    console.error("Error en /api/caja/close:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
