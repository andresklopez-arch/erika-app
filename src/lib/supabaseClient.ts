import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const rawSupabase = createClient(supabaseUrl, supabaseAnonKey);

function createBuilderProxy(originalBuilder: any, table: string, callHistory: any[]): any {
  return new Proxy(originalBuilder, {
    get(target, prop) {
      if (prop === 'then') {
        return (onfulfilled: any, onrejected: any) => {
          return target.then(async (result: any) => {
            const { error } = result;
            if (error && error.message) {
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
                console.warn(`[Self-Healing Client] Column '${missingColumn}' not found in table '${table}'. Retrying without it...`);
                let newBuilder = rawSupabase.from(table);
                let modified = false;
                
                for (const call of callHistory) {
                  let { method, args } = call;
                  
                  if (method === 'insert' || method === 'update') {
                    if (Array.isArray(args[0])) {
                      args[0] = args[0].map(item => {
                        const copy = { ...item };
                        if (missingColumn && missingColumn in copy) {
                          delete copy[missingColumn];
                          modified = true;
                        }
                        return copy;
                      });
                    } else if (args[0] && typeof args[0] === 'object') {
                      args[0] = { ...args[0] };
                      if (missingColumn && missingColumn in args[0]) {
                        delete args[0][missingColumn];
                        modified = true;
                      }
                    }
                  } else if (method === 'or' && typeof args[0] === 'string') {
                    const conditions = args[0].split(',');
                    const filtered = conditions.filter(c => missingColumn && !c.startsWith(`${missingColumn}.`) && !c.includes(`.${missingColumn}.`));
                    if (filtered.length !== conditions.length) {
                      args[0] = filtered.join(',');
                      modified = true;
                    }
                  } else if (['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'contains', 'containedBy', 'rangeGt', 'rangeGte', 'rangeLt', 'rangeLte', 'rangeAdjacent', 'overlaps', 'textSearch', 'match'].includes(method)) {
                    if (args[0] === missingColumn) {
                      modified = true;
                      continue;
                    }
                  }
                  
                  newBuilder = (newBuilder as any)[method](...args);
                }
                
                if (modified) {
                  return (newBuilder as any).then(onfulfilled, onrejected);
                }
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
