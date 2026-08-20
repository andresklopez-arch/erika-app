import { supabase } from "../lib/supabaseClient";

export const LoggerService = {
  /**
   * Registra errores silenciosos en la base de datos
   */
  logError: async (module: string, errorDetails: any, user: string = "Admin") => {
    try {
      const res = await fetch("/api/logs/error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          module,
          error_details: typeof errorDetails === "string" ? errorDetails : JSON.stringify(errorDetails),
          usuario: user,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        console.error("Fallo al registrar error en DB:", json.error);
      }
    } catch (err) {
      console.error("Fallo crítico en logError:", err);
    }
  },
  /**
   * Guarda un registro permanente en la nube de cualquier artículo cancelado en caja
   */
  // Devuelve true/false para que el llamador sepa si el registro de
  // pérdida/merma realmente se guardó antes de decirle al usuario que se
  // registró. Antes se disparaba sin esperar la respuesta ("fire and forget")
  // y la UI mostraba éxito sin importar si esto fallaba.
  logCancellation: async (
    itemName: string,
    qty: number,
    user: string = "Admin",
  ): Promise<boolean> => {
    try {
      const { error } = await supabase.from("mermas_y_cancelaciones").insert({
        articulo: itemName,
        cantidad: qty,
        usuario: user,
        fecha: new Date().toISOString(),
      });

      if (error) throw error;
      console.log("✅ Log de seguridad sincronizado en la nube.");
      return true;
    } catch (err) {
      console.error("❌ Fallo crítico al sincronizar el log en Supabase:", err);
      return false;
    }
  },
};
