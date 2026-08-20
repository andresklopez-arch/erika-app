// Envoltorios para /api/customers/* que imitan la forma de respuesta de
// supabase-js ({ data, error }), para poder cambiar los sitios que
// escribían en `customers` directo desde el navegador cambiando una sola
// línea, sin tocar el resto de su lógica (duplicados, confirmaciones, etc).

import { supabase } from "./supabaseClient";

interface Result {
  data: any | null;
  error: { message: string } | null;
}

// Por encima de este umbral se avisa en consola que conviene implementar
// paginacion/busqueda de verdad en vez de traer todos los clientes de un
// jalon (el limite explicito de abajo evita que se trunquen en silencio
// antes de llegar ahi, pero el limite real tambien depende del "Max Rows"
// configurado en Supabase > API Settings).
const CUSTOMER_LIST_WARN_THRESHOLD = 2000;
const CUSTOMER_LIST_HARD_LIMIT = 5000;

// Lectura de `customers` sigue permitida directo desde el navegador (RLS
// solo bloquea escrituras en esta tabla). Centraliza el patrón de filtro
// "no borrados" + fallback que antes estaba duplicado en POSModule (dos
// veces) y QuotesModule.
export async function fetchActiveCustomers(): Promise<Result> {
  const { data, error, count } = await supabase
    .from("customers")
    .select("*", { count: "exact" })
    .or("deleted.is.null,deleted.eq.false")
    .limit(CUSTOMER_LIST_HARD_LIMIT);
  if (!error) {
    if (count !== null && count > CUSTOMER_LIST_WARN_THRESHOLD) {
      console.warn(`fetchActiveCustomers: ${count} clientes activos — considerar paginar antes de llegar al limite de ${CUSTOMER_LIST_HARD_LIMIT}.`);
    }
    return { data, error: null };
  }

  console.warn("Fallo el filtro de base de datos 'deleted' en clientes, usando fallback local:", error.message);
  const fallback = await supabase.from("customers").select("*").limit(CUSTOMER_LIST_HARD_LIMIT);
  if (fallback.error) return { data: null, error: { message: fallback.error.message } };
  return { data: (fallback.data || []).filter((c: any) => c.deleted !== true), error: null };
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
