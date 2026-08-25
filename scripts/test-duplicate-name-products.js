// Prueba de regresión del bug de producción del 2026-08-25: dos
// presentaciones distintas de un mismo producto ("X-TRONG BLANCO DIRECTO
// BRILLANTE" en 4 códigos con precio/stock distintos, y 114 pares más en
// el catálogo real) colapsaban en una sola línea del carrito porque todo
// el POS emparejaba por `name` en vez de `code`. Ver src/lib/posItemMatch.ts
// para el fix -- addToCart/updateItemQty/checkout ya NO comparan `name`
// directamente en ningún lado, todos pasan por matchesProduct().
//
// Parte 1 (lógica pura): importa la función REAL de producción (no una
// copia) usando el type-stripping nativo de Node -- sin esto, sería
// posible arreglar el bug en un lado y dejarlo roto en otro sin que
// ninguna prueba lo note.
// Parte 2 (datos reales): confirma contra el catálogo real de Supabase
// que ningún par de productos con el mismo nombre comparte también el
// mismo código (o le falta código a alguno) -- eso reintroduciría el bug
// para ese par específico, porque matchesProduct() cae de regreso a
// comparar por nombre cuando falta el código.
//
// Uso: npm run test-pos-matching
// Requiere Node 22.6+ (usa --experimental-strip-types) y
// SUPABASE_SERVICE_ROLE_KEY en .env.local para la parte 2.

const fs = require("fs");
const path = require("path");
const { matchesProduct } = require("../src/lib/posItemMatch.ts");

let failures = 0;
function assert(condition, label) {
  if (condition) {
    console.log(`✅ ${label}`);
  } else {
    console.error(`❌ ${label}`);
    failures++;
  }
}

console.log("== Parte 1: lógica pura de matchesProduct() ==\n");

// El caso exacto del video del cliente: dos presentaciones de
// "X-TRONG BLANCO DIRECTO BRILLANTE", códigos EX-0200.30 y EX-0200.20.
assert(
  matchesProduct({ name: "X-TRONG BLANCO DIRECTO BRILLANTE", code: "EX-0200.30" }, { name: "X-TRONG BLANCO DIRECTO BRILLANTE", code: "EX-0200.30" }) === true,
  "Mismo nombre + mismo código -> SÍ es el mismo producto (debe fusionar cantidad)",
);
assert(
  matchesProduct({ name: "X-TRONG BLANCO DIRECTO BRILLANTE", code: "EX-0200.30" }, { name: "X-TRONG BLANCO DIRECTO BRILLANTE", code: "EX-0200.20" }) === false,
  "Mismo nombre + código DISTINTO -> NO es el mismo producto (debe ser línea aparte, el bug original)",
);
assert(
  matchesProduct({ name: "Producto sin código A" }, { name: "Producto sin código A" }) === true,
  "Sin código en ningún lado -> cae de regreso a comparar por nombre (compatibilidad con tickets viejos)",
);
assert(
  matchesProduct({ name: "Mismo nombre", code: "" }, { name: "Mismo nombre", code: "ABC-1" }) === true,
  "Un lado sin código todavía -> cae de regreso a nombre (compatibilidad con carritos/tickets de antes de este fix)",
);

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
  const envPath = path.join(__dirname, "..", ".env.local");
  if (fs.existsSync(envPath)) {
    console.log("\n== Parte 2: catálogo real de Supabase ==\n");
    try {
      const { createClient } = require("@supabase/supabase-js");
      const env = loadEnvLocal();
      const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: items, error } = await admin.from("inventory").select("name, code").or("deleted.is.null,deleted.eq.false");
      if (error) throw error;

      const byName = new Map();
      for (const item of items || []) {
        if (!byName.has(item.name)) byName.set(item.name, []);
        byName.get(item.name).push(item);
      }
      const duplicateNameGroups = [...byName.entries()].filter(([, arr]) => arr.length > 1);

      let brokenPairs = 0;
      for (const [name, group] of duplicateNameGroups) {
        const codes = group.map((g) => (g.code || "").trim());
        const hasEmptyCode = codes.some((c) => c === "");
        const codesSet = new Set(codes);
        if (hasEmptyCode || codesSet.size !== codes.length) {
          console.error(`❌ "${name}": ${group.length} productos comparten nombre pero NO todos tienen código único -> siguen expuestos al bug original.`);
          brokenPairs++;
        }
      }
      assert(brokenPairs === 0, `${duplicateNameGroups.length} grupo(s) de nombre duplicado en el catálogo real, todos con código único por producto`);
    } catch (err) {
      console.warn(`⚠️  No se pudo correr la Parte 2 (catálogo real): ${err.message}`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} verificación(es) fallaron.`);
    process.exitCode = 1;
    return;
  }
  console.log("\n✅ Todo correcto: productos con el mismo nombre nunca se confunden entre sí.");
}

main();
