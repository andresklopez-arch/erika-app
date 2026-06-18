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
  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase
    .from("cash_transactions")
    .select("*")
    .gte("created_at", today)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error:", error);
  } else {
    console.log(`Transacciones de hoy (${data.length}):`);
    console.log(JSON.stringify(data, null, 2));
  }
}

run();
