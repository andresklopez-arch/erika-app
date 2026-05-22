// Archivo de Arquitectura: Cliente de Supabase
// NOTA: Se dejan las llaves de entorno vacías preparadas para el pase a Producción.

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://tu-proyecto.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "tu-clave-anonima";

// Simulador de cliente para desarrollo local (Evita crasheos antes de conectar la BD)
export const supabase = {
  from: (table: string) => ({
    insert: async (data: any) => {
      console.log(`☁️ [Supabase Mock] Insertando en tabla '${table}':`, data);
      // Simula latencia de red
      return new Promise((resolve) =>
        setTimeout(() => resolve({ data, error: null }), 500),
      );
    },
  }),
};
