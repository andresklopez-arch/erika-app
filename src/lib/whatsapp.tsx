import toast from "react-hot-toast";

// Limpia y valida un numero de WhatsApp mexicano: acepta 10 digitos locales
// o 12 digitos que ya traen el prefijo de pais 52. Devuelve null si no
// calza con ninguno de los dos formatos (antes cada pantalla repetia esta
// misma logica de forma independiente).
export function cleanMexicanPhone(rawPhone: string): string | null {
  const digits = rawPhone.replace(/\D/g, "");
  if (digits.length === 10) return "52" + digits;
  if (digits.length === 12 && digits.startsWith("52")) return digits;
  return null;
}

// Abre WhatsApp Web/App con un texto precargado. Si el navegador bloquea la
// ventana emergente, avisa con un toast con boton de reintentar en vez de
// fallar en silencio (antes ningun envio de WhatsApp revisaba el resultado
// de window.open()).
export function openWhatsAppChat(phone: string, text: string): boolean {
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  const win = window.open(url, "_blank");
  if (!win) {
    toast.error(
      (t) => (
        <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span>⚠️ El navegador bloqueó la ventana de WhatsApp. Permite las ventanas emergentes para este sitio.</span>
          <button
            onClick={() => {
              toast.dismiss(t.id);
              openWhatsAppChat(phone, text);
            }}
            style={{
              background: "#fff",
              color: "#b91c1c",
              border: "none",
              borderRadius: "6px",
              padding: "4px 10px",
              fontWeight: "bold",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Reintentar
          </button>
        </span>
      ),
      { duration: 10000 },
    );
    return false;
  }
  return true;
}
