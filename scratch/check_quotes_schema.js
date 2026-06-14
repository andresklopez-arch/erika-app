const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://ryqmhfrlxdeekukhjndq.supabase.co';
const supabaseKey = 'sb_publishable_-xKMw3dhF7xSAu2APUhB6g_zxUT3qRP';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkQuotes() {
    console.log("=== CHECKING QUOTES TABLE ===");
    
    // 1. Fetch one row from quotes to see columns
    console.log("\n1. Fetching a row from 'quotes'...");
    const { data, error } = await supabase
        .from('quotes')
        .select('*')
        .limit(1);
        
    if (error) {
        console.error("❌ Error fetching from quotes:", error);
    } else {
        console.log("✅ Fetch successful!");
        if (data.length > 0) {
            console.log("Sample row keys (columns):", Object.keys(data[0]));
            console.log("Sample row:", data[0]);
        } else {
            console.log("No rows found in 'quotes' table.");
        }
    }
    
    // 2. Try inserting a row WITH customer_id
    console.log("\n2. Testing INSERT into 'quotes' with customer_id: null...");
    const { data: insertData, error: insertError } = await supabase
        .from('quotes')
        .insert({
            customer_name: 'Diagnostic Test',
            customer_id: null,
            items: [],
            total: 0,
            status: 'pending'
        })
        .select();
        
    if (insertError) {
        console.error("❌ INSERT with customer_id failed:", insertError);
    } else {
        console.log("✅ INSERT with customer_id successful!", insertData);
    }

    // 2b. Try inserting a row WITHOUT customer_id
    console.log("\n2b. Testing INSERT into 'quotes' WITHOUT customer_id...");
    const { data: insertData2, error: insertError2 } = await supabase
        .from('quotes')
        .insert({
            customer_name: 'Diagnostic Test 2',
            items: [],
            total: 0,
            status: 'pending'
        })
        .select();

    if (insertError2) {
        console.error("❌ INSERT without customer_id failed:", insertError2);
    } else {
        console.log("✅ INSERT without customer_id successful!", insertData2);
        
        // Clean up test insert
        console.log("\n3. Cleaning up diagnostic quotes...");
        const { error: deleteError } = await supabase
            .from('quotes')
            .delete()
            .or('customer_name.eq.Diagnostic Test,customer_name.eq.Diagnostic Test 2');
        if (deleteError) {
            console.error("❌ Cleanup failed:", deleteError);
        } else {
            console.log("✅ Cleanup successful!");
        }
    }
}

checkQuotes();
