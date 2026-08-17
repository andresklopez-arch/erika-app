import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { supabase } from "../../../../lib/supabaseClient";

function isValidWebhookSecret(request: Request): boolean {
  const expected = process.env.FACTURAMA_WEBHOOK_SECRET;
  // Fail closed: si no hay secreto configurado, no se acepta ningún webhook.
  if (!expected) return false;

  // Facturama solo permite configurar una URL de callback (sin headers personalizados),
  // así que aceptamos el secreto como query param; también se admite por header
  // por si en el futuro se usa un proxy/relay que sí soporte headers.
  const url = new URL(request.url);
  const provided = request.headers.get("x-facturama-secret") || url.searchParams.get("secret") || "";

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export async function POST(request: Request) {
  try {
    if (!isValidWebhookSecret(request)) {
      return NextResponse.json({ success: false, error: "No autorizado." }, { status: 401 });
    }

    const body = await request.json();

    // Webhook de Facturama que avisa si una factura fue cancelada por el SAT
    if (body && body.Status === "Canceled") {
      const quoteId = body.Id; // Asumimos que Facturama nos envía el ID interno

      const { error } = await supabase
        .from("quotes")
        .update({
          status: "cancelled",
          notes: `Cancelada en el SAT el ${new Date().toLocaleString()}`,
        })
        .eq("id", quoteId);

      if (error) throw error;

      return NextResponse.json({
        success: true,
        message: "Factura marcada como cancelada",
      });
    }

    return NextResponse.json({ success: true, message: "Evento ignorado" });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}
