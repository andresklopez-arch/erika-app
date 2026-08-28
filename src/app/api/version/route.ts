import { NextResponse } from "next/server";

// Vercel inyecta estas variables automáticamente en cada build/deploy
// (System Environment Variables) -- no requieren configurarlas a mano ni
// activar ningún ajuste especial del proyecto, a diferencia de sus
// equivalentes NEXT_PUBLIC_ (esas sí necesitan el toggle "Automatically
// expose System Environment Variables"). Al leerlas aquí, del lado del
// servidor, y exponerlas por esta única ruta, la UI puede mostrar qué
// commit está realmente desplegado sin depender de ese toggle.
//
// Nace del incidente del 2026-08-27: un fix ya corregido en el código
// llevaba un día entero sin desplegarse y nadie lo notó hasta que el
// mismo bug se volvió a reportar. Con esto, "¿ya se actualizó?" se
// responde mirando el Sidebar en vez de reproducir el bug de nuevo.
export async function GET() {
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA || null;
  return NextResponse.json({
    commitSha,
    commitShaShort: commitSha ? commitSha.slice(0, 7) : null,
    commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE || null,
    branch: process.env.VERCEL_GIT_COMMIT_REF || null,
  });
}
