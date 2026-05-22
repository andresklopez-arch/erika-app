"use client";
import { useState, useEffect } from "react";
import ReportsModule from "@/components/ReportsModule";

export default function ReportesPage() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem("erika_banner_dismissed") === "true";
    if (!dismissed) {
      setShowBanner(true);
    }
  }, []);

  const dismissBanner = () => {
    localStorage.setItem("erika_banner_dismissed", "true");
    setShowBanner(false);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        height: "100%",
      }}
    >
      <header className="glass-panel" style={{ padding: "15px 20px" }}>
        <h1 style={{ fontSize: "1.8rem", color: "var(--color-primary)" }}>
          🧠 Inteligencia y Facturación
        </h1>
        <p style={{ color: "var(--color-secondary)" }}>
          Consejos ERIKA, Autofacturación y Marketing
        </p>
      </header>

      {showBanner && (
        <div
          className="animate-fade-in"
          style={{
            background:
              "linear-gradient(135deg, rgba(0, 242, 254, 0.1), rgba(0,0,0,0.8))",
            border: "1px solid rgba(0,242,254,0.3)",
            borderRadius: "40px",
            padding: "40px",
            display: "flex",
            flexDirection: "column",
            gap: "30px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
            <div
              style={{
                width: "120px",
                height: "120px",
                borderRadius: "30px",
                background: "rgba(0, 242, 254, 0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "2px solid var(--color-primary)",
                flexShrink: 0,
                boxShadow: "0 0 30px rgba(0, 242, 254, 0.3)",
                animation: "pulse 2.5s infinite ease-in-out",
              }}
            >
              <span style={{ fontSize: "70px" }}>🤖</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <h2
                style={{
                  fontSize: "55px",
                  color: "#fff",
                  lineHeight: 1,
                  margin: 0,
                }}
              >
                HOLA, SOY{" "}
                <span
                  style={{
                    color: "var(--color-primary)",
                    textShadow: "0 0 15px var(--color-primary)",
                  }}
                >
                  ERIKA
                </span>
              </h2>
              <span
                style={{
                  opacity: 0.5,
                  textTransform: "uppercase",
                  letterSpacing: "2px",
                  fontSize: "24px",
                  fontWeight: "bold",
                }}
              >
                Tu Nueva IA Operativa
              </span>
            </div>
          </div>
          <p
            style={{
              fontSize: "30px",
              color: "rgba(255,255,255,0.9)",
              lineHeight: 1.4,
              fontWeight: 600,
            }}
          >
            Analizo cada movimiento de tu negocio en tiempo real. Mi objetivo es
            hacer que ganes más y gastes menos. Conmigo podrás:
          </p>
          <ul
            style={{
              fontSize: "24px",
              color: "rgba(255,255,255,0.7)",
              lineHeight: 1.5,
              fontWeight: 600,
              paddingLeft: "20px",
              display: "flex",
              flexDirection: "column",
              gap: "15px",
            }}
          >
            <li>✨ Detectar fugas invisibles de dinero.</li>
            <li>✨ Predecir tus ventas.</li>
            <li>✨ Auditar el rendimiento de tus vendedores.</li>
            <li>✨ Maximizar tu Ticket Promedio.</li>
          </ul>
          <button
            onClick={dismissBanner}
            className="btn-primary"
            style={{
              background: "rgba(0,242,254,0.1)",
              border: "2px solid var(--color-primary)",
              color: "#fff",
              borderRadius: "20px",
              padding: "25px 40px",
              fontSize: "24px",
              fontWeight: 900,
              alignSelf: "stretch",
              marginTop: "10px",
              textTransform: "uppercase",
              letterSpacing: "1px",
              transition: "all 0.3s",
              boxShadow: "0 0 20px rgba(0,242,254,0.15)",
              cursor: "pointer",
            }}
          >
            ENTENDIDO, MOSTRAR MIS DATOS
          </button>
          <style
            dangerouslySetInnerHTML={{
              __html: `
            @keyframes pulse {
                0% { box-shadow: 0 0 0 0 rgba(0, 242, 254, 0.4); transform: scale(1); }
                50% { box-shadow: 0 0 0 20px rgba(0, 242, 254, 0); transform: scale(1.05); }
                100% { box-shadow: 0 0 0 0 rgba(0, 242, 254, 0); transform: scale(1); }
            }
          `,
            }}
          />
        </div>
      )}

      <ReportsModule />
    </div>
  );
}
