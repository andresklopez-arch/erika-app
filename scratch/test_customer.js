const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://ryqmhfrlxdeekukhjndq.supabase.co';
const supabaseKey = 'sb_publishable_-xKMw3dhF7xSAu2APUhB6g_zxUT3qRP';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testCustomerInsert() {
    console.log("=== TESTING CUSTOMER INSERT ===");
    
    // 1. Test insert with empty RFC and empty company_name, since that's what CustomersModule does
    const testCust = {
        name: "Cliente Prueba Node " + Date.now(),
        phone: "5512345678",
        rfc: "",
        email: "",
        company_name: "",
        credit_limit: 1000
    };
    
    console.log("Inserting:", testCust);
    const { data, error } = await supabase
        .from('customers')
        .insert([testCust])
        .select();
        
    if (error) {
        console.error("❌ Insert Error:", error);
    } else {
        console.log("✅ Insert Successful! Data:", data);
        
        // Clean up
        if (data && data[0]) {
            console.log("Cleaning up test customer...");
            const { error: delError } = await supabase
                .from('customers')
                .delete()
                .eq('id', data[0].id);
            if (delError) {
                console.error("❌ Delete Error during cleanup:", delError);
            } else {
                console.log("✅ Cleanup successful.");
            }
        }
    }
}

testCustomerInsert();
