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

  // supplier_orders/inventory_audit_logs/inventory_movements tienen una
  // llave foránea NOT NULL a suppliers/inventory que Postgres valida antes
  // de evaluar RLS — un id inventado siempre falla por "foreign key
  // constraint" sin importar si la política está bloqueando o no. La
  // lectura (SELECT) sigue siendo pública en esas tablas, así que se puede
  // tomar un id real existente sin necesitar ningún permiso especial.
  const { data: realSupplier } = await anon.from("suppliers").select("id").limit(1).maybeSingle();
  const { data: realInventoryItem } = await anon.from("inventory").select("id").limit(1).maybeSingle();

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
    ["customers (INSERT)", "customers", () => anon.from("customers").insert({ name: "RLS-CHECK" }).select("id").single()],
    ["increment_customer_balance (RPC)", null, () => anon.rpc("increment_customer_balance", { p_customer_id: "00000000-0000-0000-0000-000000000000", p_delta: 1 })],
    ["increment_customer_points (RPC)", null, () => anon.rpc("increment_customer_points", { p_customer_id: "00000000-0000-0000-0000-000000000000", p_delta: 1 })],
    ["supplier_debts (INSERT)", "supplier_debts", () => anon.from("supplier_debts").insert({ amount: 1, balance: 1, due_date: "2026-01-01", concept: "RLS-CHECK" }).select("id").single()],
    ["supplier_payments (INSERT)", "supplier_payments", () => anon.from("supplier_payments").insert({ debt_id: "00000000-0000-0000-0000-000000000000", amount: 1, notes: "RLS-CHECK" }).select("id").single()],
    ["layaways (INSERT)", "layaways", () => anon.from("layaways").insert({ total_amount: 1, down_payment: 1, balance: 1, items: [] }).select("id").single()],
    ["business_losses (INSERT)", "business_losses", () => anon.from("business_losses").insert({ loss_type: "RLS-CHECK", amount: 1, description: "RLS-CHECK" }).select("id").single()],
    ["increment_layaway_balance (RPC)", null, () => anon.rpc("increment_layaway_balance", { p_layaway_id: "00000000-0000-0000-0000-000000000000", p_delta: 1 })],
    ["increment_supplier_debt_balance (RPC)", null, () => anon.rpc("increment_supplier_debt_balance", { p_debt_id: "00000000-0000-0000-0000-000000000000", p_delta: 1 })],
    // INSERT (no UPDATE): un UPDATE .eq("id", uuid-falso) no toca ninguna
    // fila real, así que Postgres nunca evalúa la política y el check
    // "pasaría" sin importar si RLS está bloqueando o no. INSERT sí fuerza
    // la evaluación real de la política, igual que el resto de esta lista,
    // y se autolimpia igual si llega a colarse.
    ["users (INSERT)", "users", () => anon.from("users").insert({ name: "RLS-CHECK", role: "cajero", permissions: {} }).select("id").single()],
    // deploy_checkpoints se creó cerrada desde el día uno (solo SELECT
    // público, escritura solo por service_role) — este check confirma que
    // se mantenga así, ya que nada obliga a que una tabla nueva no se
    // reabra por error en una migración futura.
    ["deploy_checkpoints (INSERT)", "deploy_checkpoints", () => anon.from("deploy_checkpoints").insert({ tag_name: `RLS-CHECK-${Date.now()}`, commit_hash: "0000000" }).select("id").single()],
  ];

  // Detectadas en la auditoría general de esta sesión (admin_list_rls_policies
  // sobre TODAS las tablas, no solo las de dinero) — todavía con "USING (true)".
  // No bloquean el check todavía porque cerrarlas requiere mover cada punto de
  // escritura del navegador a una ruta de servidor primero (mismo patrón,
  // documentado en AGENTS.md); moverlas a mustBeBlocked conforme se cierren.
  // business_settings queda fuera de esta lista a propósito: es una sola fila
  // real de configuración del negocio, y un UPDATE de prueba no tendría cómo
  // autolimpiarse a su valor original — su estado se puede ver sin tocar datos
  // reales desde el panel "Auditoría de Seguridad (RLS)" en Configuración.
  const knownOpenPending = [
    ["inventory (INSERT)", "inventory", () => anon.from("inventory").insert({ name: "RLS-CHECK", price: 1, cost: 1, stock: 0 }).select("id").single()],
    ["services (INSERT)", "services", () => anon.from("services").insert({ customer_name: "RLS-CHECK", technician_name: "RLS-CHECK", service_type: "RLS-CHECK", scheduled_at: new Date().toISOString(), cost: 1, status: "pending" }).select("id").single()],
    ["suppliers (INSERT)", "suppliers", () => anon.from("suppliers").insert({ name: "RLS-CHECK" }).select("id").single()],
    ["supplier_orders (INSERT)", "supplier_orders", realSupplier
      ? () => anon.from("supplier_orders").insert({ supplier_id: realSupplier.id, action_type: "RLS-CHECK", notes: "RLS-CHECK" }).select("id").single()
      : () => Promise.resolve({ data: null, error: { message: "No hay ningún proveedor real para probar la llave foránea." } })],
    ["quotes (INSERT)", "quotes", () => anon.from("quotes").insert({ customer_name: "RLS-CHECK", items: [], total: 1, status: "pending" }).select("id").single()],
    ["error_logs (INSERT)", "error_logs", () => anon.from("error_logs").insert({ module: "RLS-CHECK" }).select("id").single()],
    ["internal_tasks (INSERT)", "internal_tasks", () => anon.from("internal_tasks").insert({ title: "RLS-CHECK", assigned_to: "RLS-CHECK", status: "pending", created_by: "RLS-CHECK" }).select("id").single()],
    ["inventory_audit_logs (INSERT)", "inventory_audit_logs", realInventoryItem
      ? () => anon.from("inventory_audit_logs").insert({ inventory_id: realInventoryItem.id, field: "RLS-CHECK", old_value: "0", new_value: "0", changed_by: "RLS-CHECK" }).select("id").single()
      : () => Promise.resolve({ data: null, error: { message: "No hay ningún producto real para probar la llave foránea." } })],
    ["inventory_movements (INSERT)", "inventory_movements", realInventoryItem
      ? () => anon.from("inventory_movements").insert({ inventory_id: realInventoryItem.id, movement_type: "sale", quantity: 1 }).select("id").single()
      : () => Promise.resolve({ data: null, error: { message: "No hay ningún producto real para probar la llave foránea." } })],
  ];

  console.log("== Tablas que DEBEN estar cerradas ==");
  let failures = 0;
  const summaryRows = [];
  for (const [name, table, run] of mustBeBlocked) {
    const result = await runCheck(name, table, run);
    if (result.blocked) {
      console.log(`✅ Bloqueado correctamente: ${name}`);
      summaryRows.push(`| ${name} | ✅ Bloqueado | |`);
    } else if (result.inconclusive) {
      console.warn(`⚠️  Resultado inesperado en "${name}": ${result.message}`);
      summaryRows.push(`| ${name} | ⚠️ Inconcluso | ${result.message} |`);
      failures++;
    } else {
      console.error(`❌ INSEGURO: ${name} — la escritura se permitió (RLS NO está bloqueando).`);
      summaryRows.push(`| ${name} | ❌ **INSEGURO** | La escritura se permitió |`);
      failures++;
    }
  }

  console.log("\n== Tablas pendientes (conocidas como abiertas, no bloquean este check) ==");
  for (const [name, table, run] of knownOpenPending) {
    const result = await runCheck(name, table, run);
    if (result.blocked) {
      console.log(`✅ Ya cerrada: ${name} (¡se puede quitar de la lista "pendiente"!)`);
      summaryRows.push(`| ${name} (pendiente) | ✅ Ya cerrada | Quitar de knownOpenPending |`);
    } else if (result.inconclusive) {
      console.warn(`⚠️  Resultado inesperado en "${name}": ${result.message}`);
      summaryRows.push(`| ${name} (pendiente) | ⚠️ Inconcluso | ${result.message} |`);
    } else {
      console.log(`🔓 Abierta (pendiente): ${name}`);
      summaryRows.push(`| ${name} (pendiente) | 🔓 Abierta (esperado) | |`);
    }
  }

  // Si corre dentro de GitHub Actions, escribe un resumen en Markdown
  // visible directamente en la pestaña "Actions" del run — sin esto había
  // que abrir los logs completos del job para ver qué tabla falló.
  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = [
      "## 🔒 Verificación de seguridad RLS",
      "",
      "| Verificación | Resultado | Detalle |",
      "| --- | --- | --- |",
      ...summaryRows,
      "",
      failures > 0 ? `❌ **${failures} verificación(es) obligatorias fallaron.**` : "✅ Todas las escrituras sensibles ya aseguradas están correctamente bloqueadas.",
    ].join("\n");
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  }

  if (failures > 0) {
    console.error(`\n${failures} verificación(es) obligatorias fallaron. Revisa las políticas RLS en Supabase.`);
    process.exit(1);
  }
  console.log("\n✅ Todas las escrituras sensibles ya aseguradas están correctamente bloqueadas para la llave pública.");
}

main();
