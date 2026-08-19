import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

// Sesión firmada por el servidor (cookie httpOnly) para reemplazar la
// confianza ciega en el objeto `ERIKA_USER` de localStorage, que cualquiera
// puede forjar desde la consola del navegador (localStorage.setItem con
// role:"admin" y permisos completos) sin pasar por ningún PIN. La cookie
// solo guarda el userId; el rol/permisos siempre se leen frescos de la base
// de datos en /api/auth/session, así que además un cambio de permisos hecho
// por un admin surte efecto de inmediato, no hasta el siguiente login.

const COOKIE_NAME = "erika_session";
const SESSION_MS = 12 * 60 * 60 * 1000; // 12h, cubre un turno largo de caja

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET no está configurado.");
  return secret;
}

function sign(data: string): string {
  return createHmac("sha256", getSecret()).update(data).digest("base64url");
}

function createSessionToken(userId: string): string {
  const encoded = Buffer.from(JSON.stringify({ userId, exp: Date.now() + SESSION_MS })).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

function verifySessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expectedBuf = Buffer.from(sign(encoded));
  const providedBuf = Buffer.from(signature);
  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString());
    if (typeof payload.userId !== "string" || typeof payload.exp !== "number") return null;
    if (Date.now() > payload.exp) return null;
    return payload.userId;
  } catch {
    return null;
  }
}

export async function setSessionCookie(userId: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, createSessionToken(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MS / 1000,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(COOKIE_NAME)?.value);
}
