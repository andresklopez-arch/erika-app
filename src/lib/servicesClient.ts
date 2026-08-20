async function postJson(url: string, body: any) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: { message: json.error || "Error al guardar." } };
    return { data: json, error: null };
  } catch (e: any) {
    return { data: null, error: { message: e.message || "Error de red." } };
  }
}

export async function saveService(payload: { id?: string; fields: Record<string, any> }) {
  return postJson("/api/services/save", payload);
}

export async function deleteService(id: string, action: "soft" | "restore" | "hard") {
  return postJson("/api/services/delete", { id, action });
}
