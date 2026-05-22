import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabaseClient";

export async function POST(request: Request) {
  try {
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
