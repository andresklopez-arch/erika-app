// Crea y sube un tag de git con la fecha de hoy como punto de
// restauración — automatiza el ritual de la regla "cada 30 modificaciones"
// (ver CLAUDE.md del usuario) sin tener que acordarse del comando exacto.
// No borra ni modifica nada existente: solo agrega un tag nuevo sobre el
// commit actual (HEAD) y lo empuja a GitHub.
//
// Uso: npm run checkpoint  [-- "mensaje opcional"]

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { createClient } = require("@supabase/supabase-js");

const CHECKPOINT_RETENTION_DAYS = 90;

function run(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function todayStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const env = {};
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

// Prioriza la identidad de git (más confiable, es quien firma los commits)
// sobre el nombre de usuario de Windows/macOS, que puede ser genérico
// ("Usuario", "admin") y no dice nada de quién corrió el checkpoint.
function getRunnerName() {
  try {
    const gitName = run("git config user.name");
    if (gitName) return gitName;
  } catch {
    // sin identidad de git configurada — cae al nombre del sistema
  }
  try {
    return os.userInfo().username;
  } catch {
    return "Desconocido";
  }
}

// Registra el checkpoint en la tabla deploy_checkpoints para que el panel
// de Configuración lo muestre sin tener que abrir una terminal. No es
// crítico: si falla (llave no configurada, tabla no creada todavía), el
// tag de git ya quedó creado y subido de todos modos, así que solo se
// avisa por consola en vez de abortar todo el checkpoint.
async function recordInSupabase(tagName, commitHash, message) {
  const env = loadEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.warn("⚠️ No se encontró SUPABASE_SERVICE_ROLE_KEY en .env.local — el checkpoint no quedó registrado en el panel de Configuración (el tag de git sí se creó bien).");
    return;
  }
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await admin.from("deploy_checkpoints").insert({ tag_name: tagName, commit_hash: commitHash, message, created_by: getRunnerName() });
  if (error) {
    console.warn(`⚠️ El tag se creó bien, pero no se pudo registrar en el panel de Configuración: ${error.message}`);
    return;
  }
  console.log("✅ Registrado en el panel de Configuración → Auditoría de Seguridad.");

  // Purga checkpoints viejos para que la tabla no crezca sin límite si
  // esto se vuelve un hábito frecuente — el tag de git en sí nunca se
  // borra, solo su registro informativo en este panel.
  const cutoff = new Date(Date.now() - CHECKPOINT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error: purgeError, count } = await admin
    .from("deploy_checkpoints")
    .delete({ count: "exact" })
    .lt("created_at", cutoff);
  if (!purgeError && count) {
    console.log(`🧹 Se purgaron ${count} checkpoint(s) de hace más de ${CHECKPOINT_RETENTION_DAYS} días del panel.`);
  }
}

async function main() {
  const customMessage = process.argv.slice(2).join(" ").trim();

  const status = run("git status --porcelain");
  if (status) {
    console.error("❌ Hay cambios sin confirmar (git status no está limpio). Confirma o descarta tus cambios antes de crear un checkpoint.");
    console.error(status);
    process.exit(1);
  }

  const remotes = run("git remote").split("\n").filter(Boolean);
  if (!remotes.includes("origin")) {
    console.error('❌ No existe un remoto "origin" en este repositorio, así que no hay dónde respaldar el tag. Configúralo primero con "git remote add origin <url>".');
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

  await recordInSupabase(tagName, commitHash, message);

  console.log(`\nPara volver a este punto en el futuro: git checkout ${tagName}`);
}

main().catch((e) => {
  console.error("❌ Error inesperado:", e.message);
  process.exit(1);
});
