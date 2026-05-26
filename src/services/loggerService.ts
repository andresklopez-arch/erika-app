import { supabase } from "../lib/supabaseClient";

export const LoggerService = {
  /**
   * Registra errores silenciosos en la base de datos
   */
  logError: async (module: string, errorDetails: any, user: string = "Admin") => {
    try {
      const { error } = await supabase.from("error_logs").insert({
        module,
        error_details: typeof errorDetails === "string" ? errorDetails : JSON.stringify(errorDetails),
        usuario: user,
      });
      if (error) console.error("Fallo al registrar error en DB:", error);
    } catch (err) {
      console.error("Fallo crítico en logError:", err);
    }
  },
  /**
   * Guarda un registro permanente en la nube de cualquier artículo cancelado en caja
   */
  logCancellation: async (
    itemName: string,
    qty: number,
    user: string = "Admin",
  ) => {
    try {
      const { error } = await supabase.from("mermas_y_cancelaciones").insert({
        articulo: itemName,
        cantidad: qty,
        usuario: user,
        fecha: new Date().toISOString(),
      });

      if (error) throw error;
      console.log("✅ Log de seguridad sincronizado en la nube.");
    } catch (err) {
      console.error("❌ Fallo crítico al sincronizar el log en Supabase:", err);
    }
  },
};
