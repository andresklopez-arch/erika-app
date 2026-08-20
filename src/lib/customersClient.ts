// Envoltorios para /api/customers/* que imitan la forma de respuesta de
// supabase-js ({ data, error }), para poder cambiar los sitios que
// escribían en `customers` directo desde el navegador cambiando una sola
// línea, sin tocar el resto de su lógica (duplicados, confirmaciones, etc).

interface Result {
  data: any | null;
  error: { message: string } | null;
}

export async function saveCustomer(fields: Record<string, any>): Promise<Result> {
  try {
    const res = await fetch("/api/customers/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: { message: json.error || "Error desconocido" } };
    return { data: json.customer, error: null };
  } catch (e: any) {
    return { data: null, error: { message: e.message || "Error de red" } };
  }
}

export async function deleteCustomer(id: string, action: "soft" | "restore" | "hard"): Promise<Result> {
  try {
    const res = await fetch("/api/customers/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: { message: json.error || "Error desconocido" } };
    return { data: null, error: null };
  } catch (e: any) {
    return { data: null, error: { message: e.message || "Error de red" } };
  }
}

export async function adjustCustomerPoints(customerId: string, delta: number): Promise<Result & { newPoints?: number }> {
  try {
    const res = await fetch("/api/customers/points", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId, delta }),
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: { message: json.error || "Error desconocido" } };
    return { data: null, error: null, newPoints: json.newPoints };
  } catch (e: any) {
    return { data: null, error: { message: e.message || "Error de red" } };
  }
}
