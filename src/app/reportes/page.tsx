import ReportsModule from "@/components/ReportsModule";

export default function ReportesPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%' }}>
      <header className="glass-panel" style={{ padding: '15px 20px' }}>
        <h1 style={{ fontSize: '1.8rem', color: 'var(--color-primary)' }}>🧠 Inteligencia y Facturación</h1>
        <p style={{ color: 'var(--color-secondary)' }}>Consejos ERIKA, Autofacturación y Marketing</p>
      </header>
      <ReportsModule />
    </div>
  );
}
