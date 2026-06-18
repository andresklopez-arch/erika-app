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
  // Obtener transacciones de los últimos 20 minutos
  const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  
  const { data, error } = await supabase
    .from("cash_transactions")
    .select("*")
    .gte("created_at", twentyMinutesAgo)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error:", error);
  } else {
    console.log(`Transacciones de los últimos 20 minutos (${data.length}):`);
    console.log(JSON.stringify(data, null, 2));
  }
}

run();
