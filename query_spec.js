const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, ".env.local");
let supabaseUrl = "";
let supabaseAnonKey = "";

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  content.split("\n").forEach(line => {
    const parts = line.split("=");
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join("=").trim().replace(/^['"]|['"]$/g, "");
      if (key === "NEXT_PUBLIC_SUPABASE_URL") {
        supabaseUrl = val;
      } else if (key === "NEXT_PUBLIC_SUPABASE_ANON_KEY") {
        supabaseAnonKey = val;
      }
    }
  });
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  console.log("Conectando a Supabase:", supabaseUrl);
  // Ultimos 10 minutos
  const tenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  
  const { data, error } = await supabase
    .from("cash_transactions")
    .select("*")
    .gte("created_at", tenMinutesAgo)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error:", error);
  } else {
    console.log(`Transacciones de los últimos 15 minutos: ${data.length}`);
    data.forEach(t => {
      console.log(`- ID: ${t.id}`);
      console.log(`  Amount: ${t.amount}`);
      console.log(`  Method: ${t.payment_method}`);
      console.log(`  Created: ${t.created_at}`);
      console.log(`  Desc: ${t.description}`);
    });
  }
}

run();
