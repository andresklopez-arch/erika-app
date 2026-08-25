import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Detección automática del bug de producción del 2026-08-25: durante 4
// días el checkout guardó bien el dinero (cash_transactions) pero NUNCA
// pudo guardar el ticket en `quotes` (columnas que el código esperaba
// nunca se crearon en la base real) — nadie se enteró hasta que la
// clienta reportó por WhatsApp que no encontraba sus ventas. Este
// endpoint hace exactamente lo que hace el checkout real (inserta un
// ticket con las mismas columnas: customer_id, discount_pct, apply_iva,
// notes) y lo borra de inmediato, para que un cron/monitor externo pueda
// detectar el mismo tipo de falla en minutos, no en días.
//
// Protegido con el mismo patrón que el webhook de Facturama: un secreto
// por query param (los servicios de cron/uptime rara vez soportan
// headers personalizados), comparado con timingSafeEqual.
function isValidHealthCheckSecret(request: Request): boolean {
  const expected = process.env.HEALTH_CHECK_SECRET;
  // Fail closed: sin secreto configurado, nadie puede disparar este check
  // (evita que cualquiera fuerce inserts/deletes repetidos en `quotes`).
  if (!expected) return false;

  const url = new URL(request.url);
  const provided = request.headers.get("x-health-check-secret") || url.searchParams.get("secret") || "";

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

async function runCheck() {
  const marker = `HEALTHCHECK-${Date.now()}`;
  const { data, error } = await supabaseAdmin
    .from("quotes")
    .insert({
      customer_name: marker,
      customer_id: null,
      items: [],
      total: 0,
      status: "ticket",
      discount_pct: 0,
      apply_iva: false,
      notes: "health check automatico, seguro borrar",
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  const { error: deleteError } = await supabaseAdmin.from("quotes").delete().eq("id", data.id);
  if (deleteError) {
    // El insert sí funcionó (lo que nos importa para detectar el bug), pero
    // dejamos rastro en error_logs para no acumular filas de prueba sin que
    // nadie lo note.
    await supabaseAdmin.from("error_logs").insert({
      module: "HealthCheck_QuotesSync_Cleanup",
      error_details: `No se pudo borrar la fila de prueba ${data.id}: ${deleteError.message}`,
      usuario: "HealthCheck",
    });
  }

  return { ok: true };
}

export async function GET(request: Request) {
  if (!isValidHealthCheckSecret(request)) {
    return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });
  }

  try {
    const result = await runCheck();
    if (!result.ok) {
      await supabaseAdmin.from("error_logs").insert({
        module: "HealthCheck_QuotesSync",
        error_details: `quotes dejó de aceptar escrituras: ${result.error}`,
        usuario: "HealthCheck",
      });
      return NextResponse.json({ ok: false, error: result.error }, { status: 503 });
    }
    return NextResponse.json({ ok: true, checkedAt: new Date().toISOString() });
  } catch (error: any) {
    console.error("Error en /api/health/quotes-sync:", error);
    return NextResponse.json({ ok: false, error: "Error interno del servidor" }, { status: 500 });
  }
}
