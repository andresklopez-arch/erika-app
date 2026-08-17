// Este archivo existía como un cliente simulado (mock) independiente del real
// en src/lib/supabaseClient.ts, con una forma incompatible (solo soportaba
// .insert()). Cualquier import accidental desde aquí en vez de "@/lib/supabaseClient"
// causaba errores en tiempo de ejecución o escrituras que solo se registraban
// en consola sin tocar la base de datos real. Se reexporta el cliente real para
// que cualquier import existente siga funcionando correctamente.
export { supabase } from "../lib/supabaseClient";
