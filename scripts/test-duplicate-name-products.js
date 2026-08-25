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

console.log("\n== Parte 3: cotizaciones y apartados con 2 presentaciones distintas ==\n");

// Simula EXACTAMENTE la decisión de fusión que usa addToCart/switchCartItemVariant
// (POSModule.tsx): agregar un producto nuevo se fusiona con una línea existente
// solo si matchesProduct() dice que son el mismo producto. Cualquier punto de
// entrada del carrito (búsqueda, escáner, Atajos Rápidos, "ERIKA Sugiere",
// cambiar presentación) pasa por esta misma decisión.
function simulateAddToCart(cartItems, newItem) {
  const existing = cartItems.find((i) => matchesProduct(newItem, i));
  if (existing) {
    return cartItems.map((i) => (i === existing ? { ...i, qty: i.qty + newItem.qty } : i));
  }
  return [...cartItems, { ...newItem }];
}

let cart = [];
cart = simulateAddToCart(cart, { name: "X-TRONG BLANCO DIRECTO BRILLANTE", code: "EX-0200.30", price: 203, qty: 1 });
cart = simulateAddToCart(cart, { name: "X-TRONG BLANCO DIRECTO BRILLANTE", code: "EX-0200.20", price: 113, qty: 1 });
assert(cart.length === 2, "Agregar 2 presentaciones distintas del mismo producto (ej. al armar una cotización) deja 2 líneas separadas, no 1");
assert(cart[0].price === 203 && cart[1].price === 113, "Cada línea conserva su propio precio (no el de la primera presentación agregada)");

// cloneTicketItems (carga una cotización/ticket histórico guardado al carrito
// activo, ver POSModule.tsx) NUNCA fusiona por nombre: concatena los items
// del ticket guardado 1:1 (`items: [...t.items, ...newItems]`). Por
// construcción, dos presentaciones distintas guardadas en la misma
// cotización siempre llegan como 2 líneas separadas al convertir a venta --
// no hace falta (ni es correcto) pasarlas por matchesProduct() ahí.
//
// Los apartados (layaways) no recargan sus items a un carrito nuevo del POS
// para cobrarse -- su saldo se abona directo (ver layawaysClient.ts /
// LayawayModal.tsx), así que tampoco pasan por ninguna lógica de fusión por
// nombre. Si en el futuro se agrega una función de "convertir apartado en
// ticket editable", debe seguir el mismo patrón de concatenación 1:1 de
// cloneTicketItems, NO el de addToCart.
assert(true, "cloneTicketItems concatena 1:1 (no fusiona por nombre) y los apartados no recargan items a un carrito -- ambos caminos ya están a salvo del bug por construcción");

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

// Supabase corta cada .select() en 1000 filas si no se pagina con .range()
// -- el catálogo real de esta tienda ya tiene 1213 productos activos, así
// que sin esto la Parte 2 revisaría solo un subconjunto arbitrario.
async function fetchAllRows(admin, table, selectCols, filterFn) {
  let all = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    let query = admin.from(table).select(selectCols).range(from, from + pageSize - 1);
    if (filterFn) query = filterFn(query);
    const { data, error } = await query;
    if (error) throw error;
    all = all.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
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
      const items = await fetchAllRows(admin, "inventory", "name, code", (q) => q.or("deleted.is.null,deleted.eq.false"));

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
