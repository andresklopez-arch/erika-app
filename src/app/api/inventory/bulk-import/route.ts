import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUserId } from "@/lib/session";
import { pickAllowedFields } from "@/lib/inventoryFields";

const BATCH_SIZE = 50;
// Un archivo real de catálogo de una ferretería no debería acercarse a
// esto ni de lejos — el límite existe para que un payload manipulado no
// pueda intentar crear/actualizar un número arbitrario de filas de un
// solo golpe.
const MAX_ROWS = 5000;

// Recibe los lotes `inserts`/`updates` ya armados por el importador
// inteligente (SmartImporter) del lado del cliente — esa parte (leer el
// Excel/CSV, detectar duplicados por código/nombre, generar códigos únicos)
// sigue en el navegador porque es solo preparación de datos, no una
// escritura insegura. Lo que se movió aquí es la escritura real en
// `inventory`, que antes se hacía directo con la llave pública.
export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Sesión inválida. Vuelve a iniciar sesión." }, { status: 401 });
    }

    const { inserts, updates, accumulateStock, importedDeltaById } = await request.json();
    if (!Array.isArray(inserts) || !Array.isArray(updates)) {
      return NextResponse.json({ error: "Formato de importación inválido." }, { status: 400 });
    }
    if (inserts.length + updates.length > MAX_ROWS) {
      return NextResponse.json({ error: `Demasiadas filas en un solo lote (máximo ${MAX_ROWS}).` }, { status: 400 });
    }

    const cleanInserts = inserts.map((row: any) => pickAllowedFields(row));

    let newCount = inserts.length;
    let failedInserts = 0;
    for (let batchStart = 0; batchStart < cleanInserts.length; batchStart += BATCH_SIZE) {
      const batch = cleanInserts.slice(batchStart, batchStart + BATCH_SIZE);
      const { error: insertError } = await supabaseAdmin.from("inventory").insert(batch);
      if (insertError) {
        // Intento de recuperación: insertar uno por uno para salvar los que sí pasan.
        for (const item of batch) {
          const { error: singleErr } = await supabaseAdmin.from("inventory").insert([item]);
          if (singleErr) {
            console.warn(`[Import] No se pudo insertar "${item.name}" (${item.code}): ${singleErr.message}`);
            failedInserts++;
            newCount--;
          }
        }
      }
    }

    // Igual que en la fusión de duplicados: si se está acumulando stock
    // sobre lo existente, se relee el stock ACTUAL justo antes de escribir
    // (no la foto que el navegador cargó al abrir el importador) para no
    // "resucitar" ventas ocurridas mientras el usuario revisaba el preview.
    let cleanUpdates = updates.map((row: any) => ({ id: row.id, ...pickAllowedFields(row) }));
    if (accumulateStock && importedDeltaById && Object.keys(importedDeltaById).length > 0) {
      const idsToRefresh = Object.keys(importedDeltaById);
      const { data: freshItems } = await supabaseAdmin.from("inventory").select("id, stock").in("id", idsToRefresh);
      if (freshItems) {
        const freshStockById = new Map<string, number>(freshItems.map((f: any) => [f.id, Number(f.stock) || 0]));
        cleanUpdates = cleanUpdates.map((u: any) => {
          const delta = importedDeltaById[u.id];
          if (delta !== undefined && freshStockById.has(u.id)) {
            return { ...u, stock: (freshStockById.get(u.id) || 0) + delta };
          }
          return u;
        });
      }
    }

    let updateErrorMessage: string | null = null;
    if (cleanUpdates.length > 0) {
      const { error: updateError } = await supabaseAdmin.from("inventory").upsert(cleanUpdates);
      if (updateError) {
        console.error("[Import] Falló el upsert de actualizaciones:", updateError);
        updateErrorMessage = updateError.message;
      }
    }

    return NextResponse.json({
      success: true,
      newCount,
      failedInserts,
      updateErrorMessage,
    });
  } catch (error: any) {
    console.error("Error en /api/inventory/bulk-import:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
