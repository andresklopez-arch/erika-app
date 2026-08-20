import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";
import { verifyAdminPin } from "@/lib/verifyAdminPin";
import { getClientKey, getLockRemainingMs, recordFailedAttempt, clearAttempts } from "@/lib/rateLimit";

const VALID_TYPES = new Set(["sale", "deposit", "withdrawal"]);

// Registra un movimiento de caja (venta, ingreso, retiro o devolución).
// Antes el INSERT en cash_transactions se hacía directo desde el navegador
// con la llave pública — cualquiera con la consola abierta podía forjar
// ventas, ingresos o retiros sin que ese dinero hubiera existido nunca.
// Usado por: registerMovement (caja/page.tsx), el checkout del POS y la
// devolución (POSModule.tsx), y la sincronización de ventas offline
// (offlineSync.ts) — todos ahora comparten este único endpoint mediante
// src/lib/cashTransactionClient.ts.
export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const { type, amount, description, device_info, payment_method, cash_amount, card_amount, transfer_amount, adminPin } = await request.json();

    if (!VALID_TYPES.has(type)) {
      return NextResponse.json({ error: "Tipo de transacción inválido." }, { status: 400 });
    }
    if (typeof amount !== "number" || isNaN(amount) || amount === 0) {
      return NextResponse.json({ error: "Monto inválido." }, { status: 400 });
    }

    // Retiros de alto valor requieren PIN de Administrador — igual que
    // antes, un administrador autenticado no necesita volver a teclear su
    // propio PIN. La diferencia es que el rol ahora se confirma aquí
    // contra la base de datos, no se confía en lo que el navegador diga
    // que es el usuario actual.
    if (type === "withdrawal" && amount > 2000) {
      const { data: requester } = await supabaseAdmin.from("users").select("name, role").eq("id", userId).single();
      if (requester?.role !== "admin") {
        const rateLimitKey = getClientKey(request, "caja-transaction-withdrawal");
        const lockRemainingMs = getLockRemainingMs(rateLimitKey);
        if (lockRemainingMs > 0) {
          return NextResponse.json(
            { error: `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(lockRemainingMs / 60000)} minuto(s).` },
            { status: 429 },
          );
        }
        if (!adminPin || !(await verifyAdminPin(adminPin))) {
          recordFailedAttempt(rateLimitKey);
          await supabaseAdmin.from("error_logs").insert({
            module: "Caja_Retiro_PIN_Rechazado",
            error_details: `Intento de retiro de $${amount} con PIN de administrador inválido.`,
            usuario: requester?.name || "Desconocido",
          });
          return NextResponse.json({ error: "Este retiro de alto valor requiere PIN de Administrador." }, { status: 403 });
        }
        clearAttempts(rateLimitKey);
      }
    }

    // La sesión de caja SIEMPRE se resuelve aquí (la actualmente abierta),
    // sin importar qué session_id haya mandado el cliente — antes las
    // ventas encoladas offline (IndexedDB) se guardaban con session_id=0 de
    // marcador de posición y nunca se corregía, así que al sincronizar la
    // inserción fallaba silenciosamente contra la restricción de llave
    // foránea y la venta quedaba atorada reintentando para siempre.
    const { data: session } = await supabaseAdmin
      .from("cash_sessions")
      .select("id, opened_at")
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!session) {
      return NextResponse.json({ error: "La caja está cerrada." }, { status: 409 });
    }

    // Una caja abierta por más de 48h casi seguro es una sesión olvidada
    // (ver alerta "Caja Olvidada" en IntelligenceNotifications.tsx), no un
    // turno real. Se bloquean nuevos movimientos para forzar su cierre —
    // así los datos del corte no se siguen mezclando con turnos de días
    // distintos — sin importar si el cierre real terminará descuadrado.
    const hoursOpen = (Date.now() - new Date(session.opened_at).getTime()) / 3_600_000;
    if (hoursOpen >= 48) {
      return NextResponse.json(
        { error: `La caja lleva abierta más de 48 horas sin cerrarse (desde hace ${Math.floor(hoursOpen / 24)} día(s)). Un administrador debe cerrarla antes de registrar más movimientos.` },
        { status: 409 },
      );
    }

    const insertPayload: Record<string, any> = {
      session_id: session.id,
      type,
      amount,
      description: description || null,
    };
    if (device_info !== undefined) insertPayload.device_info = device_info;
    if (payment_method !== undefined) insertPayload.payment_method = payment_method;
    if (cash_amount !== undefined) insertPayload.cash_amount = cash_amount;
    if (card_amount !== undefined) insertPayload.card_amount = card_amount;
    if (transfer_amount !== undefined) insertPayload.transfer_amount = transfer_amount;

    const { data: transaction, error } = await supabaseAdmin
      .from("cash_transactions")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, transaction });
  } catch (error: any) {
    console.error("Error en /api/caja/transaction:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
