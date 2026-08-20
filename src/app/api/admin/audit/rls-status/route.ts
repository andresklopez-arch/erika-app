import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyAdminPin } from "@/lib/verifyAdminPin";
import { getClientKey, getLockRemainingMs, recordFailedAttempt, clearAttempts } from "@/lib/rateLimit";

// Muestra en el panel de administración qué tablas tienen políticas RLS
// abiertas ("USING true" sin restricción), en vez de que alguien tenga que
// acordarse de correr `npm run check-rls` a mano desde su computadora.
// Requiere PIN de administrador porque expone el nombre real de las
// políticas de la base de datos.
export async function POST(request: Request) {
  try {
    const { adminPin } = await request.json();

    const rateLimitKey = getClientKey(request, "admin-rls-audit");
    const lockRemainingMs = getLockRemainingMs(rateLimitKey);
    if (lockRemainingMs > 0) {
      return NextResponse.json(
        { error: `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(lockRemainingMs / 60000)} minuto(s).` },
        { status: 429 },
      );
    }
    if (!adminPin || !(await verifyAdminPin(adminPin))) {
      recordFailedAttempt(rateLimitKey);
      return NextResponse.json({ error: "Acceso Denegado. Solo administradores pueden ver esta auditoría." }, { status: 403 });
    }
    clearAttempts(rateLimitKey);

    const { data: policies, error } = await supabaseAdmin.rpc("admin_list_rls_policies");
    if (error) {
      return NextResponse.json({ error: "Error al consultar políticas: " + error.message }, { status: 500 });
    }

    // Una tabla se marca "abierta" si alguna de sus políticas permite
    // INSERT/UPDATE/DELETE/ALL sin ninguna condición real (qual/with_check
    // en NULL o literalmente "true"), para cualquier rol.
    const writeCommands = new Set(["ALL", "INSERT", "UPDATE", "DELETE"]);
    const isUnconditional = (expr: string | null) => expr === null || expr.trim() === "true";

    const byTable = new Map<string, any[]>();
    for (const p of policies || []) {
      if (!byTable.has(p.table_name)) byTable.set(p.table_name, []);
      byTable.get(p.table_name)!.push(p);
    }

    const tables = Array.from(byTable.entries()).map(([table, pols]) => {
      const openWritePolicy = pols.find((p) => writeCommands.has(p.cmd) && (isUnconditional(p.qual) || isUnconditional(p.with_check)));
      return {
        table,
        policies: pols,
        openToWrite: !!openWritePolicy,
      };
    });

    tables.sort((a, b) => (b.openToWrite ? 1 : 0) - (a.openToWrite ? 1 : 0));

    // Un RPC puede seguir abierto a anon/authenticated aunque su tabla ya
    // esté cerrada (pasó hoy con reduce_inventory_stock) — se muestra por
    // separado de las tablas. Si la función admin_list_function_grants
    // todavía no existe en esta base (migración no aplicada), se omite esta
    // sección sin tumbar el resto de la auditoría.
    let functions: { name: string; signature: string; grantees: string[] }[] = [];
    const { data: grants, error: grantsError } = await supabaseAdmin.rpc("admin_list_function_grants");
    if (!grantsError && grants) {
      const byFunction = new Map<string, { signature: string; grantees: string[] }>();
      for (const g of grants) {
        if (!byFunction.has(g.routine_name)) byFunction.set(g.routine_name, { signature: g.signature, grantees: [] });
        byFunction.get(g.routine_name)!.grantees.push(g.grantee);
      }
      functions = Array.from(byFunction.entries()).map(([name, v]) => ({ name, signature: v.signature, grantees: v.grantees }));
    }

    return NextResponse.json({ success: true, tables, functions });
  } catch (error: any) {
    console.error("Error en /api/admin/audit/rls-status:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
