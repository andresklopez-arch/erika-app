import InventoryModule from "@/components/InventoryModule";
import ProtectedRoute from "../../components/ProtectedRoute";

export default function InventarioPage() {
  return (
    <ProtectedRoute permission="inventario">
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
            📦 Gestión de Inventario
          </h1>
          <p style={{ color: "var(--color-secondary)" }}>
            Análisis predictivo y control de almacén automatizado por ERIKA
          </p>
        </header>
        <InventoryModule />
      </div>
    </ProtectedRoute>
  );
}
