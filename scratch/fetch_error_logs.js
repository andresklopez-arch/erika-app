const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://ryqmhfrlxdeekukhjndq.supabase.co';
const supabaseKey = 'sb_publishable_-xKMw3dhF7xSAu2APUhB6g_zxUT3qRP';

const supabase = createClient(supabaseUrl, supabaseKey);

async function fetchErrorLogs() {
    const { data, error } = await supabase
        .from('error_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
        
    if (error) {
        console.error("Error fetching error_logs:", error);
    } else {
        console.log("Latest 10 error logs:", JSON.stringify(data, null, 2));
    }
}

fetchErrorLogs();
