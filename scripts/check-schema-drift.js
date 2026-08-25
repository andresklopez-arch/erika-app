// Compara las listas blancas de columnas en src/lib/*Fields.ts contra las
// columnas reales de cada tabla en Supabase, usando el RPC
// admin_list_table_columns() (Service Role Key, ver migración
// 20260825030000_add_column_audit_rpc.sql).
//
// Nace del bug de producción del 2026-08-25: quotesFields.ts (y el
// checkout de POSModule.tsx) asumían columnas en `quotes` (customer_id,
// discount_pct, apply_iva, notes) que nunca se crearon en la base real —
// toda venta guardó bien el dinero pero perdió su ticket en silencio
// durante 4 días. Este script existe para atrapar ese tipo de desfase
// ANTES de que un cambio de código llegue a producción.
//
// Uso local: npm run check-schema
// Requiere SUPABASE_SERVICE_ROLE_KEY en .env.local — igual que
// audit-full-schema.js, no correr esto en CI con una llave pública.

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

// Cada entrada whitelist se declara como código real (no config aparte)
// junto al endpoint de servidor que la usa — si se agrega un *Fields.ts
// nuevo, agregarlo aquí también.
const FIELD_FILES = [
  { table: "quotes", file: "src/lib/quotesFields.ts", constName: "QUOTES_ALLOWED_FIELDS" },
  { table: "inventory", file: "src/lib/inventoryFields.ts", constName: "INVENTORY_ALLOWED_FIELDS" },
  { table: "suppliers", file: "src/lib/suppliersFields.ts", constName: "SUPPLIER_ALLOWED_FIELDS" },
  { table: "services", file: "src/lib/servicesFields.ts", constName: "SERVICE_ALLOWED_FIELDS" },
];

function extractFieldList(constName, fileContents) {
  const re = new RegExp(`${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]`);
  const match = fileContents.match(re);
  if (!match) return null;
  return [...match[1].matchAll(/["']([a-zA-Z0-9_]+)["']/g)].map((m) => m[1]);
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

  const { data: columns, error } = await admin.rpc("admin_list_table_columns");
  if (error) {
    console.error(
      "❌ Error al consultar admin_list_table_columns (¿falta correr la migración 20260825030000?):",
      error.message,
    );
    process.exit(1);
  }

  const columnsByTable = new Map();
  for (const c of columns || []) {
    if (!columnsByTable.has(c.table_name)) columnsByTable.set(c.table_name, new Set());
    columnsByTable.get(c.table_name).add(c.column_name);
  }

  let totalMissing = 0;
  const summaryRows = [];

  for (const { table, file, constName } of FIELD_FILES) {
    const filePath = path.join(__dirname, "..", file);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  No existe ${file}, se omite.`);
      continue;
    }
    const fields = extractFieldList(constName, fs.readFileSync(filePath, "utf8"));
    if (!fields) {
      console.warn(`⚠️  No se pudo extraer ${constName} de ${file}, se omite.`);
      continue;
    }

    const realColumns = columnsByTable.get(table);
    if (!realColumns) {
      console.error(`❌ La tabla "${table}" (esperada por ${file}) no existe en la base de datos.`);
      totalMissing += fields.length;
      summaryRows.push(`| ${table} | ❌ Tabla inexistente | ${file} |`);
      continue;
    }

    const missing = fields.filter((f) => !realColumns.has(f));
    if (missing.length === 0) {
      console.log(`✅ ${table} (${file}): las ${fields.length} columnas de ${constName} existen en la base real.`);
      summaryRows.push(`| ${table} | ✅ Sin desfase | ${fields.length} columna(s) verificada(s) |`);
    } else {
      console.error(`❌ ${table} (${file}): ${missing.length} columna(s) en ${constName} NO existen en la base real: ${missing.join(", ")}`);
      totalMissing += missing.length;
      summaryRows.push(`| ${table} | ❌ **${missing.length} columna(s) faltante(s)** | ${missing.join(", ")} |`);
    }
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = [
      "## 🧬 Auditoría de desfase de esquema (código vs. base real)",
      "",
      "| Tabla | Resultado | Detalle |",
      "| --- | --- | --- |",
      ...summaryRows,
      "",
      totalMissing > 0
        ? `❌ **${totalMissing} columna(s) referenciada(s) por el código no existen en Supabase.**`
        : "✅ Todas las columnas que el código espera existen en la base real.",
    ].join("\n");
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  }

  if (totalMissing > 0) {
    console.error(`\n${totalMissing} columna(s) referenciada(s) por el código no existen en Supabase. Corre la migración correspondiente antes de desplegar.`);
    process.exit(1);
  }
  console.log("\n✅ Sin desfase de esquema: todas las columnas que el código espera existen en la base real.");
}

main();
