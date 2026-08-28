// Prueba de regresión del bug del 2026-08-24 (reportado por Ferretería
// Erika vía WhatsApp): los 3 sitios donde se captura discount_pct (modal de
// descuento individual, descuento masivo, edición en la tabla de
// InventoryModule.tsx) usaban `parseInt`, que truncaba 10.5% -> 10% aunque
// la columna en la base ya es `numeric`. El fix extrajo el parseo a
// src/lib/parsePercent.ts para que los 3 sitios compartan la misma lógica.
//
// 2026-08-27: el mismo bug apareció en un 4to sitio -- el % de las "Escalas
// de Descuento" (Reglas de Descuento Inteligente por volumen, newRuleTiers)
// seguía usando parseInt porque es un campo % hermano, no discount_pct, y
// quedó fuera del escaneo original. Se agrega aquí para que un 5to sitio
// futuro tampoco se escape.
//
// Parte 1 (lógica pura): importa parsePercentInput() REAL de producción.
// Parte 2 (escaneo estático): confirma que ningún sitio de
// InventoryModule.tsx relacionado a un campo % de descuento volvió a usar
// `parseInt` directo -- así una regresión futura (alguien "simplificando" el
// código) se detecta aquí en vez de en un reporte de WhatsApp.
//
// Uso: npm run test-decimal-discount

const fs = require("fs");
const path = require("path");
const { parsePercentInput } = require("../src/lib/parsePercent.ts");

let failures = 0;
function assert(condition, label) {
  if (condition) {
    console.log(`✅ ${label}`);
  } else {
    console.error(`❌ ${label}`);
    failures++;
  }
}

console.log("== Parte 1: lógica pura de parsePercentInput() ==\n");

assert(parsePercentInput("10.5") === 10.5, '"10.5" -> 10.5 (no se trunca a 10, el bug original)');
assert(parsePercentInput("10.567") === 10.57, '"10.567" -> 10.57 (redondea a 2 decimales, no los trunca)');
assert(parsePercentInput("10") === 10, '"10" -> 10 (entero sigue funcionando igual que antes)');
assert(parsePercentInput("") === 0, '"" (vacío) -> 0');
assert(parsePercentInput("abc") === 0, '"abc" (no numérico) -> 0, no NaN');
assert(parsePercentInput("0.1") === 0.1, '"0.1" -> 0.1 (no 0, el caso límite de parseInt más engañoso)');

console.log("\n== Parte 2: escaneo estático -- discount_pct no vuelve a usar parseInt ==\n");

const invPath = path.join(__dirname, "..", "src", "components", "InventoryModule.tsx");
const src = fs.readFileSync(invPath, "utf8");
const lines = src.split("\n");

const offenders = [];
lines.forEach((line, idx) => {
  const isDiscountPctLine = /discount_pct|PromoDiscountPct|BulkPromoPct|discountPct/.test(line);
  const usesParseInt = /parseInt\s*\(/.test(line);
  if (isDiscountPctLine && usesParseInt) {
    offenders.push(`  línea ${idx + 1}: ${line.trim()}`);
  }
});

assert(
  offenders.length === 0,
  offenders.length === 0
    ? "Ningún sitio relacionado a un % de descuento en InventoryModule.tsx usa parseInt"
    : `Se encontró parseInt en líneas relacionadas a un % de descuento:\n${offenders.join("\n")}`,
);

const usesSharedHelper = (src.match(/parsePercentInput\(/g) || []).length;
assert(usesSharedHelper >= 4, `InventoryModule.tsx usa parsePercentInput() en los 4 sitios esperados (encontrados: ${usesSharedHelper})`);

if (failures > 0) {
  console.error(`\n${failures} verificación(es) fallaron.`);
  process.exitCode = 1;
} else {
  console.log("\n✅ Todo correcto: el % de descuento acepta decimales en los 3 sitios y nadie volvió a truncar con parseInt.");
}
