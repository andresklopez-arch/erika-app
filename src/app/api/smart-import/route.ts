import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    // Convert file to base64
    const arrayBuffer = await file.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = file.type || "application/octet-stream";

    const prompt = `Eres un asistente experto en ferretería. Analiza esta imagen/documento de lista de precios o factura y extrae TODOS los productos que encuentres.

Para CADA producto extrae:
- code: código SKU o número de parte (si no hay, genera uno con formato FER-XXX-001)
- name: nombre completo del producto
- cost: precio de costo o precio de proveedor (número sin símbolos)
- price: precio de venta al público (número sin símbolos, si no existe déjalo en 0)
- stock: cantidad o existencia (número entero, si no hay pon 1)

Responde ÚNICAMENTE con un JSON válido en este formato exacto, sin texto adicional:
{
  "products": [
    {"code": "SKU-001", "name": "Nombre Producto", "cost": 100.00, "price": 150.00, "stock": 10},
    ...
  ]
}

Si no puedes leer el documento o está vacío, responde: {"products": []}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Data,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", errText);
      return NextResponse.json({ error: "Gemini API error", detail: errText }, { status: 502 });
    }

    const geminiResult = await response.json();
    const rawText = geminiResult?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Parse JSON from Gemini response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ products: [] });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ products: parsed.products || [] });
  } catch (err: any) {
    console.error("smart-import error:", err);
    return NextResponse.json({ error: err.message || "Unknown error" }, { status: 500 });
  }
}
