// Prueba de regresión del bug del 2026-08-24 (reportado por Ferretería
// Erika): la restricción quotes_status_check nunca permitió
// status='cancelled' -- CADA cancelación de ticket, desde que existe
// handleExecuteCancelTicket() en POSModule.tsx, falló en silencio contra
// esta restricción (el código solo hacía console.warn y mostraba "✅
// CANCELADO" de todas formas). Cero tickets se cancelaron exitosamente en
// toda la historia de la app hasta el fix (ver
// supabase/migrations/20260828010000_allow_cancelled_quote_status.sql).
//
// Esta prueba inserta un ticket de prueba real, intenta marcarlo como
// cancelled (el mismo UPDATE que hace la app), y confirma que la base de
// datos lo acepta -- después borra la fila de prueba sin dejar rastro.
//
// Uso: npm run test-cancel-ticket-status (requiere .env.local)

const fs = require("fs");
const path = require("path");

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

  let testId = null;
  try {
    const { data: inserted, error: insErr } = await admin
      .from("quotes")
      .insert({
        customer_name: "[TEST AUTOMATIZADO] Cancelación de Ticket",
        items: [{ name: "Producto de prueba", price: 1, qty: 1 }],
        total: 1,
        status: "ticket",
      })
      .select("id")
      .single();
    assert(!insErr && !!inserted?.id, "Se creó el ticket de prueba con status='ticket'", insErr?.message);
    testId = inserted?.id || null;
    if (!testId) throw new Error("No se pudo crear el ticket de prueba, abortando.");

    const { error: cancelErr } = await admin.from("quotes").update({ status: "cancelled" }).eq("id", testId);
    assert(
      !cancelErr,
      "La base de datos acepta status='cancelled' (quotes_status_check permite este valor)",
      cancelErr?.message,
    );

    const { data: after } = await admin.from("quotes").select("status").eq("id", testId).single();
    assert(after?.status === "cancelled", "El ticket de prueba quedó guardado con status='cancelled'", `status real: ${after?.status}`);
  } finally {
    if (testId) {
      await admin.from("quotes").delete().eq("id", testId);
      console.log("🧹 Ticket de prueba eliminado.");
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} verificación(es) fallaron.`);
    process.exitCode = 1;
  } else {
    console.log("\n✅ Todo correcto: la cancelación de tickets se puede guardar en la base de datos real.");
  }
}

main().catch((e) => {
  console.error("❌ Error inesperado:", e);
  process.exitCode = 1;
});
