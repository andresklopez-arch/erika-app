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
// 2026-08-27 (mismo día, ronda 2): capturar el % con decimales no bastaba
// por sí solo -- había que confirmar que ese decimal sobrevive hasta el
// precio final que ve el cliente, no solo que el campo lo acepta. Parte 3
// prueba getSmartVolumeDiscount() (src/lib/smartVolumeDiscount.ts, la
// misma función que usa el POS real) con una regla de 12.5%, de punta a
// punta hasta el precio calculado.
//
// Parte 1 (lógica pura): importa parsePercentInput() REAL de producción.
// Parte 2 (escaneo estático): confirma que ningún sitio de
// InventoryModule.tsx relacionado a un campo % de descuento volvió a usar
// `parseInt` directo -- así una regresión futura (alguien "simplificando" el
// código) se detecta aquí en vez de en un reporte de WhatsApp.
// Parte 3 (aplicación real): una regla con 12.5% se aplica como 12.5%, no
// como 12%, al calcular el precio final de un producto que la cumple.
//
// Uso: npm run test-decimal-discount

const fs = require("fs");
const path = require("path");
const { parsePercentInput } = require("../src/lib/parsePercent.ts");
const { getSmartVolumeDiscount } = require("../src/lib/smartVolumeDiscount.ts");

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

console.log("\n== Parte 3: aplicación real -- el decimal sobrevive hasta el precio final ==\n");

const decimalRule = {
  id: "test-rule",
  name: "Prueba Decimal",
  targetType: "keyword",
  targetValue: "pija",
  active: true,
  tiers: [
    { minQty: 20, discountPct: 12.5 },
    { minQty: 30, discountPct: 30 },
  ],
};

const itemBelowTier = { name: "PIJA TR NEGRA 1 3/4 X8", price: 100, qty: 5 };
const itemAtDecimalTier = { name: "PIJA TR NEGRA 1 3/4 X8", price: 100, qty: 20 };
const itemAtIntegerTier = { name: "PIJA TR NEGRA 1 3/4 X8", price: 100, qty: 30 };

const belowResult = getSmartVolumeDiscount(itemBelowTier, [decimalRule]);
assert(belowResult.discountPct === 0, "Con 5 piezas (bajo la primera escala) -> 0% de descuento, ninguna escala aplica todavía");

const decimalResult = getSmartVolumeDiscount(itemAtDecimalTier, [decimalRule]);
assert(decimalResult.discountPct === 12.5, `Con 20 piezas -> 12.5% exacto (obtenido: ${decimalResult.discountPct}%, NO 12% truncado)`);
const decimalPrice = itemAtDecimalTier.price * (1 - decimalResult.discountPct / 100);
assert(Math.abs(decimalPrice - 87.5) < 0.001, `Precio final con 20 piezas: $${decimalPrice.toFixed(2)} (se esperaba $87.50, NO $88.00 que daría el bug truncado a 12%)`);

const integerResult = getSmartVolumeDiscount(itemAtIntegerTier, [decimalRule]);
assert(integerResult.discountPct === 30, `Con 30 piezas -> 30% exacto (obtenido: ${integerResult.discountPct}%, escala entera sigue funcionando igual)`);

// Producto que no coincide con la palabra clave de la regla: el % no
// debe aplicarse sin importar la cantidad -- confirma que el matching por
// keyword sigue intacto después de mover la función a smartVolumeDiscount.ts.
const unrelatedItem = { name: "PINTURA VINÍLICA BLANCA 19L", price: 100, qty: 50 };
const unrelatedResult = getSmartVolumeDiscount(unrelatedItem, [decimalRule]);
assert(unrelatedResult.discountPct === 0, 'Un producto que no coincide con la palabra clave ("pija") no recibe el descuento aunque cumpla la cantidad');

if (failures > 0) {
  console.error(`\n${failures} verificación(es) fallaron.`);
  process.exitCode = 1;
} else {
  console.log("\n✅ Todo correcto: el % de descuento acepta decimales en los 4 sitios de captura, nadie volvió a truncar con parseInt, y el decimal sobrevive hasta el precio final que calcula el POS.");
}
