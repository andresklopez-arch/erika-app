const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://ryqmhfrlxdeekukhjndq.supabase.co';
const supabaseKey = 'sb_publishable_-xKMw3dhF7xSAu2APUhB6g_zxUT3qRP';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCustomers() {
    console.log("=== CHECKING CUSTOMERS TABLE ===");
    const { data, error } = await supabase
        .from('customers')
        .select('*')
        .limit(1);
        
    if (error) {
        console.error("❌ Error fetching from customers:", error);
    } else {
        console.log("✅ Fetch successful!");
        if (data.length > 0) {
            console.log("Columns:", Object.keys(data[0]));
            console.log("Sample row:", data[0]);
        } else {
            console.log("No rows found in 'customers' table.");
        }
    }
}

checkCustomers();
