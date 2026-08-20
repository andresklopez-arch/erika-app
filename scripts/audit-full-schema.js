// Foto completa de RLS (tablas + funciones RPC) usando la Service Role Key
// — a diferencia de check-rls-lockdown.js (que prueba desde afuera con la
// llave anon y solo conoce las tablas ya listadas a mano), esto lee
// directo pg_policies/pg_proc y por lo tanto también muestra tablas como
// business_settings (una sola fila, no apta para el patrón de INSERT de
// prueba de check-rls-lockdown.js) sin necesidad de abrir el panel de
// Configuración → Auditoría de Seguridad.
//
// Uso local: node scripts/audit-full-schema.js
// Requiere SUPABASE_SERVICE_ROLE_KEY en .env.local — nunca correr esto en
// CI (ver AGENTS.md, sección "Qué llaves pueden ir en un workflow").

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const env = {};
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
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ Falta SUPABASE_SERVICE_ROLE_KEY en .env.local");
    process.exit(1);
  }
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const writeCommands = new Set(["ALL", "INSERT", "UPDATE", "DELETE"]);
  const isUnconditional = (expr) => expr === null || expr.trim() === "true";

  console.log("== TABLAS ==\n");
  const { data: policies, error: polError } = await admin.rpc("admin_list_rls_policies");
  if (polError) {
    console.error("❌ Error al consultar admin_list_rls_policies:", polError.message);
    process.exit(1);
  }
  const byTable = new Map();
  for (const p of policies || []) {
    if (!byTable.has(p.table_name)) byTable.set(p.table_name, []);
    byTable.get(p.table_name).push(p);
  }
  const tableNames = [...byTable.keys()].sort();
  let openTableCount = 0;
  for (const table of tableNames) {
    const pols = byTable.get(table);
    const open = pols.some((p) => writeCommands.has(p.cmd) && (isUnconditional(p.qual) || isUnconditional(p.with_check)));
    if (open) openTableCount++;
    console.log(`${open ? "🔓 ABIERTA " : "🔒 cerrada "} ${table}`);
    if (open) {
      for (const p of pols) {
        if (writeCommands.has(p.cmd) && (isUnconditional(p.qual) || isUnconditional(p.with_check))) {
          console.log(`    - ${p.policy_name} | cmd=${p.cmd} | roles=${p.roles}`);
        }
      }
    }
  }

  console.log("\n== FUNCIONES (RPC) ==\n");
  const { data: grants, error: grantsError } = await admin.rpc("admin_list_function_grants");
  if (grantsError) {
    console.warn(`⚠️ No se pudo consultar admin_list_function_grants (¿falta correr la migración 20260825010000?): ${grantsError.message}`);
  } else if (!grants || grants.length === 0) {
    console.log("✅ Ninguna función propia de la app sigue ejecutable por anon/authenticated.");
  } else {
    for (const g of grants) console.log(`🔓 ${g.signature} — ${g.grantee}`);
  }

  console.log(`\n${openTableCount} de ${tableNames.length} tablas siguen con escritura abierta.`);
}

main();
