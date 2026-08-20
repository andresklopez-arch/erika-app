// Verifica que la llave pública (anon) YA NO pueda escribir directo en las
// tablas que movimos a rutas de servidor (/api/caja/*, /api/credit/*).
// Corre esto después de aplicar una migración SQL en Supabase, y de nuevo
// después de cada deploy futuro (ver .github/workflows/check-rls.yml), para
// detectar si alguien accidentalmente revierte una política RLS a
// "USING (true)".
//
// Uso local:  node scripts/check-rls-lockdown.js
// En CI: lee NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY del
// entorno directamente (son públicas por diseño, no son secretas); en local
// cae de regreso a leerlas de .env.local si no están en el entorno.

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
  const fileEnv = loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.error("❌ Falta NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY (entorno o .env.local)");
    process.exit(1);
  }

  const anon = createClient(url, anonKey);

  // Cada check limpia lo que inserta (con la MISMA llave anon) si la
  // escritura llega a colarse — así nunca deja basura en producción sin
  // importar si RLS ya está bloqueando o no. (Si el INSERT se permitió, el
  // DELETE con la misma llave también se permitirá, porque ambos dependen
  // de la misma política abierta.)
  async function runCheck(name, table, run) {
    const { data, error } = await run();
    if (!error) {
      if (table && data && data.id) {
        const { error: cleanupError } = await anon.from(table).delete().eq("id", data.id);
        if (cleanupError) console.log(`   ⚠️ No se pudo limpiar la fila de prueba de "${table}": ${cleanupError.message}`);
      }
      return { name, blocked: false, inconclusive: false };
    }
    if (error.message.includes("row-level security") || error.message.includes("permission denied")) {
      return { name, blocked: true, inconclusive: false };
    }
    // Cualquier otro error (columna/tabla no encontrada, llave foránea,
    // etc.) no confirma que RLS esté activo; hay que revisarlo a mano.
    return { name, blocked: false, inconclusive: true, message: error.message };
  }

  // Tablas que YA deben estar cerradas — si alguna falla, el script sale
  // con error (código de salida 1) para poder usarse como gate en CI.
  const mustBeBlocked = [
    ["cash_sessions (INSERT)", "cash_sessions", () => anon.from("cash_sessions").insert({ initial_balance: 0, opened_by: "RLS-CHECK" }).select("id").single()],
    ["cash_transactions (INSERT)", "cash_transactions", () => anon.from("cash_transactions").insert({ type: "deposit", amount: 1, description: "RLS-CHECK" }).select("id").single()],
    ["credit_transactions (INSERT)", "credit_transactions", () => anon.from("credit_transactions").insert({ customer_id: "00000000-0000-0000-0000-000000000000", type: "charge", amount: 1 }).select("id").single()],
    ["increment_customer_balance (RPC)", null, () => anon.rpc("increment_customer_balance", { p_customer_id: "00000000-0000-0000-0000-000000000000", p_delta: 1 })],
  ];

  // Tablas que TODAVÍA están abiertas a propósito (pendientes, seguimiento
  // de una sesión futura) — solo informativas, no hacen fallar el script.
  // En cuanto se cierren, este reporte empezará a mostrarlas como
  // bloqueadas automáticamente, sin tener que tocar este archivo.
  const knownOpenPending = [
    ["supplier_debts (INSERT)", "supplier_debts", () => anon.from("supplier_debts").insert({ amount: 1, balance: 1, due_date: "2026-01-01", concept: "RLS-CHECK" }).select("id").single()],
    ["layaways (INSERT)", "layaways", () => anon.from("layaways").insert({ total_amount: 1, down_payment: 1, balance: 1, items: [] }).select("id").single()],
    ["business_losses (INSERT)", "business_losses", () => anon.from("business_losses").insert({ loss_type: "RLS-CHECK", amount: 1, description: "RLS-CHECK" }).select("id").single()],
  ];

  console.log("== Tablas que DEBEN estar cerradas ==");
  let failures = 0;
  for (const [name, table, run] of mustBeBlocked) {
    const result = await runCheck(name, table, run);
    if (result.blocked) {
      console.log(`✅ Bloqueado correctamente: ${name}`);
    } else if (result.inconclusive) {
      console.warn(`⚠️  Resultado inesperado en "${name}": ${result.message}`);
      failures++;
    } else {
      console.error(`❌ INSEGURO: ${name} — la escritura se permitió (RLS NO está bloqueando).`);
      failures++;
    }
  }

  console.log("\n== Tablas pendientes (conocidas como abiertas, no bloquean este check) ==");
  for (const [name, table, run] of knownOpenPending) {
    const result = await runCheck(name, table, run);
    if (result.blocked) {
      console.log(`✅ Ya cerrada: ${name} (¡se puede quitar de la lista "pendiente"!)`);
    } else if (result.inconclusive) {
      console.warn(`⚠️  Resultado inesperado en "${name}": ${result.message}`);
    } else {
      console.log(`🔓 Abierta (pendiente): ${name}`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} verificación(es) obligatorias fallaron. Revisa las políticas RLS en Supabase.`);
    process.exit(1);
  }
  console.log("\n✅ Todas las escrituras sensibles ya aseguradas están correctamente bloqueadas para la llave pública.");
}

main();
