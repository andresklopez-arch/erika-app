// Envoltorios para /api/layaways/* — mismo patrón que cashTransactionClient.ts
// y customersClient.ts: imitan { data, error } de supabase-js.

interface Result {
  data: any | null;
  error: { message: string } | null;
}

export async function createLayaway(fields: Record<string, any>): Promise<Result> {
  try {
    const res = await fetch("/api/layaways/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: { message: json.error || "Error desconocido" } };
    return { data: json.layaway, error: null };
  } catch (e: any) {
    return { data: null, error: { message: e.message || "Error de red" } };
  }
}

export async function payLayaway(layawayId: string, payment: number): Promise<Result & { newBalance?: number; isCompleted?: boolean; cashRegistered?: boolean }> {
  try {
    const res = await fetch("/api/layaways/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layawayId, payment }),
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: { message: json.error || "Error desconocido" } };
    return { data: null, error: null, newBalance: json.newBalance, isCompleted: json.isCompleted, cashRegistered: json.cashRegistered };
  } catch (e: any) {
    return { data: null, error: { message: e.message || "Error de red" } };
  }
}

export async function cancelLayaway(layawayId: string): Promise<Result> {
  try {
    const res = await fetch("/api/layaways/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layawayId }),
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: { message: json.error || "Error desconocido" } };
    return { data: null, error: null };
  } catch (e: any) {
    return { data: null, error: { message: e.message || "Error de red" } };
  }
}
