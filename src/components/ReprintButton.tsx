"use client";
import { useEffect, useRef, useState } from "react";

// Único punto de renderizado del botón "Reimprimir" de un ticket -- antes
// cada pantalla copiaba/pegaba su propio <button onClick={() =>
// handleReprintHistoryTicket(...)}>, y así fue como "Consulta de Tickets
// Anteriores" terminó con 2 botones idénticos para el mismo ticket
// (reporte de Ferretería Erika, 2026-08-26). Centralizar el botón aquí
// hace que agregar un segundo por accidente sea obvio en el diff, y
// scripts/test-reprint-single-button.js falla si alguien vuelve a llamar
// handleReprintHistoryTicket desde un <button> fuera de este componente.
//
// También resuelve el doble-tap accidental en pantalla táctil:
// handleReprintHistoryTicket no es async (triggerPrint es "fire and
// forget", ver POSModule.tsx), así que no hay una promesa real que
// esperar -- este bloqueo de 1.5s es deliberadamente corto y solo evita
// mandar 2 trabajos de impresión por un doble-clic, no una confirmación
// de que el ticket físico ya salió.
type Variant = "row" | "pill-outline" | "featured";

interface Props {
  ticket: any;
  folio?: string;
  onReprint: (ticket: any) => void;
  variant: Variant;
  stopPropagation?: boolean;
}

const REPRINT_LOCK_MS = 1500;

export default function ReprintButton({ ticket, folio, onReprint, variant, stopPropagation }: Props) {
  const [isPrinting, setIsPrinting] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (stopPropagation) e.stopPropagation();
    if (isPrinting) return;
    setIsPrinting(true);
    onReprint(ticket);
    timeoutRef.current = setTimeout(() => setIsPrinting(false), REPRINT_LOCK_MS);
  };

  if (variant === "featured") {
    return (
      <button
        type="button"
        onClick={handleClick}
        className="btn-primary"
        disabled={isPrinting}
        style={{
          width: "100%",
          padding: "8px",
          fontSize: "0.85rem",
          fontWeight: "bold",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
          background: "linear-gradient(135deg, #10b981, #059669)",
          border: "none",
          borderRadius: "6px",
          cursor: isPrinting ? "default" : "pointer",
          opacity: isPrinting ? 0.7 : 1,
          boxShadow: "0 3px 10px rgba(16, 185, 129, 0.3)",
        }}
      >
        {isPrinting ? "🖨️ Enviando..." : `🖨️ Reimprimir Ticket #${folio ?? ticket.id}`}
      </button>
    );
  }

  if (variant === "row") {
    return (
      <button
        type="button"
        onClick={handleClick}
        className="btn-primary"
        disabled={isPrinting}
        title="Reimprimir este ticket directamente"
        style={{
          padding: "3px 8px",
          fontSize: "0.72rem",
          background: "linear-gradient(135deg, #10b981, #059669)",
          color: "white",
          border: "none",
          borderRadius: "4px",
          fontWeight: "bold",
          display: "inline-flex",
          alignItems: "center",
          gap: "3px",
          cursor: isPrinting ? "default" : "pointer",
          opacity: isPrinting ? 0.7 : 1,
          boxShadow: "0 2px 6px rgba(16, 185, 129, 0.3)",
        }}
      >
        🖨️ {isPrinting ? "..." : "Reimprimir"}
      </button>
    );
  }

  // "pill-outline": usado en la búsqueda de Garantía (Clonar / Imprimir / Nota)
  return (
    <button
      type="button"
      onClick={handleClick}
      className="btn-primary"
      disabled={isPrinting}
      style={{
        padding: "5px 10px",
        fontSize: "0.8rem",
        background: "transparent",
        border: "1px solid #10b981",
        color: "#10b981",
        opacity: isPrinting ? 0.6 : 1,
        cursor: isPrinting ? "default" : "pointer",
      }}
    >
      🖨️ {isPrinting ? "..." : "Imprimir"}
    </button>
  );
}
