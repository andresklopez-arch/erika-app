// Auditoría (informativa, no bloqueante) del patrón que causó al menos 5
// bugs reales en esta sesión (2026-08-26): `const { error } = await ...`
// donde `error` se destructura pero nunca se revisa después -- la
// operación falla en silencio y el código de todos modos sigue como si
// hubiera funcionado (cancelación de tickets, inventario en checkout/
// devolución/apartado, retiro de caja al cancelar).
//
// Es un heurístico, no un chequeo exacto: busca `const { error[: alias] }
// = await ...` y confirma si el nombre destructurado se vuelve a
// mencionar en las siguientes ~8 líneas. Puede haber falsos positivos
// (el manejo puede estar más abajo de esa ventana, o ser un error
// deliberadamente ignorado con justificación). Por eso este script NO
// forma parte de .husky/pre-push -- es para revisar manualmente de vez en
// cuando, no para bloquear cada push.
//
// Uso: npm run audit-unchecked-errors

const fs = require("fs");
const path = require("path");

const ROOTS = ["src/components", "src/app/api", "src/lib"];
const LOOKAHEAD_AFTER_STATEMENT = 8;
const MAX_STATEMENT_LINES = 40; // llamadas más largas que esto no se rastrean (evita falsos positivos raros)
const DESTRUCTURE_RE = /const\s*\{\s*(?:[\w]+\s*,\s*)*error\s*(?::\s*(\w+))?\s*(?:,\s*[\w]+\s*)*\}\s*=\s*await\b/;

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

// Encuentra la línea donde termina la sentencia que empieza en `startIdx`,
// contando paréntesis/llaves/corchetes (ignora los que aparecen dentro de
// strings/comentarios de línea, de forma aproximada). Devuelve el índice
// de la línea donde el balance vuelve a 0, o null si no se encontró
// dentro de MAX_STATEMENT_LINES (llamadas gigantes se omiten en vez de
// arriesgar un falso positivo).
function findStatementEnd(lines, startIdx) {
  let depth = 0;
  let started = false;
  for (let i = startIdx; i < Math.min(lines.length, startIdx + MAX_STATEMENT_LINES); i++) {
    const codeOnly = lines[i].split("//")[0];
    for (const ch of codeOnly) {
      if ("([{".includes(ch)) { depth++; started = true; }
      else if (")]}".includes(ch)) depth--;
    }
    if (started && depth <= 0) return i;
  }
  return null;
}

let totalFindings = 0;
const findingsByFile = {};

for (const root of ROOTS) {
  const rootPath = path.join(__dirname, "..", root);
  if (!fs.existsSync(rootPath)) continue;
  for (const file of walk(rootPath)) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const relPath = path.relative(path.join(__dirname, ".."), file);
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(DESTRUCTURE_RE);
      if (!match) continue;
      const varName = match[1] || "error";
      const statementEnd = findStatementEnd(lines, i);
      if (statementEnd === null) continue; // sentencia demasiado larga, se omite
      const windowLines = lines.slice(statementEnd + 1, statementEnd + 1 + LOOKAHEAD_AFTER_STATEMENT).join("\n");
      const usedRe = new RegExp(`\\b${varName}\\b`);
      if (!usedRe.test(windowLines)) {
        (findingsByFile[relPath] ||= []).push({ line: i + 1, code: lines[i].trim() });
        totalFindings++;
      }
    }
  }
}

if (totalFindings === 0) {
  console.log("✅ No se encontraron destructuraciones de `error` sin revisar en las siguientes 8 líneas.");
} else {
  console.log(`⚠️  ${totalFindings} posible(s) error(es) destructurado(s) sin revisar (heurístico -- revisar manualmente, puede haber falsos positivos):\n`);
  for (const [file, findings] of Object.entries(findingsByFile)) {
    console.log(`${file}:`);
    for (const f of findings) {
      console.log(`  línea ${f.line}: ${f.code}`);
    }
    console.log("");
  }
}
