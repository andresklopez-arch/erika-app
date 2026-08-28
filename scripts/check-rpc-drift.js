// Escanea todo el código (src/ y scripts/) en busca de llamadas
// `.rpc("nombre_de_funcion")` y compara la lista contra las funciones que
// realmente existen en Postgres, usando el RPC admin_list_functions()
// (Service Role Key, ver migración 20260828030000_add_function_audit_rpc.sql).
//
// Mismo espíritu que check-schema-drift.js pero para funciones en vez de
// columnas: si una función se borra, se renombra, o su firma de
// parámetros cambia (ej. reduce_inventory_stock, increment_*_balance),
// esto lo detecta ANTES de que un endpoint falle en producción, en vez de
// enterarse cuando un abono o una venta truena en vivo.
//
// Uso local: npm run check-rpc
// Requiere SUPABASE_SERVICE_ROLE_KEY en .env.local -- igual que
// check-schema-drift.js, no correr esto en CI con una llave pública.

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

// Recorre src/ y scripts/ recursivamente (sin entrar a node_modules ni
// .next) buscando `.rpc("nombre")` / `.rpc('nombre')` en cualquier
// archivo .ts/.tsx/.js -- misma técnica de escaneo estático que ya usan
// test-decimal-discount.js y test-sell-quote-routing.js en este repo.
const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);
const RPC_CALL_RE = /\.rpc\(\s*["']([a-zA-Z0-9_]+)["']/g;

function findRpcCalls(rootDir) {
  const found = new Map(); // nombre -> [archivos donde aparece]
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx|js)$/.test(entry.name)) {
        const contents = fs.readFileSync(full, "utf8");
        for (const match of contents.matchAll(RPC_CALL_RE)) {
          const name = match[1];
          const rel = path.relative(path.join(__dirname, ".."), full);
          if (!found.has(name)) found.set(name, []);
          if (!found.get(name).includes(rel)) found.get(name).push(rel);
        }
      }
    }
  };
  walk(rootDir);
  return found;
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

  const { data: functions, error } = await admin.rpc("admin_list_functions");
  if (error) {
    console.error(
      "❌ Error al consultar admin_list_functions (¿falta correr la migración 20260828030000?):",
      error.message,
    );
    process.exit(1);
  }
  const realFunctionNames = new Set((functions || []).map((f) => f.function_name));

  const rootDir = path.join(__dirname, "..");
  const rpcCalls = new Map([
    ...findRpcCalls(path.join(rootDir, "src")),
    ...findRpcCalls(path.join(rootDir, "scripts")),
  ]);

  if (rpcCalls.size === 0) {
    console.warn("⚠️  No se encontró ninguna llamada .rpc(...) en src/ ni scripts/ -- ¿cambió el patrón de escaneo?");
    process.exit(1);
  }

  console.log(`== ${rpcCalls.size} función(es) RPC referenciada(s) por el código ==\n`);

  let missingCount = 0;
  const summaryRows = [];
  for (const [name, files] of [...rpcCalls.entries()].sort()) {
    if (realFunctionNames.has(name)) {
      console.log(`✅ ${name} — existe en la base real (usada en ${files.join(", ")})`);
      summaryRows.push(`| ${name} | ✅ Existe | ${files.join(", ")} |`);
    } else {
      console.error(`❌ ${name} — NO existe en la base real, pero el código la llama en: ${files.join(", ")}`);
      missingCount++;
      summaryRows.push(`| ${name} | ❌ **No existe** | ${files.join(", ")} |`);
    }
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = [
      "## 🧬 Auditoría de desfase de funciones RPC (código vs. base real)",
      "",
      "| Función | Resultado | Referenciada en |",
      "| --- | --- | --- |",
      ...summaryRows,
      "",
      missingCount > 0
        ? `❌ **${missingCount} función(es) referenciada(s) por el código no existen en Supabase.**`
        : "✅ Todas las funciones RPC que el código llama existen en la base real.",
    ].join("\n");
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  }

  if (missingCount > 0) {
    console.error(`\n${missingCount} función(es) RPC referenciada(s) por el código no existen en Supabase. Corre la migración correspondiente antes de desplegar.`);
    process.exit(1);
  }
  console.log("\n✅ Sin desfase: todas las funciones RPC que el código llama existen en la base real.");
}

main();
