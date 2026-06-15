"use client";
import { useEffect } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";

interface Props {
  show: boolean;
  onClose: () => void;
  onScan: (decodedText: string) => void;
}

export default function PosScannerModal({ show, onClose, onScan }: Props) {
  useEffect(() => {
    let scanner: any = null;
    if (show) {
      scanner = new Html5QrcodeScanner(
        "qr-reader",
        { fps: 10, qrbox: { width: 250, height: 250 } },
        false,
      );
      scanner.render(
        (decodedText: string) => {
          scanner.clear();
          onClose();
          onScan(decodedText);
        },
        () => {
          /* ignore */
        },
      );
    }
    return () => {
      if (scanner) scanner.clear().catch(() => {});
    };
  }, [show, onScan, onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    if (show) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [show, onClose]);

  if (!show) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.9)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
      }}
    >
      <h2 style={{ color: "var(--color-primary)" }}>
        📷 Escáner de Visión Artificial
      </h2>
      <div
        id="qr-reader"
        style={{ width: "400px", maxWidth: "90%", background: "white" }}
      ></div>
      <button
        className="btn-primary"
        onClick={onClose}
        style={{
          marginTop: "20px",
          background: "transparent",
          border: "1px solid var(--color-primary)",
        }}
      >
        Cerrar Cámara
      </button>
    </div>
  );
}
