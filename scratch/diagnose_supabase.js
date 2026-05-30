const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://ryqmhfrlxdeekukhjndq.supabase.co';
const supabaseKey = 'sb_publishable_-xKMw3dhF7xSAu2APUhB6g_zxUT3qRP';

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnose() {
    console.log("=== DIAGNOSING SUPABASE CONNECTION ===");
    
    // 1. Check internal_tasks select
    console.log("\n1. Testing SELECT from internal_tasks...");
    const { data: selectData, error: selectError } = await supabase
        .from('internal_tasks')
        .select('*')
        .limit(1);
    
    if (selectError) {
        console.error("❌ SELECT Error:", selectError);
    } else {
        console.log("✅ SELECT Successful! Data:", selectData);
    }

    // 2. Test INSERT into internal_tasks
    console.log("\n2. Testing INSERT into internal_tasks...");
    const { data: insertData, error: insertError } = await supabase
        .from('internal_tasks')
        .insert([
            {
                title: 'Test Task from Diagnostic Script',
                assigned_to: 'all',
                status: 'pending',
                created_by: 'Diagnostic Script'
            }
        ]);
    
    if (insertError) {
        console.error("❌ INSERT Error:", insertError);
    } else {
        console.log("✅ INSERT Successful! Returned:", insertData);
    }

    // 3. Test DELETE of diagnostic task
    console.log("\n3. Cleaning up diagnostic task...");
    const { data: deleteData, error: deleteError } = await supabase
        .from('internal_tasks')
        .delete()
        .eq('created_by', 'Diagnostic Script');
        
    if (deleteError) {
        console.error("❌ DELETE Error:", deleteError);
    } else {
        console.log("✅ DELETE Cleanup Successful!");
    }
}

diagnose();
