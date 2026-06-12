const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://ryqmhfrlxdeekukhjndq.supabase.co';
const supabaseKey = 'sb_publishable_-xKMw3dhF7xSAu2APUhB6g_zxUT3qRP';

const supabase = createClient(supabaseUrl, supabaseKey);

async function fetchColumns() {
    // Let's select one customer to see its properties
    const { data, error } = await supabase
        .from('customers')
        .select('*')
        .limit(1);
        
    if (error) {
        console.error("Error fetching customers:", error);
    } else {
        console.log("Customer record example:", data);
    }
}

fetchColumns();
