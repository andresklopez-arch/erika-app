"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";

export default function HomeButton() {
  const pathname = usePathname();

  // No mostrar el botón si ya estamos en el Punto de Venta (Home)
  if (pathname === "/") return null;

  return (
    <div style={{ marginBottom: "15px", display: "flex", justifyContent: "flex-end" }}>
      <Link href="/">
        <button
          className="btn-primary"
          style={{
            background: "rgba(255,255,255,0.1)",
            color: "white",
            border: "1px solid var(--glass-border)",
            padding: "8px 15px",
            fontSize: "0.9rem",
          }}
        >
          🏠 Ir a Punto de Venta (Home)
        </button>
      </Link>
    </div>
  );
}
