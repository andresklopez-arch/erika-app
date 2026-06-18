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
  const { data, error } = await supabase
    .from("invoice_claims")
    .select("*")
    .eq("ticket_id", "ac36f0de-eda8-4898-b42e-bed67c35beaf");

  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Reclamo de factura encontrado:");
    console.log(JSON.stringify(data, null, 2));
  }
}

run();
