import UsersModule from "@/components/UsersModule";

export default function UsuariosPage() {
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
          👥 Clientes y Proveedores
        </h1>
        <p style={{ color: "var(--color-secondary)" }}>
          Gestión de créditos, deudas e historial de compras
        </p>
      </header>
      <UsersModule />
    </div>
  );
}
