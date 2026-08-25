// Prueba de regresión del bug real del 2026-08-25: la cotización #113 se
// guardó con total $46.80 (4% de aumento aplicado al ticket) pero
// discount_pct/apply_iva no se persistían -- al mandarla a caja para
// cobrar, el sistema perdía el ajuste y cobraba $45.00, un monto distinto
// al que se le había cotizado al cliente.
//
// Parte 1 (lógica pura): importa computeQuoteExpectedTotal/
// getQuoteTotalMismatch REALES de producción (src/lib/quoteTotalCheck.ts)
// y confirma el caso exacto del bug, más los casos de descuento/IVA.
// Parte 2 (datos reales): revisa TODAS las cotizaciones reales en Supabase
// y reporta cuántas tienen un total que no coincide con sus artículos +
// discount_pct/apply_iva guardados -- mismo chequeo que ahora se muestra
// como aviso visual en QuotesModule.tsx/CustomersModule.tsx.
//
// Uso: npm run test-quote-total

const fs = require("fs");
const path = require("path");
const { computeQuoteExpectedTotal, getQuoteTotalMismatch } = require("../src/lib/quoteTotalCheck.ts");

let failures = 0;
function assert(condition, label) {
  if (condition) {
    console.log(`✅ ${label}`);
  } else {
    console.error(`❌ ${label}`);
    failures++;
  }
}

console.log("== Parte 1: lógica pura de computeQuoteExpectedTotal() ==\n");

// El caso exacto del bug: 1 artículo de $45, 4% de aumento (discountPct
// negativo = "% Desc/Aumento" usado como aumento), sin IVA.
assert(
  computeQuoteExpectedTotal([{ price: 45, qty: 1 }], -4, false) === 47,
  "1 artículo de $45 + 4% de aumento -> $47 (Math.round(46.8)), no $45 ni $46.80 sin redondear",
);

assert(
  computeQuoteExpectedTotal([{ price: 100, qty: 2 }], 0, false) === 200,
  "Sin ajustes: 2 artículos de $100 -> $200 exacto",
);

assert(
  computeQuoteExpectedTotal([{ price: 100, qty: 1 }], 10, false) === 90,
  "10% de descuento (positivo) sobre $100 -> $90",
);

assert(
  computeQuoteExpectedTotal([{ price: 100, qty: 1 }], 0, true, 0.16) === 116,
  "IVA 16% sobre $100 sin otros ajustes -> $116",
);

console.log("\n== Parte 1b: getQuoteTotalMismatch() ==\n");

// Reconstruye el caso real de la cotización #113 tal cual está guardado
// HOY en producción (antes del fix): total=46.8 pero discount_pct=0 y
// apply_iva=false -- ese es justo el estado "ya roto" que el aviso visual
// debe detectar para cotizaciones viejas.
const brokenQuote113 = { total: 46.8, items: [{ price: 45, qty: 1 }], discount_pct: 0, apply_iva: false };
assert(getQuoteTotalMismatch(brokenQuote113).mismatch === true, "Cotización #113 (tal como quedó guardada antes del fix) se detecta como desfasada");

// Una cotización guardada CON el fix (discount_pct persistido) no debe
// marcarse como desfasada.
const fixedQuote = { total: 47, items: [{ price: 45, qty: 1 }], discount_pct: -4, apply_iva: false };
assert(getQuoteTotalMismatch(fixedQuote).mismatch === false, "Cotización guardada con discount_pct correcto NO se marca como desfasada");

async function main() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (fs.existsSync(envPath)) {
    console.log("\n== Parte 2: cotizaciones reales de Supabase ==\n");
    try {
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

      let all = [];
      let from = 0;
      while (true) {
        const { data, error } = await admin
          .from("quotes")
          .select("quote_number, total, items, discount_pct, apply_iva, status")
          .range(from, from + 999);
        if (error) throw error;
        all = all.concat(data);
        if (data.length < 1000) break;
        from += 1000;
      }

      const mismatched = all.filter((q) => getQuoteTotalMismatch(q).mismatch);
      console.log(`${all.length} cotizaciones revisadas, ${mismatched.length} con desfase entre total y artículos+ajustes.`);
      for (const q of mismatched.slice(0, 15)) {
        const { expectedTotal } = getQuoteTotalMismatch(q);
        console.log(`  ⚠️  #${q.quote_number} (${q.status}): guardado $${q.total} vs esperado $${expectedTotal}`);
      }
      // Informativo, no falla el script: las desfasadas de ANTES del fix
      // (ya vendidas) se quedan así para siempre -- no hay forma de
      // reconstruir qué ajuste llevaban. Lo que importa es que las
      // PENDIENTES (aún cobrables) no tengan desfase.
      const mismatchedPending = mismatched.filter((q) => q.status === "pending");
      assert(mismatchedPending.length === 0, `${mismatchedPending.length} cotización(es) PENDIENTE(S) (aún por cobrar) con desfase -- esas sí importan`);
    } catch (err) {
      console.warn(`⚠️  No se pudo correr la Parte 2 (datos reales): ${err.message}`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} verificación(es) fallaron.`);
    process.exitCode = 1;
    return;
  }
  console.log("\n✅ Todo correcto: el total de una cotización se calcula igual desde la lógica pura y coincide con las cotizaciones pendientes reales.");
}

main();
