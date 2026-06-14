const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://ryqmhfrlxdeekukhjndq.supabase.co';
const supabaseKey = 'sb_publishable_-xKMw3dhF7xSAu2APUhB6g_zxUT3qRP';

const rawSupabase = createClient(supabaseUrl, supabaseKey);

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
          return target.then(async (result) => {
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
                console.warn(`\n⚠️ [Self-Healing Client] Column '${missingColumn}' not found in table '${table}'. Cleaning payload/filter & retrying...`);
                
                let newBuilder = rawSupabase.from(table);
                let modified = false;
                
                for (const call of callHistory) {
                  let { method, args } = call;
                  
                  if (method === 'insert' || method === 'update') {
                    if (Array.isArray(args[0])) {
                      args[0] = args[0].map(item => {
                        const copy = { ...item };
                        if (missingColumn in copy) {
                          delete copy[missingColumn];
                          modified = true;
                        }
                        return copy;
                      });
                    } else if (args[0] && typeof args[0] === 'object') {
                      args[0] = { ...args[0] };
                      if (missingColumn in args[0]) {
                        delete args[0][missingColumn];
                        modified = true;
                      }
                    }
                  } else if (method === 'or' && typeof args[0] === 'string') {
                    const conditions = args[0].split(',');
                    const filtered = conditions.filter(c => !c.startsWith(`${missingColumn}.`) && !c.includes(`.${missingColumn}.`));
                    if (filtered.length !== conditions.length) {
                      args[0] = filtered.join(',');
                      modified = true;
                    }
                  }
                  
                  newBuilder = newBuilder[method](...args);
                }
                
                if (modified) {
                  return newBuilder.then(onfulfilled, onrejected);
                }
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
