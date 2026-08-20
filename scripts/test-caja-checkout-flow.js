// Prueba de integración end-to-end (a nivel API, no navegador) del flujo
// de caja que se movió a rutas de servidor hoy: abrir caja -> registrar una
// venta -> cerrar caja -> verificar el corte. Firma su propia cookie de
// sesión (mismo algoritmo que src/lib/session.ts) para no depender de
// tener un PIN de usuario real a la mano.
//
// SOLO corre contra un servidor LOCAL (http://localhost:3000 por default).
// Nunca apunta a producción: este flujo abre y cierra una caja real, y ya
// hubo un incidente en esta misma sesión donde una prueba dejó una fila de
// prueba en cash_sessions — correrlo contra producción podría bloquear el
// registro real de un cajero si el script se interrumpe a medias.
//
// Uso: 1) en otra terminal, `npm run dev`  2) `node scripts/test-caja-checkout-flow.js`

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
if (/vercel\.app|erika-app(?!\.local)/i.test(BASE_URL) && !BASE_URL.includes("localhost")) {
  console.error(`❌ TEST_BASE_URL ("${BASE_URL}") no parece ser localhost. Este script NUNCA debe correr contra producción. Abortando.`);
  process.exit(1);
}

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

const env = loadEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function signSessionCookie(userId) {
  const sign = (data) => crypto.createHmac("sha256", env.SESSION_SECRET).update(data).digest("base64url");
  const encoded = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 60 * 60 * 1000 })).toString("base64url");
  return `erika_session=${encoded}.${sign(encoded)}`;
}

async function apiCall(cookie, urlPath, body) {
  const res = await fetch(BASE_URL + urlPath, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

let createdSessionId = null;
let createdCustomerId = null;
let testsPassed = 0;
let testsFailed = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`✅ ${label}`);
    testsPassed++;
  } else {
    console.error(`❌ ${label}${detail ? " — " + detail : ""}`);
    testsFailed++;
  }
}

async function cleanup() {
  console.log("\n🧹 Limpiando datos de prueba...");
  if (createdCustomerId) {
    await admin.from("credit_transactions").delete().eq("customer_id", createdCustomerId);
    await admin.from("customers").delete().eq("id", createdCustomerId);
  }
  if (createdSessionId) {
    await admin.from("cash_transactions").delete().eq("session_id", createdSessionId);
    await admin.from("cash_sessions").delete().eq("id", createdSessionId);
  }
  console.log("🧹 Listo.");
}

async function main() {
  if (!env.SESSION_SECRET) {
    console.error("❌ Falta SESSION_SECRET en .env.local");
    process.exit(1);
  }

  // No correr si ya hay una caja abierta de verdad — no queremos
  // interferir con un turno real ni confundir el corte de nadie.
  const { data: existingOpen } = await admin.from("cash_sessions").select("id").eq("status", "open").maybeSingle();
  if (existingOpen) {
    console.error("❌ Ya hay una caja abierta en esta base de datos. Aborta la prueba para no interferir con un turno real.");
    process.exit(1);
  }

  const { data: adminUser, error: userErr } = await admin.from("users").select("id, name, role").eq("role", "admin").limit(1).single();
  if (userErr || !adminUser) {
    console.error("❌ No se encontró ningún usuario admin en la base de datos para firmar la sesión de prueba.");
    process.exit(1);
  }
  console.log(`Usando usuario de prueba: ${adminUser.name} (${adminUser.id})\n`);

  const cookie = signSessionCookie(adminUser.id);

  try {
    // 1. Abrir caja
    const open = await apiCall(cookie, "/api/caja/open", { initialBalance: 500 });
    check("POST /api/caja/open responde 200", open.ok, JSON.stringify(open.json));
    check("La sesión abierta tiene status 'open'", open.json?.session?.status === "open");
    createdSessionId = open.json?.session?.id;

    if (!createdSessionId) throw new Error("No se pudo abrir la caja de prueba, abortando el resto del flujo.");

    // 2. Registrar una venta
    const sale = await apiCall(cookie, "/api/caja/transaction", {
      type: "sale",
      amount: 150,
      description: "[TEST AUTOMATIZADO] Venta de prueba",
      payment_method: "efectivo",
      cash_amount: 150,
      card_amount: 0,
      transfer_amount: 0,
    });
    check("POST /api/caja/transaction (venta) responde 200", sale.ok, JSON.stringify(sale.json));
    check("La venta quedó ligada a la sesión abierta", sale.json?.transaction?.session_id === createdSessionId);

    // 3. Registrar un ingreso
    const deposit = await apiCall(cookie, "/api/caja/transaction", {
      type: "deposit",
      amount: 50,
      description: "[TEST AUTOMATIZADO] Ingreso de prueba",
    });
    check("POST /api/caja/transaction (ingreso) responde 200", deposit.ok, JSON.stringify(deposit.json));

    // 4. Flujo de crédito: crear cliente de prueba, cargarle una venta a
    //    crédito y luego abonarle, verificando que el saldo se actualice
    //    igual que lo haría un cajero real desde PosCreditModal/CustomersModule.
    const { data: testCustomer, error: customerErr } = await admin
      .from("customers")
      .insert({ name: "[TEST AUTOMATIZADO] Cliente de prueba", credit_limit: 1000, balance: 0 })
      .select("id, balance")
      .single();
    check("Se creó el cliente de prueba para crédito", !customerErr && !!testCustomer, customerErr?.message);
    createdCustomerId = testCustomer?.id || null;

    if (createdCustomerId) {
      const charge = await apiCall(cookie, "/api/credit/charge", { customerId: createdCustomerId, amount: 200, ticketId: "TEST" });
      check("POST /api/credit/charge responde 200", charge.ok, JSON.stringify(charge.json));
      check("El cargo a crédito subió el saldo a 200", charge.json?.newBalance === 200, `newBalance: ${charge.json?.newBalance}`);

      const payment = await apiCall(cookie, "/api/credit/payment", { customerId: createdCustomerId, amount: 80, notes: "[TEST AUTOMATIZADO] Abono de prueba" });
      check("POST /api/credit/payment responde 200", payment.ok, JSON.stringify(payment.json));
      check("El abono bajó el saldo a 120", payment.json?.newBalance === 120, `newBalance: ${payment.json?.newBalance}`);
    }

    // 5. Cerrar caja con el PIN del admin de prueba (buscar su PIN real)
    const { data: cred } = await admin.from("user_credentials").select("pin").eq("user_id", adminUser.id).maybeSingle();
    if (!cred?.pin) {
      console.warn("⚠️ El usuario admin de prueba no tiene PIN en user_credentials — se omite el cierre de caja.");
    } else {
      // Fondo inicial (500) + venta efectivo (150) + ingreso (50) = 700 esperado
      const close = await apiCall(cookie, "/api/caja/close", { sessionId: createdSessionId, countedTotal: 700, adminPin: cred.pin });
      check("POST /api/caja/close responde 200", close.ok, JSON.stringify(close.json));
      check("El corte calculó descuadre = 0 (700 esperado = 700 contado)", close.json?.ticket?.descuadre === 0, `descuadre: ${close.json?.ticket?.descuadre}`);
      check("El corte calculó ventas en efectivo = 150", close.json?.ticket?.ventasEfectivo === 150);
    }
  } finally {
    await cleanup();
  }

  console.log(`\n${testsPassed} prueba(s) pasaron, ${testsFailed} fallaron.`);
  if (testsFailed > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error("❌ Error inesperado:", e);
  await cleanup();
  process.exit(1);
});
