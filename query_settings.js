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
    .from("business_settings")
    .select("*")
    .limit(1)
    .single();

  if (error) {
    console.error("Error:", error);
  } else {
    const cfg = data.config || {};
    cfg.printer_invert_180 = false;
    await supabase.from("business_settings").update({ config: cfg }).eq("id", data.id);
    console.log("printer_invert_180 actualizado exitosamente a false en Supabase!");
    console.log("Nuevo config:", JSON.stringify(cfg, null, 2));
  }
}

run();
