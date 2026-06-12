const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://ryqmhfrlxdeekukhjndq.supabase.co';
const supabaseKey = 'sb_publishable_-xKMw3dhF7xSAu2APUhB6g_zxUT3qRP';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDeletedValues() {
    console.log("=== CHECKING CUSTOMERS DELETED VALUES ===");
    
    // Get all customers to inspect the 'deleted' column values
    const { data, error } = await supabase
        .from('customers')
        .select('id, name, deleted, rfc');
        
    if (error) {
        console.error("Error fetching customers:", error);
    } else {
        console.log("All customers in DB:");
        console.log(JSON.stringify(data, null, 2));
    }
}

checkDeletedValues();
