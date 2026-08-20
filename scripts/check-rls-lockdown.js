// Verifica que la llave pública (anon) YA NO pueda escribir directo en las
// tablas que movimos a rutas de servidor (/api/caja/*, /api/credit/*).
// Corre esto después de aplicar la migración SQL en Supabase, y de nuevo
// después de cada deploy futuro, para detectar si alguien accidentalmente
// revierte una política RLS a "USING (true)".
//
// Uso: node scripts/check-rls-lockdown.js

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const env = {};
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

async function main() {
  const env = loadEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.error("❌ Falta NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local");
    process.exit(1);
  }

  const anon = createClient(url, anonKey);
  let failures = 0;

  // Cada check limpia lo que inserta (con la MISMA llave anon) si la
  // escritura llega a colarse — así nunca deja basura en producción sin
  // importar si RLS ya está bloqueando o no. (Si el INSERT se permitió,
  // el DELETE con la misma llave también se permitirá, porque hoy ambos
  // dependen de la misma política abierta.)
  const checks = [
    {
      name: "cash_sessions (INSERT con llave anon debe fallar)",
      table: "cash_sessions",
      run: () => anon.from("cash_sessions").insert({ initial_balance: 0, opened_by: "RLS-CHECK" }).select("id").single(),
    },
    {
      name: "credit_transactions (INSERT con llave anon debe fallar)",
      table: "credit_transactions",
      run: () => anon.from("credit_transactions").insert({ customer_id: "00000000-0000-0000-0000-000000000000", type: "charge", amount: 1 }).select("id").single(),
    },
    {
      name: "increment_customer_balance (RPC con llave anon debe fallar)",
      run: () => anon.rpc("increment_customer_balance", { p_customer_id: "00000000-0000-0000-0000-000000000000", p_delta: 1 }),
    },
  ];

  for (const check of checks) {
    const { data, error } = await check.run();
    if (!error) {
      console.error(`❌ INSEGURO: ${check.name} — la escritura se permitió (RLS NO está bloqueando).`);
      failures++;
      if (check.table && data && data.id) {
        const { error: cleanupError } = await anon.from(check.table).delete().eq("id", data.id);
        console.log(cleanupError ? `   ⚠️ No se pudo limpiar la fila de prueba: ${cleanupError.message}` : "   🧹 Fila de prueba eliminada.");
      }
    } else if (error.message.includes("row-level security") || error.message.includes("permission denied")) {
      console.log(`✅ Bloqueado correctamente: ${check.name}`);
    } else {
      // Cualquier otro error (ej. columna/tabla no encontrada, o una
      // violación de llave foránea como en este caso) no confirma que RLS
      // esté activo; hay que revisarlo a mano.
      console.warn(`⚠️  Resultado inesperado en "${check.name}": ${error.message}`);
      failures++;
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} verificación(es) fallaron. Revisa las políticas RLS en Supabase.`);
    process.exit(1);
  }
  console.log("\n✅ Todas las escrituras sensibles están correctamente bloqueadas para la llave pública.");
}

main();
