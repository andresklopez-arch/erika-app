"use client";
import { useState, useEffect } from "react";

export default function SettingsModule() {
  const [voiceKeyword, setVoiceKeyword] = useState("erika");
  const [earnRate, setEarnRate] = useState("100"); // Gasta $100
  const [earnPoints, setEarnPoints] = useState("1"); // Gana 1 punto
  const [redeemRate, setRedeemRate] = useState("10"); // 10 puntos = $1 de descuento

  useEffect(() => {
    const savedVoice = localStorage.getItem("ERIKA_VOICE_KEYWORD");
    if (savedVoice) setVoiceKeyword(savedVoice);

    const sEarnRate = localStorage.getItem("ERIKA_EARN_RATE");
    const sEarnPts = localStorage.getItem("ERIKA_EARN_PTS");
    const sRedeem = localStorage.getItem("ERIKA_REDEEM_RATE");
    
    if (sEarnRate) setEarnRate(sEarnRate);
    if (sEarnPts) setEarnPoints(sEarnPts);
    if (sRedeem) setRedeemRate(sRedeem);
  }, []);

  const saveConfig = () => {
    localStorage.setItem("ERIKA_VOICE_KEYWORD", voiceKeyword.toLowerCase());
    alert(
      "✅ Configuración guardada. El Cajero Inteligente de Voz pedirá esta palabra clave antes de ejecutar las órdenes de venta.",
    );
  };

  const saveLoyaltyConfig = () => {
    localStorage.setItem("ERIKA_EARN_RATE", earnRate);
    localStorage.setItem("ERIKA_EARN_PTS", earnPoints);
    localStorage.setItem("ERIKA_REDEEM_RATE", redeemRate);
    alert("✅ Tasas del Programa de Lealtad actualizadas.");
  };

  return (
    <div
      className="animate-fade-in glass-panel"
      style={{ padding: "30px", maxWidth: "800px", margin: "0 auto" }}
    >
      <h2 style={{ color: "var(--color-primary)" }}>
        ⚙️ Configuración Global de ERIKA
      </h2>

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

      <div style={{ display: "flex", gap: "30px", flexWrap: "wrap", marginTop: "30px" }}>
        <div style={{ flex: 1, minWidth: "300px", display: "flex", flexDirection: "column", gap: "20px" }}>
          
          <div className="glass-panel">
            <h3 style={{ marginBottom: "10px" }}>
              🔐 Palabra Clave de Seguridad (Voz)
            </h3>
            <p style={{ fontSize: "0.85rem", opacity: 0.7, marginBottom: "15px" }}>
              El sistema de voz ignorará peticiones a menos que la persona que le
              hable incluya esta palabra en su frase.
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

          <div className="glass-panel" style={{ border: "1px solid #eab308" }}>
            <h3 style={{ margin: "0 0 20px 0", color: "#eab308", display: "flex", alignItems: "center", gap: "10px" }}>
              ⭐ Tasas de Puntos de Lealtad
            </h3>
            <div style={{ marginBottom: "15px" }}>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Por cada $ de compra (Pesos):</label>
              <input type="number" value={earnRate} onChange={e => setEarnRate(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />
            </div>
            <div style={{ marginBottom: "15px" }}>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Se otorgan (Puntos):</label>
              <input type="number" value={earnPoints} onChange={e => setEarnPoints(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />
            </div>
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Puntos requeridos para $1.00 de descuento en caja:</label>
              <input type="number" value={redeemRate} onChange={e => setRedeemRate(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />
            </div>
            <button className="btn-primary" onClick={saveLoyaltyConfig} style={{ width: "100%", background: "transparent", border: "1px solid #eab308", color: "#eab308" }}>
              💾 Guardar Tasas de Lealtad
            </button>
          </div>

        </div>

        {/* LICENCIA DEL SISTEMA */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "20px" }}>
          <div className="glass-panel" style={{ flex: 1, border: "1px solid #10b981" }}>
            <h3 style={{ margin: "0 0 20px 0", color: "#10b981", display: "flex", alignItems: "center", gap: "10px" }}>
              🔑 Licencia del Sistema ERIKA
            </h3>
            
            <div style={{ background: "rgba(255,255,255,0.05)", padding: "15px", borderRadius: "8px", marginBottom: "15px" }}>
              <p style={{ margin: "0 0 5px 0", color: "var(--color-secondary)", fontSize: "0.9rem" }}>Estado de la Licencia</p>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ display: "inline-block", width: "12px", height: "12px", borderRadius: "50%", background: "#10b981" }}></span>
                <span style={{ fontSize: "1.2rem", fontWeight: "bold", color: "white" }}>Activa (Versión Ilimitada)</span>
              </div>
            </div>

            <div style={{ background: "rgba(255,255,255,0.05)", padding: "15px", borderRadius: "8px", marginBottom: "20px" }}>
              <p style={{ margin: "0 0 5px 0", color: "var(--color-secondary)", fontSize: "0.9rem" }}>Fecha de Vencimiento / Renovación</p>
              <p style={{ margin: 0, fontSize: "1.1rem", fontWeight: "bold", color: "white" }}>Licencia Vitalicia ♾️</p>
            </div>

            <div style={{ borderTop: "1px solid var(--glass-border)", paddingTop: "15px" }}>
              <label style={{ display: "block", marginBottom: "8px", color: "var(--color-secondary)", fontSize: "0.9rem" }}>Actualizar o Cambiar Clave de Producto</label>
              <div style={{ display: "flex", gap: "10px" }}>
                <input 
                  type="text" 
                  placeholder="XXXX-XXXX-XXXX-XXXX" 
                  style={{ flex: 1, padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white", fontFamily: "monospace", textTransform: "uppercase" }} 
                />
                <button className="btn-primary" style={{ padding: "10px 20px" }}>
                  Validar
                </button>
              </div>
              <p style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.5)", marginTop: "10px", fontStyle: "italic" }}>* El módulo de licencias se encuentra en modo bypass actualmente.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
