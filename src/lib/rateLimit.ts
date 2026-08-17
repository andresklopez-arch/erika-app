// Limitador de intentos en memoria para endpoints protegidos por PIN.
// No es a prueba de balas en un entorno serverless multi-instancia (cada instancia
// tiene su propia memoria), pero detiene fuerza bruta trivial de un mismo origen
// mucho mejor que no tener ningún límite.

interface Bucket {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
}

const buckets = new Map<string, Bucket>();

const MAX_FAILURES = 5;
const WINDOW_MS = 5 * 60 * 1000; // ventana en la que se cuentan fallos consecutivos
const LOCK_MS = 10 * 60 * 1000; // tiempo de bloqueo tras exceder el máximo

export function getClientKey(request: Request, scope: string): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : "unknown";
  return `${scope}:${ip}`;
}

export function getLockRemainingMs(key: string): number {
  const bucket = buckets.get(key);
  if (!bucket) return 0;
  const remaining = bucket.lockedUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

export function recordFailedAttempt(key: string): void {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.firstFailureAt > WINDOW_MS) {
    buckets.set(key, { failures: 1, firstFailureAt: now, lockedUntil: 0 });
    return;
  }

  bucket.failures += 1;
  if (bucket.failures >= MAX_FAILURES) {
    bucket.lockedUntil = now + LOCK_MS;
  }
}

export function clearAttempts(key: string): void {
  buckets.delete(key);
}
