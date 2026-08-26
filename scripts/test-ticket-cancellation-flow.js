// Prueba de integración end-to-end (a nivel API, no navegador) del flujo de
// cancelación de un ticket: simula una venta, la cancela y verifica que las
// 3 tablas que ese flujo toca (inventory, cash_transactions, error_logs) sí
// se actualizan de verdad. Este flujo se agregó porque las tres escrituras
// vivían directo en el navegador con la llave pública y quedaron rotas en
// silencio cuando cada tabla se cerró con RLS por separado — el POS seguía
// mostrando "✅ Ticket cancelado" aunque el stock nunca regresara al
// inventario ni el retiro se reflejara en el corte de caja.
//
// SOLO corre contra un servidor LOCAL (http://localhost:3000 por default) —
// mismo motivo que scripts/test-caja-checkout-flow.js: abre y cierra una
// caja real, así que nunca debe apuntar a producción.
//
// Uso: 1) en otra terminal, `npm run dev`  2) `node scripts/test-ticket-cancellation-flow.js`
//
// Por qué NO está en .husky/pre-push (evaluado el 2026-08-26): "local"
// aquí solo significa que el servidor Next.js corre en localhost -- sigue
// usando las MISMAS credenciales de Supabase de producción que el resto
// de .env.local (no hay una base de datos de prueba separada en este
// proyecto). Automatizarlo en cada push abriría/cerraría una caja real
// sin supervisión: si coincidiera con un turno real abierto (el guardado
// más abajo lo detecta y se omite, pero solo si nadie corre el pre-push
// justo cuando el turno abre después) o si el proceso se interrumpe a
// medio correr, podría dejar estado real a medias. Mientras no exista una
// base de datos de prueba aislada para este proyecto, se queda manual.

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
let createdInventoryId = null;
let createdQuoteId = null;
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
  if (createdQuoteId) {
    await admin.from("quotes").delete().eq("id", createdQuoteId);
  }
  if (createdInventoryId) {
    await admin.from("inventory_movements").delete().eq("product_id", createdInventoryId);
    await admin.from("inventory").delete().eq("id", createdInventoryId);
  }
  if (createdSessionId) {
    await admin.from("cash_transactions").delete().eq("session_id", createdSessionId);
    await admin.from("cash_sessions").delete().eq("id", createdSessionId);
  }
  await admin.from("error_logs").delete().eq("module", "Cancelacion_Ticket_TEST");
  console.log("🧹 Listo.");
}

