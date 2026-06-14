const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://ryqmhfrlxdeekukhjndq.supabase.co';
const supabaseKey = 'sb_publishable_-xKMw3dhF7xSAu2APUhB6g_zxUT3qRP';

const rawSupabase = createClient(supabaseUrl, supabaseKey);

// In-memory caches for database schema errors
const missingColumnsCache = new Map();
const rlsErrorsCache = new Set();

function sanitizeHistory(callHistory, table) {
  let modified = false;
  const cols = missingColumnsCache.get(table);
  if (!cols || cols.size === 0) {
    return { sanitizedHistory: callHistory, modified };
  }

  const sanitizedHistory = callHistory.map(call => {
    let { method, args } = call;
    args = JSON.parse(JSON.stringify(args));

    if (method === 'insert' || method === 'update') {
      if (Array.isArray(args[0])) {
        args[0] = args[0].map(item => {
          const copy = { ...item };
          for (const col of cols) {
            if (col in copy) {
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

function wrapSupabase(client) {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'from') {
        return (table) => {
          return createBuilderProxy(target.from(table), table, []);
        };
      }
      return Reflect.get(target, prop);
    }
  });
}

function createBuilderProxy(originalBuilder, table, callHistory) {
  return new Proxy(originalBuilder, {
    get(target, prop) {
      if (prop === 'then') {
        return (onfulfilled, onrejected) => {
          const { sanitizedHistory, modified } = sanitizeHistory(callHistory, table);
          let executorBuilder = target;
          
          if (modified) {
            let newBuilder = rawSupabase.from(table);
            for (const call of sanitizedHistory) {
              newBuilder = newBuilder[call.method](...call.args);
            }
            executorBuilder = newBuilder;
          }

          return executorBuilder.then(async (result) => {
            const { error } = result;
            if (error && error.message) {
              let missingColumn = null;
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
                if (!missingColumnsCache.has(table)) {
                  missingColumnsCache.set(table, new Set());
                }
                missingColumnsCache.get(table).add(missingColumn);

                console.warn(`\n⚠️ [Self-Healing Client] Column '${missingColumn}' not found in table '${table}'. Cleaning payload/filter & retrying...`);
                
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
        return (...args) => {
          const newCallHistory = [...callHistory, { method: prop, args: JSON.parse(JSON.stringify(args)) }];
          const nextBuilder = val.apply(target, args);
          return createBuilderProxy(nextBuilder, table, newCallHistory);
        };
      }
      
      return val;
    }
  });
}

const supabase = wrapSupabase(rawSupabase);

async function runTest() {
    console.log("1. Testing self-healing INSERT (with non-existent 'customer_id')...");
    const { data: insertData, error: insertError } = await supabase
        .from('quotes')
        .insert({
            customer_name: 'Self-Healing Test',
            customer_id: 'some-uuid-value-that-does-not-exist',
            items: [],
            total: 0,
            status: 'pending'
        })
        .select();
        
    if (insertError) {
        console.error("❌ Self-healing INSERT failed:", insertError);
    } else {
        console.log("✅ Self-healing INSERT succeeded!", insertData);
    }
    
    console.log("\n2. Testing self-healing OR query (filtering on non-existent 'customer_id')...");
    const { data: selectData, error: selectError } = await supabase
        .from('quotes')
        .select('*')
        .or('customer_id.eq.some-uuid,customer_name.eq.Self-Healing Test')
        .limit(5);
        
    if (selectError) {
        console.error("❌ Self-healing SELECT failed:", selectError);
    } else {
        console.log("✅ Self-healing SELECT succeeded! Found rows:", selectData.length);
    }
    
    console.log("\n4. Testing self-healing UPDATE (with non-existent 'deleted' and 'deleted_at')...");
    const { data: updateData, error: updateError } = await supabase
        .from('customers')
        .update({
            deleted: true,
            deleted_at: new Date().toISOString()
        })
        .eq('name', 'ANDRES')
        .select();

    if (updateError) {
        console.error("❌ Self-healing UPDATE failed:", updateError);
    } else {
        console.log("✅ Self-healing UPDATE succeeded!", updateData);
    }

    // Clean up
    console.log("\n3. Cleaning up test rows...");
    const { error: deleteError } = await supabase
        .from('quotes')
        .delete()
        .eq('customer_name', 'Self-Healing Test');
    if (deleteError) {
        console.error("❌ Cleanup failed:", deleteError);
    } else {
        console.log("✅ Cleanup successful!");
    }
}

runTest();
