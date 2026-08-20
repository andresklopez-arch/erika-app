import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";

// Crea o actualiza un cliente (perfil, no saldo). Antes el INSERT/UPDATE se
// hacía directo desde el navegador con la llave pública — cualquiera podía
// crear clientes falsos o, más grave, subirle el límite de crédito a
// cualquier cliente real desde la consola, sin pasar por ningún control.
//
// Solo se aceptan estos campos (whitelist): balance/points/deleted NO se
// pueden tocar desde aquí — esos tienen sus propios endpoints
// (/api/credit/*, /api/customers/points, /api/customers/delete) con su
// propia lógica de saldo atómico / autorización.
const ALLOWED_FIELDS = ["name", "phone", "rfc", "email", "company_name", "credit_limit"] as const;

export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const body = await request.json();
    const { id } = body;
    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "El nombre del cliente es obligatorio." }, { status: 400 });
    }

    const fields: Record<string, any> = {};
    for (const key of ALLOWED_FIELDS) {
      if (body[key] !== undefined) fields[key] = body[key];
    }
    // "points" solo se puede fijar al CREAR (siempre en 0, para el alta
    // rápida de cliente desde el POS) — nunca al editar, para que nadie
    // pueda inflar puntos de lealtad vía este endpoint saltándose
    // /api/customers/points.
    if (!id) fields.points = 0;

    if (id) {
      const { data: customer, error } = await supabaseAdmin.from("customers").update(fields).eq("id", id).select("*").single();
      if (error) return NextResponse.json({ error: "Error al actualizar: " + error.message }, { status: 500 });
      return NextResponse.json({ success: true, customer });
    }

    const { data: customer, error } = await supabaseAdmin.from("customers").insert(fields).select("*").single();
    if (error) return NextResponse.json({ error: "Error al insertar: " + error.message }, { status: 500 });
    return NextResponse.json({ success: true, customer });
  } catch (error: any) {
    console.error("Error en /api/customers/save:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
