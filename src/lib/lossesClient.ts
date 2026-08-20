// Envoltorio para /api/losses/save — mismo patrón que los demás clientes
// de escritura server-side de esta sesión.

interface Result {
  data: any | null;
  error: { message: string } | null;
}

export async function saveLoss(fields: Record<string, any>): Promise<Result> {
  try {
    const res = await fetch("/api/losses/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: { message: json.error || "Error desconocido" } };
    return { data: json.loss, error: null };
  } catch (e: any) {
    return { data: null, error: { message: e.message || "Error de red" } };
  }
}
