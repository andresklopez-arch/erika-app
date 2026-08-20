// Envoltorios para /api/customers/* que imitan la forma de respuesta de
// supabase-js ({ data, error }), para poder cambiar los sitios que
// escribían en `customers` directo desde el navegador cambiando una sola
// línea, sin tocar el resto de su lógica (duplicados, confirmaciones, etc).

import { supabase } from "./supabaseClient";
import { LoggerService } from "../services/loggerService";

interface Result {
  data: any | null;
  error: { message: string } | null;
}

// Valores por defecto — configurables en Ajustes (businessSettings.config
// .customer_list_warn_threshold / _danger_threshold) y pasados por el
// llamador; estos solo aplican si no se pasa nada (ver fetchActiveCustomers).
// Por encima del primero se avisa que conviene implementar
// paginacion/busqueda de verdad en vez de traer todos los clientes de un
// jalon (el limite explicito de abajo evita que se trunquen en silencio
// antes de llegar ahi, pero el limite real tambien depende del "Max Rows"
// configurado en Supabase > API Settings).
export const CUSTOMER_LIST_WARN_THRESHOLD_DEFAULT = 2000;
// Por encima de este segundo umbral el aviso pasa de "hay que planear
// paginación" (naranja) a "esto está a punto de truncarse" (rojo) — mucho
// más cerca del limite duro de abajo.
export const CUSTOMER_LIST_DANGER_THRESHOLD_DEFAULT = 4000;
const CUSTOMER_LIST_HARD_LIMIT = 5000;

export type CustomerListWarningSeverity = "warn" | "danger";

// Sidebar escucha este evento para prender el mismo punto rojo que ya usa
// para avisos de seguridad, en naranja o rojo segun `severity` (aviso
// operativo, no de RLS). Ver AGENTS.md ("Avisos operativos con
// OPERATIONAL_WARNING_EVENT") antes de agregar un segundo emisor: el
// `type` en el detail distingue de cuál aviso se trata para no pisar este.
export const OPERATIONAL_WARNING_EVENT = "erika:operational-warning";
export const CUSTOMER_COUNT_WARNED_KEY = "ERIKA_CUSTOMER_COUNT_WARNED";
export const CUSTOMER_COUNT_WARNED_COUNT_KEY = "ERIKA_CUSTOMER_COUNT_WARNED_COUNT";
export const CUSTOMER_COUNT_WARNED_SEVERITY_KEY = "ERIKA_CUSTOMER_COUNT_WARNED_SEVERITY";
// Persistente (localStorage, no sessionStorage): "ya lo vi, no me lo
// repitas" — a diferencia de las 3 llaves de arriba, que son por sesión de
// pestaña. Guarda la severidad que tenía cuando se descartó.
export const CUSTOMER_WARNING_DISMISSED_SEVERITY_KEY = "ERIKA_CUSTOMER_WARNING_DISMISSED_SEVERITY";

// Un aviso descartado en "warn" reaparece si la severidad sube a "danger"
// (empeoró de verdad); uno descartado en "danger" ya no tiene a dónde
// escalar en este esquema de 2 niveles, así que se queda descartado.
export function isCustomerWarningDismissed(currentSeverity: CustomerListWarningSeverity): boolean {
  try {
    const dismissedSeverity = localStorage.getItem(CUSTOMER_WARNING_DISMISSED_SEVERITY_KEY);
    if (!dismissedSeverity) return false;
    if (dismissedSeverity === "danger") return true;
    return dismissedSeverity === currentSeverity;
  } catch (e) {
    return false;
  }
}

// Descarta el aviso y avisa a todos los listeners activos en la misma
// pestaña (ej. Sidebar) para que apaguen su indicador de inmediato — un
// cambio en localStorage por sí solo no dispara re-render en otros
// componentes ya montados en la misma pestaña.
export function dismissCustomerListWarning(currentSeverity: CustomerListWarningSeverity) {
  try {
    localStorage.setItem(CUSTOMER_WARNING_DISMISSED_SEVERITY_KEY, currentSeverity);
  } catch (e) {}
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(OPERATIONAL_WARNING_EVENT, { detail: { type: "customer_list_size_dismissed" } }));
  }
}

// Un console.warn no lo ve nadie en producción. Se registra tambien en
// error_logs (una vez por sesion de pestaña, para no llenar la tabla en
// cada carga del POS) para que quede visible de verdad, y dispara un evento
// para que el Sidebar lo refleje de inmediato aunque ya se haya montado. El
// conteo tambien se guarda en sessionStorage para que una pantalla que
// monta despues del evento (ej. Configuración) pueda mostrar el detalle.
function warnAboutCustomerListSize(count: number, dangerThreshold: number) {
  const severity: CustomerListWarningSeverity = count > dangerThreshold ? "danger" : "warn";
  console.warn(`fetchActiveCustomers: ${count} clientes activos — considerar paginar antes de llegar al limite de ${CUSTOMER_LIST_HARD_LIMIT}.`);
  try {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(OPERATIONAL_WARNING_EVENT, { detail: { type: "customer_list_size", count, severity } }));
    sessionStorage.setItem(CUSTOMER_COUNT_WARNED_COUNT_KEY, String(count));
    sessionStorage.setItem(CUSTOMER_COUNT_WARNED_SEVERITY_KEY, severity);
    if (sessionStorage.getItem(CUSTOMER_COUNT_WARNED_KEY)) return;
    sessionStorage.setItem(CUSTOMER_COUNT_WARNED_KEY, "1");
  } catch (e) {
    return;
  }
  LoggerService.logError(
    "fetchActiveCustomers_size_warning",
    `${count} clientes activos (severidad: ${severity}), por encima del umbral configurado. Considerar paginar antes de llegar al limite de ${CUSTOMER_LIST_HARD_LIMIT}.`,
  );
}

// Lectura de `customers` sigue permitida directo desde el navegador (RLS
// solo bloquea escrituras en esta tabla). Centraliza el patrón de filtro
// "no borrados" + fallback que antes estaba duplicado en POSModule (dos
// veces) y QuotesModule. Los umbrales son opcionales — el llamador que ya
// tiene businessSettings a la mano (useAuth()) puede pasar los valores
// configurados en Ajustes; si no se pasan, se usan los defaults.
export async function fetchActiveCustomers(thresholds?: { warn?: number; danger?: number }): Promise<Result> {
  const warnThreshold = thresholds?.warn ?? CUSTOMER_LIST_WARN_THRESHOLD_DEFAULT;
  const dangerThreshold = thresholds?.danger ?? CUSTOMER_LIST_DANGER_THRESHOLD_DEFAULT;
  const { data, error, count } = await supabase
    .from("customers")
    .select("*", { count: "exact" })
    .or("deleted.is.null,deleted.eq.false")
    .limit(CUSTOMER_LIST_HARD_LIMIT);
  if (!error) {
    if (count !== null && count > warnThreshold) {
      warnAboutCustomerListSize(count, dangerThreshold);
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
