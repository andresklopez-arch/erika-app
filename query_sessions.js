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
      const val = parts.slice(1).join("=").trim().replace(/^['"]|['"]$/g, ""); // eliminar comillas
      if (key === "NEXT_PUBLIC_SUPABASE_URL") {
        supabaseUrl = val;
      } else if (key === "NEXT_PUBLIC_SUPABASE_ANON_KEY") {
        supabaseAnonKey = val;
      }
    }
  });
}

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Error: NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY no encontrados en .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  console.log("Conectando a Supabase:", supabaseUrl);
  const { data, error } = await supabase
    .from("cash_sessions")
    .select("*")
    .order("opened_at", { ascending: false });

  if (error) {
    console.error("Error al consultar cash_sessions:", error);
  } else {
    console.log("Sesiones de caja:");
    console.log(JSON.stringify(data, null, 2));
  }
}

run();
