// Prueba de regresión del bug del 2026-08-27 (reportado por Ferretería
// Erika vía WhatsApp, con video): al vender una cotización pendiente desde
// la pestaña "Clientes y Crédito", la app mandaba siempre a Arqueo de
// Caja -- pantalla de Corte de Caja Ciego que no tiene nada que ver con
// cobrar un ticket -- incluso con la caja YA abierta, dejando al cajero
// varado ahí y obligándolo a navegar manualmente hasta Punto de Venta.
//
// La causa real: "vender una cotización" tenía DOS implementaciones
// separadas (handleSellQuote en QuotesModule.tsx, convertQuoteToSale en
// CustomersModule.tsx) que fueron divergiendo -- una ya sabía checar si
// había caja abierta, la otra no. Se unificaron ambas en un solo hook,
// src/hooks/useSellQuoteToPOS.ts, para que una futura corrección no se
// tenga que aplicar dos veces (y se le olvide una, como pasó aquí).
//
// Escaneo estático (estas pantallas casi nunca corren en CI contra una
// base de datos real, así que no hay una prueba de flujo en vivo como
// test-caja o test-cancelacion):
//  1. QuotesModule.tsx y CustomersModule.tsx importan useSellQuoteToPOS
//     en vez de reimplementar la navegación cada uno por su cuenta.
//  2. Ninguno de los dos hace un window.location.href = "/caja" directo
//     -- esa decisión vive solo en el hook compartido.
//  3. useSellQuoteToPOS.ts sí revisa cash_sessions (status "open") ANTES
//     de decidir a dónde navegar, y el redirect a "/caja" cuelga de la
//     rama "else" (caja cerrada), nunca de forma incondicional.
//
// Uso: npm run test-sell-quote-routing

const fs = require("fs");
const path = require("path");

let failures = 0;
function assert(condition, label) {
  if (condition) {
    console.log(`✅ ${label}`);
  } else {
    console.error(`❌ ${label}`);
    failures++;
  }
}

const hookPath = path.join(__dirname, "..", "src", "hooks", "useSellQuoteToPOS.ts");
const quotesModulePath = path.join(__dirname, "..", "src", "components", "QuotesModule.tsx");
const customersModulePath = path.join(__dirname, "..", "src", "components", "CustomersModule.tsx");

const hookSrc = fs.readFileSync(hookPath, "utf8");
const quotesSrc = fs.readFileSync(quotesModulePath, "utf8");
const customersSrc = fs.readFileSync(customersModulePath, "utf8");

console.log("== Parte 1: QuotesModule.tsx y CustomersModule.tsx usan el hook compartido ==\n");

assert(
  /import\s*\{\s*useSellQuoteToPOS\s*\}\s*from\s*["']\.\.\/hooks\/useSellQuoteToPOS["']/.test(quotesSrc),
  "QuotesModule.tsx importa useSellQuoteToPOS",
);
assert(
  /import\s*\{\s*useSellQuoteToPOS\s*\}\s*from\s*["']\.\.\/hooks\/useSellQuoteToPOS["']/.test(customersSrc),
  "CustomersModule.tsx importa useSellQuoteToPOS",
);

const directCajaRedirect = /window\.location\.href\s*=\s*["']\/caja["']/;
assert(
  !directCajaRedirect.test(quotesSrc),
  "QuotesModule.tsx ya no reimplementa el redirect a /caja directo (vive solo en el hook)",
);
assert(
  !directCajaRedirect.test(customersSrc),
  "CustomersModule.tsx ya no reimplementa el redirect a /caja directo (vive solo en el hook)",
);

console.log("\n== Parte 2: el hook compartido SIEMPRE checa cash_sessions antes de decidir ==\n");

const cashSessionsCheckIdx = hookSrc.search(/\.from\(["']cash_sessions["']\)[\s\S]*?\.eq\(["']status["'],\s*["']open["']\)/);
assert(cashSessionsCheckIdx !== -1, "useSellQuoteToPOS.ts consulta cash_sessions con status='open'");

const cajaRedirectMatches = [...hookSrc.matchAll(/window\.location\.href\s*=\s*["']\/caja["']/g)];
assert(cajaRedirectMatches.length === 1, `useSellQuoteToPOS.ts redirige a /caja en exactamente 1 lugar (encontrados: ${cajaRedirectMatches.length})`);

if (cajaRedirectMatches.length === 1 && cashSessionsCheckIdx !== -1) {
  const redirectIdx = cajaRedirectMatches[0].index;
  assert(
    redirectIdx > cashSessionsCheckIdx,
    "El redirect a /caja aparece DESPUÉS de checar cash_sessions (no antes, no sin checar)",
  );

  const elseIdx = hookSrc.indexOf("} else {", cashSessionsCheckIdx);
  assert(
    elseIdx !== -1 && elseIdx < redirectIdx && redirectIdx < hookSrc.indexOf("}", redirectIdx),
    "El redirect a /caja cuelga de la rama else (caja cerrada), no es incondicional",
  );

  const posRedirectMatches = [...hookSrc.matchAll(/window\.location\.href\s*=\s*["']\/["']/g)];
  assert(posRedirectMatches.length === 1, `useSellQuoteToPOS.ts redirige directo a Punto de Venta ("/") en exactamente 1 lugar (encontrados: ${posRedirectMatches.length})`);
  if (posRedirectMatches.length === 1) {
    assert(
      posRedirectMatches[0].index < redirectIdx,
      'La rama "hay caja abierta -> ir directo a POS" aparece antes que la rama "/caja" en el código',
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures} verificación(es) fallaron.`);
  process.exitCode = 1;
} else {
  console.log("\n✅ Todo correcto: vender una cotización siempre checa si ya hay caja abierta antes de decidir a dónde navegar, en un único lugar compartido.");
}
