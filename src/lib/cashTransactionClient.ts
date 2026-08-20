// Envoltorio para /api/caja/transaction que imita la forma de respuesta de
// supabase-js ({ data, error }) para que los 4 sitios que insertaban en
// cash_transactions directo desde el navegador (caja/page.tsx,
// POSModule.tsx x2, offlineSync.ts) puedan cambiar una sola línea sin tocar
// el resto de su lógica de reintentos/fallback/bitácora que ya funcionaba.

export interface CashTransactionResult {
  data: any | null;
  error: { message: string } | null;
}

export async function insertCashTransaction(payload: Record<string, any>, adminPin?: string): Promise<CashTransactionResult> {
  try {
    const res = await fetch("/api/caja/transaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, adminPin }),
    });
    const json = await res.json();
    if (!res.ok) {
      return { data: null, error: { message: json.error || "Error desconocido" } };
    }
    return { data: json.transaction, error: null };
  } catch (e: any) {
    return { data: null, error: { message: e.message || "Error de red" } };
  }
}
