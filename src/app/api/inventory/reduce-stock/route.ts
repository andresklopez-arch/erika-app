import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";

const VALID_MOVE_TYPES = new Set(["sale", "restock", "adjustment", "layaway", "cancellation"]);

// Ajusta existencias vía el RPC reduce_inventory_stock (resta `qty` del
// stock y registra el movimiento en inventory_movements/Kardex). Antes el
// navegador llamaba este RPC directo con la llave pública — cualquiera
// podía inflar o vaciar el stock de cualquier producto, o fabricar
// movimientos de Kardex con el "user_name" que quisiera. Ahora el nombre
// de quien mueve el inventario se toma fresco de la base de datos a
// partir de la sesión, nunca de lo que mande el cliente.
// Usado por: checkout del POS, devolución, apartados (crear y cancelar),
// venta a crédito, recepción de mercancía y sincronización offline —
// todos ahora comparten este único endpoint mediante
// src/lib/inventoryClient.ts.
export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const { items, refId, moveType } = await request.json();

    if (!VALID_MOVE_TYPES.has(moveType)) {
      return NextResponse.json({ error: "Tipo de movimiento inválido." }, { status: 400 });
    }
    if (!Array.isArray(items)) {
      return NextResponse.json({ error: "Formato de productos inválido." }, { status: 400 });
    }
    const cleanItems = items
      .filter((it: any) => it && typeof it.id === "string" && typeof it.qty === "number" && !isNaN(it.qty) && it.qty !== 0)
      .map((it: any) => ({ id: it.id, qty: it.qty }));
    if (cleanItems.length === 0) {
      return NextResponse.json({ error: "Ningún producto tenía datos válidos para ajustar." }, { status: 400 });
    }

    const { data: requester } = await supabaseAdmin.from("users").select("name").eq("id", userId).single();
    const userName = requester?.name || "Desconocido";

    const { error: rpcErr } = await supabaseAdmin.rpc("reduce_inventory_stock", {
      items: cleanItems,
      ref_id: (refId || `REF-${Date.now()}`).toString(),
      user_name: userName,
      move_type: moveType,
    });

    if (rpcErr) {
      // Mismo respaldo que antes vivía en cada componente del navegador:
      // si el RPC falla, restar el stock directamente producto por
      // producto (sin registrar movimiento de Kardex, igual que el
      // comportamiento original).
      for (const item of cleanItems) {
        const { data: invItem } = await supabaseAdmin.from("inventory").select("stock").eq("id", item.id).single();
        if (invItem) {
          await supabaseAdmin.from("inventory").update({ stock: Number(invItem.stock) - item.qty }).eq("id", item.id);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error en /api/inventory/reduce-stock:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
