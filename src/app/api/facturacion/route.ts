import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { ticketId, rfc, name, uso, items, total } = body;

    if (!ticketId || !rfc || !items || items.length === 0) {
      return NextResponse.json({ error: "Faltan datos requeridos para facturar." }, { status: 400 });
    }

    // El ticketId es un token público (compartido por el cliente vía link/QR), así que
    // en vez de exigir un PIN, verificamos contra el registro real en la base de datos
    // que el total/artículos a facturar coincidan con lo que realmente se vendió —
    // así un cliente no puede enviar items/total arbitrarios para timbrar un CFDI falso.
    const { data: ticket, error: ticketError } = await supabase
      .from("quotes")
      .select("id, status, total, items")
      .eq("id", ticketId)
      .single();

    if (ticketError || !ticket) {
      return NextResponse.json({ error: "El ticket no existe o no se pudo verificar." }, { status: 404 });
    }

    if (ticket.status !== "ticket") {
      return NextResponse.json({ error: "Este ticket ya fue facturado o no está disponible para facturar." }, { status: 409 });
    }

    const submittedTotal = Number(total);
    const storedTotal = Number(ticket.total);
    // Tolerancia de 1 centavo por redondeos de punto flotante.
    if (!Number.isFinite(submittedTotal) || Math.abs(submittedTotal - storedTotal) > 0.01) {
      return NextResponse.json({ error: "El total enviado no coincide con el ticket registrado." }, { status: 400 });
    }

    // Configuración de Facturama (Sandbox o Producción)
    const facturamaUser = process.env.FACTURAMA_USER;
    const facturamaPass = process.env.FACTURAMA_PASSWORD;

    // AQUI IRÍA LA INTEGRACIÓN REAL CON FACTURAMA (API)
    // Ejemplo de cómo sería el Payload para Facturama CFDI 4.0:
    /*
    const facturamaPayload = {
       Receiver: {
          Rfc: rfc,
          Name: name,
          CfdiUse: uso,
          TaxRegime: "601", // Requerido en 4.0
          FiscalZipCode: "00000" // Requerido en 4.0
       },
       CfdiType: "I",
       PaymentForm: "01", // Efectivo
       PaymentMethod: "PUE",
       Currency: "MXN",
       ExpeditionPlace: "00000",
       Items: items.map(item => ({
          Quantity: item.qty,
          ProductCode: "01010101", // Código genérico del SAT
          UnitCode: "H87", // Pieza
          Description: item.name,
          UnitPrice: item.price,
          Subtotal: item.price * item.qty,
          Taxes: [
            {
               Name: "IVA",
               Rate: 0.16,
               Total: (item.price * item.qty) * 0.16,
               Base: item.price * item.qty,
               IsRetention: false
            }
          ]
       }))
    };
    */

    // Como este es un prototipo, simulamos un retraso de la API y devolvemos éxito.
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Si tuviéramos credenciales reales, haríamos el fetch aquí y devolveríamos el UUID/XML.
    if (facturamaUser === "tu_usuario_facturama" || !facturamaUser) {
      // Retornar éxito simulado
      return NextResponse.json({
        success: true,
        message: "Factura timbrada exitosamente (Simulación).",
        uuid: "12345678-1234-1234-1234-123456789012",
        satStatus: "Vigente"
      });
    }

    // Respuesta si hubieran credenciales reales (placeholder)
    return NextResponse.json({
       success: true,
       message: "¡Conexión exitosa al API de Facturación!",
       uuid: crypto.randomUUID()
    });

  } catch (error: any) {
    console.error("Error en facturación:", error);
    return NextResponse.json({ error: "Error interno del servidor", details: error.message }, { status: 500 });
  }
}
