import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const rawSupabase = createClient(supabaseUrl, supabaseAnonKey);

// In-memory caches for database schema errors
const missingColumnsCache = new Map<string, Set<string>>();
const rlsErrorsCache = new Set<string>();

// Sanitizes a history of method calls on the query builder using the cached missing columns
function sanitizeHistory(callHistory: any[], table: string): { sanitizedHistory: any[], modified: boolean } {
  let modified = false;
  const cols = missingColumnsCache.get(table);
  if (!cols || cols.size === 0) {
    return { sanitizedHistory: callHistory, modified };
  }

  const sanitizedHistory = callHistory.map(call => {
    let { method, args } = call;
    // Deep clone args to avoid modifying the original array references
    args = JSON.parse(JSON.stringify(args));

    if (method === 'insert' || method === 'update') {
      if (Array.isArray(args[0])) {
        args[0] = args[0].map(item => {
          const copy = { ...item };
          for (const col of cols) {
            if (col in copy) {
              console.warn(`[Self-Healing] Eliminando campo '${col}' de '${table}' por caché de columnas faltantes. Si el import no guarda, ejecuta clearMissingColumnsCache().`);
              delete copy[col];
              modified = true;
            }
          }
          return copy;
        });
      } else if (args[0] && typeof args[0] === 'object') {
        args[0] = { ...args[0] };
        for (const col of cols) {
          if (col in args[0]) {
            console.warn(`[Self-Healing] Eliminando campo '${col}' de '${table}' por caché de columnas faltantes. Si el import no guarda, ejecuta clearMissingColumnsCache().`);
            delete args[0][col];
            modified = true;
          }
        }
      }
    } else if (method === 'or' && typeof args[0] === 'string') {
      const conditions = args[0].split(',');
      const filtered = conditions.filter(c => {
        for (const col of cols) {
          if (c.startsWith(`${col}.`) || c.includes(`.${col}.`)) {
            modified = true;
            return false;
          }
        }
        return true;
      });
      if (filtered.length !== conditions.length) {
        args[0] = filtered.join(',');
        modified = true;
      }
    } else if (['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'contains', 'containedBy', 'rangeGt', 'rangeGte', 'rangeLt', 'rangeLte', 'rangeAdjacent', 'overlaps', 'textSearch', 'match'].includes(method)) {
      if (cols.has(args[0])) {
        modified = true;
        return null;
      }
    }

    return { method, args };
  }).filter(call => call !== null);

  return { sanitizedHistory, modified };
}

function createBuilderProxy(originalBuilder: any, table: string, callHistory: any[]): any {
  return new Proxy(originalBuilder, {
    get(target, prop) {
      if (prop === 'then') {
        return (onfulfilled: any, onrejected: any) => {
          // 1. Preventatively sanitize query if we already have cached missing columns for this table
          const { sanitizedHistory, modified } = sanitizeHistory(callHistory, table);
          let executorBuilder = target;
          
          if (modified) {
            let newBuilder = rawSupabase.from(table);
            for (const call of sanitizedHistory) {
              newBuilder = (newBuilder as any)[call.method](...call.args);
            }
            executorBuilder = newBuilder;
          }

          // 2. Execute the builder
          return executorBuilder.then(async (result: any) => {
            const { error } = result;
            if (error && error.message) {
              // Intercept RLS errors
              if (error.message.includes("row-level security policy")) {
                rlsErrorsCache.add(table);
                error.message = `${error.message}. \n👉 SUGERENCIA ERIKA: Ejecuta la política RLS para la tabla '${table}' en el SQL Editor de tu panel de Supabase (el script está en supabase_corregir_seguridad_y_restricciones.sql).`;
              }

              // Extract missing column
              let missingColumn: string | null = null;
              if (error.message.includes("column") && error.message.includes("does not exist")) {
                const match1 = error.message.match(/column (?:[a-zA-Z0-9_]+\.)?"?([a-zA-Z0-9_]+)"? does not exist/);
                const match2 = error.message.match(/column "([^"]+)" of relation "[^"]+" does not exist/);
                if (match1 && match1[1]) {
                  missingColumn = match1[1];
                } else if (match2 && match2[1]) {
                  missingColumn = match2[1];
                }
              } else if (error.message.includes("column") && error.message.includes("not find")) {
                const match = error.message.match(/Could not find the '([^']+)' column/);
                if (match && match[1]) {
                  missingColumn = match[1];
                }
              }

              if (missingColumn) {
                // Record to cache
                if (!missingColumnsCache.has(table)) {
                  missingColumnsCache.set(table, new Set());
                }
                missingColumnsCache.get(table)!.add(missingColumn);
                
                console.warn(`[Self-Healing Client] Registered missing column '${missingColumn}' for table '${table}'. Retrying...`);
                
                const retriedBuilder = createBuilderProxy(rawSupabase.from(table), table, callHistory);
                return retriedBuilder.then(onfulfilled, onrejected);
              }
            }
            return onfulfilled ? onfulfilled(result) : result;
          }, onrejected);
        };
      }
      
      const val = Reflect.get(target, prop);
      if (typeof val === 'function') {
        return (...args: any[]) => {
          const clonedArgs = JSON.parse(JSON.stringify(args));
          const newCallHistory = [...callHistory, { method: prop, args: clonedArgs }];
          const nextBuilder = val.apply(target, args);
          return createBuilderProxy(nextBuilder, table, newCallHistory);
        };
      }
      
      return val;
    }
  });
}

/**
 * Limpia la caché en memoria de columnas faltantes.
 * Llama esto antes de cada importación masiva para evitar que errores anteriores
 * eliminen campos del INSERT de forma silenciosa.
 */
export function clearMissingColumnsCache(): void {
  missingColumnsCache.clear();
  console.info('[Self-Healing] Caché de columnas faltantes limpiada correctamente.');
}

export const supabase = new Proxy(rawSupabase, {
  get(target, prop) {
    if (prop === 'from') {
      return (table: string) => {
        return createBuilderProxy(target.from(table), table, []);
      };
    }
    return Reflect.get(target, prop);
  }
}) as any;
