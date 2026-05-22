import SettingsModule from "@/components/SettingsModule";

export default function ConfiguracionPage() {
  return (
    <div style={{ height: "100%" }}>
      <header
        className="glass-panel"
        style={{ padding: "20px", marginBottom: "20px" }}
      >
        <h1 style={{ margin: 0, color: "var(--color-primary)" }}>
          Configuración de ERIKA
        </h1>
      </header>
      <main style={{ height: "calc(100% - 90px)" }}>
        <SettingsModule />
      </main>
    </div>
  );
}
