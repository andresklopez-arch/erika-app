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
