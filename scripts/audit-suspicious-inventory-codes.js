// Auditoría (informativa, solo lectura) del mismo patrón de riesgo que causó
// el incidente VEKER (2026-08-27): 8 medidas de tornillos con el mismo
// "código" pegado por error (la marca, no un SKU real) se fusionaron en un
// solo producto en importaciones sucesivas -- ver el candado agregado en
// SmartImporter.tsx (paso 1) para prevenir esto hacia adelante.
//
// Este script busca la MISMA señal hacia atrás: un código real de barras/SKU
// casi siempre trae dígitos (EAN-13, UPC, folios internos con número). Un
// código sin ningún dígito (solo letras, como "VEKER") es sospechoso de ser
// en realidad una marca/proveedor/categoría pegada por error -- cualquier
// importación futura que vuelva a pegar ese mismo texto como código
// fusionaría silenciosamente el producto nuevo con el que ya tiene ese
// código, igual que pasó con VEKER.
//
// No corrige nada: solo lista los códigos sospechosos para que se revisen a
// mano (podría haber falsos positivos legítimos, ej. códigos internos como
// "PENDIENTE" o abreviaturas cortas que el negocio sí usa a propósito).
//
// Uso: node scripts/audit-suspicious-inventory-codes.js

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

  let allItems = [];
  let from = 0;
  const limit = 1000;
  for (;;) {
    const { data, error } = await admin
      .from("inventory")
      .select("id, code, name, supplier, stock")
      .eq("deleted", false)
      .range(from, from + limit - 1);
    if (error) {
      console.error("❌ Error al consultar inventory:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    allItems = allItems.concat(data);
    if (data.length < limit) break;
    from += limit;
  }

  const HAS_DIGIT_RE = /[0-9]/;
  const suspicious = allItems.filter((i) => i.code && !HAS_DIGIT_RE.test(i.code) && i.code.trim() !== "");

  console.log(`\n📋 Total de productos activos: ${allItems.length}`);
  console.log(`⚠️  Códigos sin ningún dígito (posible marca/categoría pegada por error en vez de un SKU real): ${suspicious.length}\n`);

  if (suspicious.length === 0) {
    console.log("✅ No se encontraron códigos sospechosos.");
    return;
  }

  // Agrupar por código para ver de un vistazo cuáles se repiten exactamente
  // igual entre productos DISTINTOS -- si dos nombres distintos comparten el
  // mismo código, es la señal más fuerte de que ese código no es único.
  const byCode = new Map();
  for (const item of suspicious) {
    const key = item.code.trim().toUpperCase();
    if (!byCode.has(key)) byCode.set(key, []);
    byCode.get(key).push(item);
  }

  const sharedCodes = Array.from(byCode.entries()).filter(([, items]) => items.length > 1);
  if (sharedCodes.length > 0) {
    console.log(`🚨 De esos, ${sharedCodes.length} código(s) YA están repetidos entre productos con nombres distintos (riesgo activo, no solo potencial):\n`);
    for (const [code, items] of sharedCodes) {
      console.log(`  Código "${code}" (${items.length} productos):`);
      items.forEach((i) => console.log(`    - ${i.name} | stock ${i.stock} | proveedor ${i.supplier || "?"}`));
    }
    console.log("");
  }

  console.log("Lista completa de códigos sin dígitos:");
  for (const item of suspicious) {
    console.log(`  - "${item.code}" | ${item.name} | proveedor ${item.supplier || "?"} | stock ${item.stock}`);
  }

  console.log(
    "\nℹ️  Esto es solo informativo: revisa a mano si cada código sospechoso es intencional (ej. un código interno corto) " +
    "o si en realidad debería tener un SKU/barcode real distinto por producto.",
  );
}

main().catch((e) => {
  console.error("❌ Error inesperado:", e);
  process.exit(1);
});
