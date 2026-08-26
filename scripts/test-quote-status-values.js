// Prueba de regresión del bug del 2026-08-24 (reportado por Ferretería
// Erika): la restricción quotes_status_check nunca permitió
// status='cancelled' -- CADA cancelación de ticket, desde que existe
// handleExecuteCancelTicket() en POSModule.tsx, falló en silencio contra
// esta restricción (el código solo hacía console.warn y mostraba "✅
// CANCELADO" de todas formas). Cero tickets se cancelaron exitosamente en
// toda la historia de la app hasta el fix (ver
// supabase/migrations/20260828010000_allow_cancelled_quote_status.sql).
//
// En vez de probar solo 'cancelled', esta prueba recorre TODO
// QUOTE_STATUS_VALUES (src/lib/quotesFields.ts) -- la lista única de
// valores que el código alguna vez escribe en `quotes.status`. Si en el
// futuro se agrega un status nuevo ahí sin ampliar también la
// restricción real de la base, esta prueba lo atrapa igual que atrapó el
// bug original de 'cancelled'.
//
// Para cada valor: inserta un ticket de prueba real con ese status,
// confirma que la base de datos lo acepta, y lo borra sin dejar rastro.
//
// Uso: npm run test-quote-status-values (requiere .env.local)

const fs = require("fs");
const path = require("path");
const { QUOTE_STATUS_VALUES } = require("../src/lib/quotesFields.ts");

async function main() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) {
    console.warn("⚠️  No se encontró .env.local -- se omite esta prueba (requiere la base de datos real).");
    return;
  }

  const { createClient } = require("@supabase/supabase-js");
  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let failures = 0;
  function assert(condition, label, detail) {
    if (condition) {
      console.log(`✅ ${label}`);
    } else {
      console.error(`❌ ${label}${detail ? " — " + detail : ""}`);
      failures++;
    }
  }

  console.log(`Probando ${QUOTE_STATUS_VALUES.length} valor(es) de QUOTE_STATUS_VALUES contra la base real: ${QUOTE_STATUS_VALUES.join(", ")}\n`);

  for (const statusValue of QUOTE_STATUS_VALUES) {
    let testId = null;
    try {
      const { data: inserted, error: insErr } = await admin
        .from("quotes")
        .insert({
          customer_name: `[TEST AUTOMATIZADO] status=${statusValue}`,
          items: [{ name: "Producto de prueba", price: 1, qty: 1 }],
          total: 1,
          status: statusValue,
        })
        .select("id")
        .single();
      assert(!insErr && !!inserted?.id, `La base de datos acepta status='${statusValue}'`, insErr?.message);
      testId = inserted?.id || null;
    } finally {
      if (testId) await admin.from("quotes").delete().eq("id", testId);
    }
  }
  console.log("\n🧹 Tickets de prueba eliminados.");

  if (failures > 0) {
    console.error(`\n${failures} verificación(es) fallaron -- QUOTE_STATUS_VALUES tiene un valor que la restricción real de la base no permite.`);
    process.exitCode = 1;
  } else {
    console.log("\n✅ Todo correcto: todos los valores de QUOTE_STATUS_VALUES se pueden guardar en la base de datos real.");
  }
}

main().catch((e) => {
  console.error("❌ Error inesperado:", e);
  process.exitCode = 1;
});
