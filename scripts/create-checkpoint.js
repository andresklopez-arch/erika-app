// Crea y sube un tag de git con la fecha de hoy como punto de
// restauración — automatiza el ritual de la regla "cada 30 modificaciones"
// (ver CLAUDE.md del usuario) sin tener que acordarse del comando exacto.
// No borra ni modifica nada existente: solo agrega un tag nuevo sobre el
// commit actual (HEAD) y lo empuja a GitHub.
//
// Uso: npm run checkpoint  [-- "mensaje opcional"]

const { execSync } = require("child_process");

function run(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function todayStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function main() {
  const customMessage = process.argv.slice(2).join(" ").trim();

  const status = run("git status --porcelain");
  if (status) {
    console.error("❌ Hay cambios sin confirmar (git status no está limpio). Confirma o descarta tus cambios antes de crear un checkpoint.");
    console.error(status);
    process.exit(1);
  }

  const baseName = `checkpoint-${todayStamp()}`;
  const existingTags = run(`git tag --list "${baseName}*"`).split("\n").filter(Boolean);
  const tagName = existingTags.length === 0 ? baseName : `${baseName}-${existingTags.length + 1}`;

  const commitHash = run("git rev-parse --short HEAD");
  const commitSubject = run("git log -1 --pretty=%s");
  const message = customMessage || `Punto de restauracion automatico sobre ${commitHash}: ${commitSubject}`;

  run(`git tag -a "${tagName}" -m "${message.replace(/"/g, '\\"')}"`);
  console.log(`✅ Tag creado: ${tagName} (sobre ${commitHash})`);

  run(`git push origin "${tagName}"`);
  console.log(`✅ Subido a GitHub: ${tagName}`);
  console.log(`\nPara volver a este punto en el futuro: git checkout ${tagName}`);
}

main();
