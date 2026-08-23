// Envoltorio para /api/quotes/save que imita la forma de respuesta de
// supabase-js ({ data, error }) para que los sitios que escribían en
// `quotes` directo desde el navegador puedan cambiar una sola línea sin
// tocar el resto de su lógica de reintentos/fallback.
export interface QuoteSaveResult {
  data: { id: string | number } | null;
  error: { message: string } | null;
}

export async function saveQuote(payload: { id?: string | number; fields: Record<string, any> }): Promise<QuoteSaveResult> {
  try {
    const res = await fetch("/api/quotes/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) {
      return { data: null, error: { message: json.error || "Error al guardar la cotización." } };
    }
    return { data: json.item, error: null };
  } catch (e: any) {
    return { data: null, error: { message: e.message || "Error de red al guardar la cotización." } };
  }
}
