import POSModule from "@/components/POSModule";
import ProtectedRoute from "@/components/ProtectedRoute";

export default function VentasPage() {
  return (
    <ProtectedRoute permission="pos">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          height: "100%",
        }}
      >
        <header
          className="glass-panel"
          style={{
            padding: "15px 20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h1 style={{ fontSize: "1.8rem", color: "var(--color-primary)" }}>
            🛒 Punto de Venta
          </h1>
          <div style={{ color: "var(--color-secondary)" }}>
            Caja: Abierta | Turno: Matutino
          </div>
        </header>
        <POSModule />
      </div>
    </ProtectedRoute>
  );
}
