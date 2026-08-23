"use client";
import { useState, useCallback, useRef } from "react";

type PromptState =
  | { kind: "confirm"; title: string; message: string; confirmLabel?: string; danger?: boolean }
  | { kind: "number"; title: string; message: string; defaultValue?: string; confirmLabel?: string }
  | null;

// Reemplaza window.confirm/window.prompt (bloqueantes, sin estilo propio)
// por un modal consistente con el resto de la UI (glass-panel + overlay
// oscuro, igual que ClientCaptureModal/getPinAsync). Uso:
//
//   const { modal, confirmAsync, promptNumberAsync } = usePromptModal();
//   ...
//   const ok = await confirmAsync("¿Seguro?", "Se cancelará el apartado.");
//   const amount = await promptNumberAsync("Abonar", "¿Cuánto?", "");
//   ...
//   return <>{...jsx...}{modal}</>;
export function usePromptModal() {
  const [state, setState] = useState<PromptState>(null);
  const [inputValue, setInputValue] = useState("");
  const confirmResolverRef = useRef<((value: boolean) => void) | null>(null);
  const numberResolverRef = useRef<((value: number | null) => void) | null>(null);

  const confirmAsync = useCallback((title: string, message: string, opts?: { confirmLabel?: string; danger?: boolean }): Promise<boolean> => {
    return new Promise((resolve) => {
      confirmResolverRef.current = resolve;
      setState({ kind: "confirm", title, message, confirmLabel: opts?.confirmLabel, danger: opts?.danger });
    });
  }, []);

  const promptNumberAsync = useCallback((title: string, message: string, defaultValue = "", confirmLabel?: string): Promise<number | null> => {
    return new Promise((resolve) => {
      numberResolverRef.current = resolve;
      setInputValue(defaultValue);
      setState({ kind: "number", title, message, defaultValue, confirmLabel });
    });
  }, []);

  const settleConfirm = (value: boolean) => {
    confirmResolverRef.current?.(value);
    confirmResolverRef.current = null;
    setState(null);
  };

  const settleNumber = (value: number | null) => {
    numberResolverRef.current?.(value);
    numberResolverRef.current = null;
    setState(null);
  };

  const handleCancel = () => {
    if (state?.kind === "confirm") settleConfirm(false);
    else settleNumber(null);
  };

  const handleConfirm = () => {
    if (!state) return;
    if (state.kind === "confirm") {
      settleConfirm(true);
      return;
    }
    const normalized = inputValue.replace(",", ".").trim();
    const val = parseFloat(normalized);
    settleNumber(isNaN(val) ? null : val);
  };

  const modal = state ? (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10500,
        backdropFilter: "blur(5px)",
        padding: "20px",
      }}
      onClick={handleCancel}
    >
      <div
        className="glass-panel animate-fade-in"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "380px", maxWidth: "90%", padding: "20px" }}
      >
        <h3 style={{ color: state.kind === "confirm" && state.danger ? "#ef4444" : "var(--color-primary)", marginTop: 0, marginBottom: "10px" }}>
          {state.title}
        </h3>
        <p style={{ color: "rgba(255,255,255,0.85)", whiteSpace: "pre-line", marginBottom: "18px", fontSize: "0.9rem" }}>
          {state.message}
        </p>

        {state.kind === "number" && (
          <input
            type="number"
            autoFocus
            inputMode="decimal"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirm();
              if (e.key === "Escape") handleCancel();
            }}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: "6px",
              border: "1px solid var(--glass-border)",
              background: "rgba(0,0,0,0.3)",
              color: "white",
              fontSize: "1rem",
              outline: "none",
              marginBottom: "18px",
              boxSizing: "border-box",
            }}
          />
        )}

        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button
            onClick={handleCancel}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "1px solid var(--glass-border)",
              background: "transparent",
              color: "white",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            className="btn-primary"
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: state.kind === "confirm" && state.danger ? "1px solid #ef4444" : "none",
              background: state.kind === "confirm" && state.danger ? "transparent" : undefined,
              color: state.kind === "confirm" && state.danger ? "#ef4444" : undefined,
              cursor: "pointer",
              fontWeight: "bold",
              fontSize: "0.85rem",
            }}
          >
            {state.confirmLabel || (state.kind === "confirm" ? "Sí, continuar" : "Confirmar")}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { modal, confirmAsync, promptNumberAsync };
}
