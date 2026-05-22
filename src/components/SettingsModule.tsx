"use client";
import { useState, useEffect } from "react";

export default function SettingsModule() {
  const [voiceKeyword, setVoiceKeyword] = useState("erika");

  useEffect(() => {
    const saved = localStorage.getItem("ERIKA_VOICE_KEYWORD");
    if (saved) setVoiceKeyword(saved);
  }, []);

  const saveConfig = () => {
    localStorage.setItem("ERIKA_VOICE_KEYWORD", voiceKeyword.toLowerCase());
    alert(
      "✅ Configuración guardada. El Cajero Inteligente de Voz pedirá esta palabra clave antes de ejecutar las órdenes de venta.",
    );
  };

  return (
    <div
      className="animate-fade-in glass-panel"
      style={{ padding: "30px", maxWidth: "600px", margin: "0 auto" }}
    >
      <h2 style={{ color: "var(--color-primary)" }}>
        ⚙️ Configuración Global de ERIKA
      </h2>

      <div style={{ marginTop: "30px" }}>
        <h3 style={{ marginBottom: "10px" }}>
          🔐 Palabra Clave de Seguridad (Voz)
        </h3>
        <p style={{ fontSize: "0.85rem", opacity: 0.7, marginBottom: "15px" }}>
          El sistema de voz ignorará peticiones a menos que la persona que le
          hable incluya esta palabra en su frase (Ej. "Agrega 2 clavos, palabra
          secreta ERIKA").
        </p>

        <input
          type="text"
          value={voiceKeyword}
          onChange={(e) => setVoiceKeyword(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            borderRadius: "8px",
            background: "rgba(0,0,0,0.3)",
            color: "white",
            border: "1px solid var(--color-primary)",
            marginBottom: "20px",
          }}
        />

        <button
          className="btn-primary"
          onClick={saveConfig}
          style={{ width: "100%" }}
        >
          💾 Guardar Palabra de Seguridad
        </button>
      </div>

      <div style={{ marginTop: "30px" }}>
        <h3 style={{ marginBottom: "10px", color: "var(--color-secondary)" }}>
          ☁️ Conexión Supabase (Nube)
        </h3>
        <p style={{ fontSize: "0.85rem", opacity: 0.7, marginBottom: "15px" }}>
          El paso final. Obtén estas credenciales al crear un proyecto en
          Supabase.com para iniciar la migración oficial.
        </p>

        <input
          type="text"
          placeholder="URL del Proyecto (ej. https://xxx.supabase.co)"
          disabled
          style={{
            width: "100%",
            padding: "12px",
            borderRadius: "8px",
            background: "rgba(255,255,255,0.05)",
            color: "white",
            border: "1px solid rgba(255,255,255,0.1)",
            marginBottom: "10px",
          }}
        />
        <input
          type="password"
          placeholder="Anon / Public Key"
          disabled
          style={{
            width: "100%",
            padding: "12px",
            borderRadius: "8px",
            background: "rgba(255,255,255,0.05)",
            color: "white",
            border: "1px solid rgba(255,255,255,0.1)",
            marginBottom: "20px",
          }}
        />

        <button
          className="btn-primary"
          disabled
          style={{ width: "100%", opacity: 0.5 }}
        >
          Conectar Nube (Pendiente)
        </button>
      </div>
    </div>
  );
}
