// Envoltorios para /api/suppliers/debts/* — mismo patrón que los demás
// clientes de escritura server-side de esta sesión.

interface Result {
  data: any | null;
  error: { message: string } | null;
}

export async function saveSupplierDebt(fields: Record<string, any>): Promise<Result> {
  try {
    const res = await fetch("/api/suppliers/debts/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: { message: json.error || "Error desconocido" } };
    return { data: json.debt, error: null };
  } catch (e: any) {
    return { data: null, error: { message: e.message || "Error de red" } };
  }
}

export async function paySupplierDebt(debtId: string, amount: number, notes?: string): Promise<Result & { newBalance?: number; interest?: number; supplierName?: string; concept?: string }> {
  try {
    const res = await fetch("/api/suppliers/debts/payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ debtId, amount, notes }),
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: { message: json.error || "Error desconocido" } };
    return { data: null, error: null, newBalance: json.newBalance, interest: json.interest, supplierName: json.supplierName, concept: json.concept };
  } catch (e: any) {
    return { data: null, error: { message: e.message || "Error de red" } };
  }
}
