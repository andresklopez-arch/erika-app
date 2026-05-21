import SearchModule from "@/components/SearchModule";

export default function Home() {
  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      <header className="flex-between glass-panel" style={{ padding: '20px' }}>
        <div>
          <h1 style={{ fontSize: '2rem' }}>Panel de Control</h1>
          <p style={{ color: 'var(--color-secondary)' }}>Resumen del día</p>
        </div>
        <div style={{ flex: 1, margin: '0 40px' }}>
          <SearchModule />
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn-primary">Nueva Venta (1)</button>
        </div>
      </header>

      <div className="grid-cols-2">
        <div className="glass-panel">
          <h3 style={{ marginBottom: '15px', color: 'var(--color-primary)' }}>🤖 Análisis de ERIKA</h3>
          <p>He detectado que el <strong>Clavo para concreto 2"</strong> tiene bajo inventario (15 kg restantes) y su índice de venta subió un 12% esta semana. ¿Deseas que prepare un pedido para tu proveedor?</p>
          <button className="btn-primary" style={{ marginTop: '15px', width: '100%' }}>Generar Mensaje WhatsApp</button>
        </div>
        
        <div className="glass-panel">
          <h3 style={{ marginBottom: '15px' }}>📈 Ventas Recientes</h3>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <li className="flex-between" style={{ padding: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
              <span>Martillo Truper + Clavos</span>
              <strong>$145.50</strong>
            </li>
            <li className="flex-between" style={{ padding: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
              <span>Pintura Blanca 19L</span>
              <strong>$1,200.00</strong>
            </li>
            <li className="flex-between" style={{ padding: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
              <span>Cemento Tolteca (2 bultos)</span>
              <strong>$420.00</strong>
            </li>
          </ul>
        </div>
      </div>

    </div>
  );
}
