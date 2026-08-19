import { createClient } from "@supabase/supabase-js";

// Cliente de Supabase con la Service Role Key: ignora Row Level Security
// por completo. SOLO debe importarse desde código que corre en el
// servidor (rutas de src/app/api/**) — nunca desde un componente
// "use client". La key vive en SUPABASE_SERVICE_ROLE_KEY (sin el prefijo
// NEXT_PUBLIC_), así que Next.js nunca la incluye en el bundle del
// navegador.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