async function main() {
  if (!env.SESSION_SECRET) {
    console.error("❌ Falta SESSION_SECRET en .env.local");
    process.exit(1);
  }

  // Este script usa las mismas credenciales de .env.local que producción
  // (no hay una base de datos local separada) y abre/cierra una caja real
  // vía /api/caja/open|close -- correrlo con un turno real abierto
  // corromperia el corte de ese turno. Esto NO es una falla del código: es
  // una condición externa (alguien está trabajando en la caja ahora mismo),
  // así que se omite con exit 0 en vez de exit 1 -- no debe bloquear un
  // pre-push ni leerse como "algo se rompió".
  const { data: existingOpen } = await admin.from("cash_sessions").select("id").eq("status", "open").maybeSingle();
  if (existingOpen) {
    console.warn("⏭️  Omitido: ya hay una caja abierta en esta base de datos (turno real en curso). Vuelve a correr esta prueba cuando la caja esté cerrada.");
    process.exit(0);
  }

  const { data: adminUser, error: userErr } = await admin.from("users").select("id, name, role").eq("role", "admin").limit(1).single();
  if (userErr || !adminUser) {
    console.error("❌ No se encontró ningún usuario admin en la base de datos para firmar la sesión de prueba.");
    process.exit(1);
  }
  console.log(`Usando usuario de prueba: ${adminUser.name} (${adminUser.id})\n`);

  const cookie = signSessionCookie(adminUser.id);
  const TICKET_ID = Date.now();

  try {
    // 1. Crear producto de prueba con 10 unidades en stock
    const { data: product, error: prodErr } = await admin
      .from("inventory")
      .insert({ name: `[TEST AUTOMATIZADO] Producto Cancelación ${TICKET_ID}`, stock: 10, price: 100, cost: 60 })
      .select("id, stock")
      .single();
    check("Se creó el producto de prueba con stock=10", !prodErr && product?.stock === 10, prodErr?.message);
    createdInventoryId = product?.id || null;
    if (!createdInventoryId) throw new Error("No se pudo crear el producto de prueba, abortando.");

    // 2. Abrir caja
    const open = await apiCall(cookie, "/api/caja/open", { initialBalance: 500 });
    check("POST /api/caja/open responde 200", open.ok, JSON.stringify(open.json));
    createdSessionId = open.json?.session?.id;
    if (!createdSessionId) throw new Error("No se pudo abrir la caja de prueba, abortando.");

    // 3. Simular la venta original: descuenta 3 unidades de stock y registra
    //    la transacción de caja tal como lo hace el checkout real del POS.
    const reduce = await apiCall(cookie, "/api/inventory/reduce-stock", {
      items: [{ id: createdInventoryId, qty: 3 }],
      moveType: "sale",
      refId: `TEST-SALE-${TICKET_ID}`,
    });
    check("POST /api/inventory/reduce-stock (venta) responde 200", reduce.ok, JSON.stringify(reduce.json));

    const sale = await apiCall(cookie, "/api/caja/transaction", {
      type: "sale",
      amount: 300,
      description: `Venta Ticket #${TICKET_ID} [METODO:efectivo] [CASH:300] [CARD:0] [TRANS:0]`,
      cash_amount: 300,
      card_amount: 0,
      transfer_amount: 0,
    });
    check("POST /api/caja/transaction (venta) responde 200", sale.ok, JSON.stringify(sale.json));

    const { data: quote, error: quoteErr } = await admin
      .from("quotes")
      .insert({ id: TICKET_ID, customer_name: "Venta Mostrador", items: [{ name: "Producto Cancelación", price: 100, qty: 3 }], total: 300, status: "ticket", notes: "Pago: EFECTIVO" })
      .select("id")
      .single();
    check("Se creó el ticket de prueba en quotes", !quoteErr && !!quote, quoteErr?.message);
    createdQuoteId = quote?.id || null;

    const { data: afterSaleStock } = await admin.from("inventory").select("stock").eq("id", createdInventoryId).single();
    check("El stock bajó a 7 tras la venta simulada", afterSaleStock?.stock === 7, `stock: ${afterSaleStock?.stock}`);

    // 4. Cancelar: guardar status='cancelled' en quotes -- mismo endpoint
    //    (/api/quotes/save) y ORDEN que usa handleExecuteCancelTicket() en
    //    POSModule.tsx (el guardado va PRIMERO, antes de tocar
    //    inventario/caja). Este paso faltaba en la prueba: verificaba
    //    inventario y caja pero nunca el guardado real del status, que es
    //    justo lo que estuvo roto en producción desde siempre (restricción
    //    quotes_status_check sin 'cancelled', ver
    //    supabase/migrations/20260828010000_allow_cancelled_quote_status.sql).
    const cancelSave = await apiCall(cookie, "/api/quotes/save", {
      id: TICKET_ID,
      fields: { status: "cancelled", notes: "CANCELADO (prueba automatizada)" },
    });
    check("POST /api/quotes/save (status='cancelled') responde 200", cancelSave.ok, JSON.stringify(cancelSave.json));

    const { data: afterCancelQuote } = await admin.from("quotes").select("status").eq("id", TICKET_ID).single();
    check("El ticket de prueba quedó con status='cancelled' en la base", afterCancelQuote?.status === "cancelled", `status: ${afterCancelQuote?.status}`);

    // 5. Cancelar: reincorporar stock (mismo endpoint/moveType que usa
    //    POSModule.tsx en handleExecuteCancelTicket)
    const cancelStock = await apiCall(cookie, "/api/inventory/reduce-stock", {
      items: [{ id: createdInventoryId, qty: -3 }],
      moveType: "cancellation",
      refId: `TICKET-CANCEL-${TICKET_ID}`,
    });
    check("POST /api/inventory/reduce-stock (cancelación) responde 200", cancelStock.ok, JSON.stringify(cancelStock.json));

    const { data: afterCancelStock } = await admin.from("inventory").select("stock").eq("id", createdInventoryId).single();
    check("El stock regresó a 10 tras cancelar el ticket", afterCancelStock?.stock === 10, `stock: ${afterCancelStock?.stock}`);

    // 6. Cancelar: registrar el retiro de caja que compensa el efectivo de
    //    la venta anulada (mismo endpoint que usa insertCashTransaction)
    const withdrawal = await apiCall(cookie, "/api/caja/transaction", {
      type: "withdrawal",
      amount: 300,
      description: `🚫 Cancelación de Ticket #${TICKET_ID} (Venta Mostrador)`,
    });
    check("POST /api/caja/transaction (retiro por cancelación) responde 200", withdrawal.ok, JSON.stringify(withdrawal.json));

    // 7. Cancelar: registrar la auditoría (mismo endpoint que usa
    //    LoggerService.logError)
    const auditLog = await apiCall(cookie, "/api/logs/error", {
      module: "Cancelacion_Ticket_TEST",
      error_details: `Ticket #${TICKET_ID} cancelado por $300.00 (prueba automatizada).`,
      usuario: adminUser.name,
    });
    check("POST /api/logs/error (auditoría de cancelación) responde 200", auditLog.ok, JSON.stringify(auditLog.json));

    const { data: logRow } = await admin.from("error_logs").select("id").eq("module", "Cancelacion_Ticket_TEST").limit(1).maybeSingle();
    check("La fila de auditoría de cancelación quedó guardada en error_logs", !!logRow);

    // 8. Cerrar caja: la venta (300 efectivo) y el retiro (300) deben
    //    cancelarse entre sí, dejando el esperado igual al fondo inicial.
    const { data: cred } = await admin.from("user_credentials").select("pin").eq("user_id", adminUser.id).maybeSingle();
    if (!cred?.pin) {
      console.warn("⚠️ El usuario admin de prueba no tiene PIN en user_credentials — se omite el cierre de caja.");
    } else {
      const close = await apiCall(cookie, "/api/caja/close", { sessionId: createdSessionId, countedTotal: 500, adminPin: cred.pin });
      check("POST /api/caja/close responde 200", close.ok, JSON.stringify(close.json));
      check("El corte quedó en 500 (venta y retiro por cancelación se cancelaron entre sí)", close.json?.ticket?.esperado === 500, `esperado: ${close.json?.ticket?.esperado}`);
      check("El corte calculó descuadre = 0", close.json?.ticket?.descuadre === 0, `descuadre: ${close.json?.ticket?.descuadre}`);
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
