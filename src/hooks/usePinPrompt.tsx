"use client";
import { useState } from "react";
import { Z_INDEX } from "../lib/zIndex";

// Modal de PIN reutilizable. Antes POSModule.tsx tenía su propia copia
// completa (estado + JSX) y QuotesModule.tsx pedía el PIN con
// window.prompt() -- una caja de texto sin máscara, sin estilo y
// inconsistente con el resto de la app. Este hook centraliza esa UI para
// que cualquier módulo pueda pedir un PIN con la misma experiencia.
export function usePinPrompt() {
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const [pinModalTitle, setPinModalTitle] = useState("AUTORIZACIÓN REQUERIDA");
  const [pinModalMessage, setPinModalMessage] = useState("");
  const [pinModalCallback, setPinModalCallback] = useState<((pin: string) => void) | null>(null);

  const requestPin = (title: string, message: string, callback: (pin: string) => void) => {
    setPinModalTitle(title);
    setPinModalMessage(message);
    setPinValue("");
    setPinModalCallback(() => callback);
    setShowPinModal(true);
  };

  const getPinAsync = (title: string, message: string): Promise<string> => {
    return new Promise((resolve) => {
      requestPin(title, message, (pin) => {
        resolve(pin);
      });
    });
  };

  const PinModal = !showPinModal ? null : (
    <div style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: "rgba(0,0,0,0.75)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      // getPinAsync() se puede disparar desde CUALQUIER pantalla, incluyendo
      // modales que ya están abiertos -- debe quedar por encima de
      // cualquier otro zIndex del archivo que lo use.
      zIndex: Z_INDEX.AUTHORIZATION,
      backdropFilter: "blur(5px)"
    }}>
      <div className="glass-panel" style={{
        padding: "25px",
        width: "350px",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        gap: "15px",
        background: "rgba(22, 22, 34, 0.95)",
        border: "1px solid var(--glass-border)",
        boxShadow: "0 20px 50px rgba(0,0,0,0.5)"
      }}>
        <h3 style={{ color: "var(--color-primary)", margin: 0 }}>{pinModalTitle}</h3>
        <p style={{ fontSize: "0.85rem", opacity: 0.9, whiteSpace: "pre-line" }}>{pinModalMessage}</p>
        <input
          type="password"
          placeholder="PIN de 4 dígitos"
          maxLength={6}
          value={pinValue}
          onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ""))}
          style={{
            width: "100%",
            padding: "12px",
            textAlign: "center",
            fontSize: "1.2rem",
            borderRadius: "6px",
            border: "1px solid var(--glass-border)",
            background: "rgba(0,0,0,0.3)",
            color: "white",
            letterSpacing: "4px"
          }}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (pinModalCallback) pinModalCallback(pinValue);
              setShowPinModal(false);
            }
          }}
        />
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            className="btn-primary inactive"
            style={{ flex: 1, padding: "10px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
            onClick={() => {
              setShowPinModal(false);
              if (pinModalCallback) pinModalCallback("");
            }}
          >
            Cancelar
          </button>
          <button
            className="btn-primary"
            style={{ flex: 1, padding: "10px" }}
            onClick={() => {
              if (pinModalCallback) pinModalCallback(pinValue);
              setShowPinModal(false);
            }}
          >
            Autorizar
          </button>
        </div>
      </div>
    </div>
  );

  return { getPinAsync, PinModal };
}
