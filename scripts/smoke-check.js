// Verificación rápida y NO destructiva de que erika-app sigue funcionando
// después de un deploy. No crea ventas, cotizaciones, ni movimientos de
// caja reales — solo prueba respuestas de endpoints con datos inválidos a
// propósito, para confirmar que rechazan correctamente sin tronar.
//
// Uso:
//   node scripts/smoke-check.js [baseUrl]
// Por defecto usa https://erika-app.vercel.app

const baseUrl = process.argv[2] || "https://erika-app.vercel.app";

const checks = [
  {
    name: "Home responde",
    run: async () => {
      const res = await fetch(baseUrl);
      if (!res.ok) throw new Error(`status ${res.status}`);
    },
  },
  {
    name: "Login rechaza PIN inválido",
    run: async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: "0000-not-a-real-pin" }),
      });
      const json = await res.json();
      if (res.status !== 401 || json.error !== "PIN Incorrecto") {
        throw new Error(`respuesta inesperada: ${res.status} ${JSON.stringify(json)}`);
      }
    },
  },
  {
    name: "verify-pin rechaza PIN inválido",
    run: async () => {
      const res = await fetch(`${baseUrl}/api/auth/verify-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: "0000-not-a-real-pin" }),
      });
      const json = await res.json();
      if (res.status !== 401 || json.valid !== false) {
        throw new Error(`respuesta inesperada: ${res.status} ${JSON.stringify(json)}`);
      }
    },
  },
  {
    name: "/api/auth/session sin cookie devuelve no autenticado",
    run: async () => {
      const res = await fetch(`${baseUrl}/api/auth/session`);
      const json = await res.json();
      if (res.status !== 401 || json.user !== null) {
        throw new Error(`respuesta inesperada: ${res.status} ${JSON.stringify(json)}`);
      }
    },
  },
  {
    name: "admin/users sin adminPin es rechazado",
    run: async () => {
      const res = await fetch(`${baseUrl}/api/admin/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: { name: "smoke-test", pin: "0000", role: "cajero" } }),
      });
      if (res.status !== 401) throw new Error(`status ${res.status}, se esperaba 401`);
    },
  },
  {
    name: "webhook de Facturama rechaza secreto inválido",
    run: async () => {
      const res = await fetch(`${baseUrl}/api/webhooks/facturama?secret=invalido`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.status !== 401) throw new Error(`status ${res.status}, se esperaba 401`);
    },
  },
  // Estos 3 responden con datos inválidos/sin sesión a propósito -- no
  // guardan ninguna cotización, abono ni movimiento de caja real. Existen
  // para detectar un deploy roto en las 3 rutas del incidente del
  // 2026-08-27 (cancelación de ticket sin desplegar) antes de que un
  // cajero lo reporte por WhatsApp: si cualquiera de las 3 deja de exigir
  // sesión (ej. una ruta nueva que se les olvidó proteger, o un deploy que
  // no levantó bien las variables de entorno), esto lo marca en rojo.
  {
    name: "quotes/save rechaza sin sesión",
    run: async () => {
      const res = await fetch(`${baseUrl}/api/quotes/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { customer_name: "smoke-test", total: 1 } }),
      });
      if (res.status !== 401) throw new Error(`status ${res.status}, se esperaba 401`);
    },
  },
  {
    name: "credit/payment rechaza sin sesión",
    run: async () => {
      const res = await fetch(`${baseUrl}/api/credit/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: "00000000-0000-0000-0000-000000000000", amount: 1 }),
      });
      if (res.status !== 401) throw new Error(`status ${res.status}, se esperaba 401`);
    },
  },
  {
    name: "caja/transaction rechaza sin sesión",
    run: async () => {
      const res = await fetch(`${baseUrl}/api/caja/transaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "deposit", amount: 1, description: "smoke-test" }),
      });
      if (res.status !== 401) throw new Error(`status ${res.status}, se esperaba 401`);
    },
  },
];

(async () => {
  let failed = 0;
  for (const check of checks) {
    try {
      await check.run();
      console.log(`OK   ${check.name}`);
    } catch (e) {
      failed++;
      console.error(`FAIL ${check.name}: ${e.message}`);
    }
  }
  console.log(`\n${checks.length - failed}/${checks.length} checks pasaron.`);
  process.exit(failed > 0 ? 1 : 0);
})();
