// Cuenta cuántos commits han pasado desde el último tag "checkpoint-*"
// (creado por `npm run checkpoint`, ver scripts/create-checkpoint.js) y
// avisa cuando se acerca o supera 30 -- la regla global #5 del usuario
// (cada 30 modificaciones, pedir autorización para depurar/revisar,
// respaldar y guardar un punto de restauración).
//
// Nace de una falla recurrente confirmada varias veces en distintas
// sesiones/proyectos: nadie llevaba la cuenta real, así que la regla
// simplemente nunca se activaba en sesiones largas. Este script no
// reemplaza el criterio de cuándo pedir autorización (eso lo sigue
// decidiendo quien lea el aviso) -- solo hace que el conteo sea un
// hecho verificable en vez de algo que había que recordar.
//
// No bloquea nada (exit code siempre 0): es un aviso informativo que se
// imprime en pre-push, no un gate de CI.
//
// Uso: node scripts/check-checkpoint-due.js

const { execSync } = require("child_process");

const CHECKPOINT_THRESHOLD = 30;

function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function main() {
  const lastTag = run('git describe --tags --match "checkpoint-*" --abbrev=0');

  let count;
  let sinceLabel;
  if (lastTag) {
    count = Number(run(`git rev-list ${lastTag}..HEAD --count`)) || 0;
    sinceLabel = `desde el último checkpoint (${lastTag})`;
  } else {
    count = Number(run("git rev-list HEAD --count")) || 0;
    sinceLabel = "desde el inicio del repositorio (todavía no hay ningún checkpoint)";
  }

  if (count >= CHECKPOINT_THRESHOLD) {
    console.warn(
      `\n⚠️  ${count} commit(s) ${sinceLabel} -- ya se cumplió (o superó) el umbral de ${CHECKPOINT_THRESHOLD} de la regla global #5.\n` +
        `   Pide autorización para depurar/revisar, respaldar, y correr "npm run checkpoint".\n`,
    );
  } else if (count >= CHECKPOINT_THRESHOLD - 5) {
    console.log(`ℹ️  ${count}/${CHECKPOINT_THRESHOLD} commit(s) ${sinceLabel} -- se acerca el checkpoint de la regla #5.`);
  } else {
    console.log(`ℹ️  ${count}/${CHECKPOINT_THRESHOLD} commit(s) ${sinceLabel}.`);
  }
}

main();
