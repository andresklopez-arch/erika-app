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
  // Listar tablas usando rpc o seleccionando de una tabla conocida
  const { data, error } = await supabase
    .from("quotes")
    .select("*")
    .limit(1);

  if (error) {
    console.error("Error al consultar quotes:", error);
  } else {
    console.log("Conexión básica a Supabase funciona.");
  }

  // Ejecutar una consulta SQL cruda a pg_catalog si rpc está disponible
  // Si no, buscaremos si podemos obtener metadatos de supabase.
  console.log("Consultando información de tablas en la base de datos...");
  // Haremos una consulta select simple a una tabla inexistente para ver la lista de tablas en el mensaje de error o rpc
  const { data: list, error: listErr } = await supabase
    .rpc("get_tables"); // si existe una funcion rpc para listar tablas

  if (listErr) {
    console.warn("RPC get_tables no disponible (normal en Supabase estándar):", listErr.message);
  } else {
    console.log("Tablas en la base de datos:", list);
  }
}

run();
