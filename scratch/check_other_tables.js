const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://ryqmhfrlxdeekukhjndq.supabase.co';
const supabaseKey = 'sb_publishable_-xKMw3dhF7xSAu2APUhB6g_zxUT3qRP';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkOtherTables() {
    console.log("=== CHECKING INVENTORY AND SUPPLIERS COLUMNS ===");
    
    const { data: invData, error: invError } = await supabase
        .from('inventory')
        .select('*')
        .limit(1);
        
    if (invError) {
        console.error("Error fetching inventory:", invError);
    } else {
        console.log("Inventory sample:", invData);
    }
    
    const { data: supData, error: supError } = await supabase
        .from('suppliers')
        .select('*')
        .limit(1);
        
    if (supError) {
        console.error("Error fetching suppliers:", supError);
    } else {
        console.log("Suppliers sample:", supData);
    }
}

checkOtherTables();
