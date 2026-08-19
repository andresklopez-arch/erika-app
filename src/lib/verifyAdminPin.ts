import { supabaseAdmin } from "./supabaseAdmin";

// Verifica que un PIN pertenezca a un usuario con role === "admin",
// usando la Service Role Key (ignora RLS) contra user_credentials.
// Compartida por todas las rutas /api/admin/** que antes hacían esta
// misma comparación desde el cliente con la llave pública.
export async function verifyAdminPin(pin: string): Promise<boolean> {
  const user = await findUserByPin(pin);
  return user?.role === "admin";
}

// Igual que verifyAdminPin, pero acepta cualquier rol de personal (no
// solo admin) — para flujos donde cualquier cajero/empleado autenticado
// puede autorizar la acción.
export async function verifyStaffPin(pin: string): Promise<boolean> {
  const user = await findUserByPin(pin);
  return !!user;
}

async function findUserByPin(pin: string): Promise<{ id: string; role: string } | null> {
  if (!pin) return null;

  const { data: cred } = await supabaseAdmin
    .from("user_credentials")
    .select("user_id")
    .eq("pin", pin)
    .maybeSingle();

  const userId = cred?.user_id;
  if (!userId) return null;

  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id, role")
    .eq("id", userId)
    .single();

  return user || null;
}
