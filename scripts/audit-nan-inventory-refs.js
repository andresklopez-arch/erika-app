// Auditoría (informativa, no bloqueante, no corrige nada) del rastro que
// dejó en la base de datos el bug del folio roto corregido el 2026-08-27:
// en toda venta de contado/tarjeta/crédito, `realTicketId` se calculaba
// como Number(quotes.id) -- pero quotes.id es un uuid, así que ese
// Number() siempre daba NaN. Ese NaN no solo se imprimía en el ticket
// (folio falso "TK-00*00" y link de auto-facturación roto, ya corregidos
// en la UI) -- también viajaba como referencia al Kardex de inventario
// (`reduceInventoryStock(items, "sale", realTicketId.toString())`), así
// que CADA movimiento de tipo "sale" registrado antes del fix quedó con
// `inventory_movements.reference_id = "NaN"` en vez del ticket real: no
// hay forma de saber, mirando el Kardex, a qué venta corresponde cada uno
// de esos movimientos.
//
// Este script solo cuenta y lista una muestra -- no intenta adivinar ni
// corregir el reference_id real (correlacionar por timestamp sería una
// suposición, no un hecho, y escribiría datos de auditoría incorrectos
// con más confianza de la que merecen). Sirve para dimensionar el
// problema: cuántos movimientos quedaron así y en qué rango de fechas.
//
// Uso: node scripts/audit-nan-inventory-refs.js

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
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { count, error: countErr } = await admin
    .from("inventory_movements")
    .select("id", { count: "exact", head: true })
    .eq("reference_id", "NaN");

  if (countErr) {
    console.error("❌ Error al consultar inventory_movements:", countErr.message);
    process.exit(1);
  }

  console.log(`\n📋 Movimientos de inventario con reference_id="NaN" (rastro del bug del folio roto): ${count}\n`);

  if (!count) {
    console.log("✅ No hay movimientos afectados -- nada que revisar.");
    return;
  }

  const { data: sample, error: sampleErr } = await admin
    .from("inventory_movements")
    .select("id, inventory_id, quantity, movement_type, created_by, created_at")
    .eq("reference_id", "NaN")
    .order("created_at", { ascending: true });

  if (sampleErr) {
    console.error("❌ Error al listar la muestra:", sampleErr.message);
    process.exit(1);
  }

  const byType = {};
  for (const row of sample) {
    byType[row.movement_type] = (byType[row.movement_type] || 0) + 1;
  }
  console.log("Por tipo de movimiento:", JSON.stringify(byType, null, 2));

  if (sample.length > 0) {
    console.log(`\nRango de fechas: ${sample[0].created_at}  →  ${sample[sample.length - 1].created_at}`);
    console.log("\nPrimeros 10 (más antiguos):");
    for (const row of sample.slice(0, 10)) {
      console.log(`  - ${row.created_at} | ${row.movement_type} | cantidad ${row.quantity} | producto ${row.inventory_id} | por ${row.created_by || "?"}`);
    }
  }

  console.log(
    "\nℹ️  Esto es solo informativo: el stock en sí siempre se descontó bien " +
    "(el bug era en la referencia guardada, no en la cantidad). No se modifica nada automáticamente.",
  );
}

main().catch((e) => {
  console.error("❌ Error inesperado:", e);
  process.exit(1);
});
