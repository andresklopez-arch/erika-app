// Prueba de regresión del bug del 2026-08-26 (reportado por Ferretería
// Erika vía WhatsApp, "Se duplican los iconos"): el panel de detalle de
// "Consulta de Tickets Anteriores" tenía 2 botones "Reimprimir" para el
// mismo ticket seleccionado. El fix centralizó el botón en
// src/components/ReprintButton.tsx -- este escaneo estático confirma que
// nadie vuelve a poner un <button onClick={... handleReprintHistoryTicket}
// directo en POSModule.tsx (debe pasar siempre por <ReprintButton>), y que
// el botón "featured" (el destacado del panel de detalle) sigue
// apareciendo una sola vez.
//
// Uso: npm run test-reprint-single-button

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

const posPath = path.join(__dirname, "..", "src", "components", "POSModule.tsx");
const src = fs.readFileSync(posPath, "utf8");

const rawOnClickMatches = src.match(/onClick=\{[^}]*handleReprintHistoryTicket/g) || [];
assert(
  rawOnClickMatches.length === 0,
  rawOnClickMatches.length === 0
    ? "Ningún <button onClick> llama a handleReprintHistoryTicket directo -- todos pasan por <ReprintButton>"
    : `Se encontraron ${rawOnClickMatches.length} onClick directo(s) a handleReprintHistoryTicket (deberían usar <ReprintButton>)`,
);

const reprintButtonUsages = (src.match(/<ReprintButton\b/g) || []).length;
// 3 sitios legítimos hoy: búsqueda de Garantía (pill-outline), fila de la
// lista en Consulta de Tickets (row), y el destacado del panel de detalle
// (featured). Si se agrega un sitio nuevo y genuino, actualizar este
// número junto con una nota de por qué -- lo que este test debe atrapar es
// un CUARTO botón para el MISMO ticket en el MISMO panel, no crecimiento
// legítimo de la app.
assert(reprintButtonUsages === 3, `<ReprintButton> se usa en los 3 sitios esperados (encontrados: ${reprintButtonUsages})`);

const featuredUsages = (src.match(/variant="featured"/g) || []).length;
assert(featuredUsages === 1, `El botón destacado (variant="featured") del panel de detalle aparece una sola vez (encontrados: ${featuredUsages})`);

const reprintButtonPath = path.join(__dirname, "..", "src", "components", "ReprintButton.tsx");
assert(fs.existsSync(reprintButtonPath), "src/components/ReprintButton.tsx existe");

if (failures > 0) {
  console.error(`\n${failures} verificación(es) fallaron.`);
  process.exitCode = 1;
} else {
  console.log("\n✅ Todo correcto: el botón de reimprimir no está duplicado en ningún panel.");
}
