const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://ryqmhfrlxdeekukhjndq.supabase.co';
const supabaseKey = 'sb_publishable_-xKMw3dhF7xSAu2APUhB6g_zxUT3qRP';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
    console.log("=== CHECKING CUSTOMERS TABLE COLUMNS ===");
    
    // We can query the PostgREST API metadata or information_schema if we have access.
    // If not, we can see if we can get it via standard REST query or if it errors out.
    const { data, error } = await supabase
        .from('customers')
        .select('*')
        .limit(1);
        
    if (error) {
        console.error("Error fetching customer:", error);
    } else {
        console.log("Sample customer record:", data);
    }
}

checkSchema();
