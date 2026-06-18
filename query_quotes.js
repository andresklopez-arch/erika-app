const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// Leer y parsear .env.local manualmente
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
    .from("quotes")
    .select("*")
    .eq("status", "ticket")
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    console.error("Error al consultar quotes:", error);
  } else {
    console.log("Últimos 5 tickets/quotes registrados:");
    console.log(JSON.stringify(data, null, 2));
  }
}

run();
