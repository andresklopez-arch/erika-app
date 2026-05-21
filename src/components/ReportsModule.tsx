"use client";

export default function ReportsModule() {
  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* Resumen de Inteligencia */}
      <div className="grid-cols-2">
        <div className="glass-panel" style={{ background: 'linear-gradient(135deg, rgba(244, 63, 94, 0.1), transparent)' }}>
          <h2 style={{ color: 'var(--color-primary)', marginBottom: '15px' }}>🧠 Inteligencia y Big Data ERIKA</h2>
          <p style={{ marginBottom: '15px' }}>He analizado tus datos del último mes. Aquí tienes mis descubrimientos principales para hacer crecer tu negocio:</p>
          <ul style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <li style={{ background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '8px' }}>🚀 <strong>Productos Estrella:</strong> El "Cemento Tolteca" incrementó ventas un 25%. Sugiero pedir un 10% más en la próxima orden para obtener mejor margen.</li>
            <li style={{ borderLeft: '4px solid var(--color-primary)', background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '8px' }}>⚠️ <strong>Posible Fuga:</strong> El inventario de "Brochas" tiene discrepancias (faltan 3 piezas vs ventas). Sugiero hacer un inventario parcial hoy.</li>
            <li style={{ background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '8px' }}>💡 <strong>Oferta Sugerida:</strong> Tienes 50 L de Pintura Blanca estancada. Sugiero emitir un cupón del 15% a tus clientes recurrentes.</li>
          </ul>
        </div>

        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <h3 style={{ borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>🧾 Facturas Pendientes (Autofacturación)</h3>
          <div className="flex-between" style={{ background: 'rgba(255,255,255,0.05)', padding: '15px', borderRadius: '8px' }}>
            <div>
              <strong>Ticket #0045 - Constructora Alfa</strong>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-secondary)' }}>Monto: $15,000.00 | Requiere XML y PDF</div>
            </div>
            <button className="btn-primary" style={{ fontSize: '0.8rem', padding: '8px 12px' }}>Timbrar (Auto)</button>
          </div>
          <div className="flex-between" style={{ background: 'rgba(255,255,255,0.05)', padding: '15px', borderRadius: '8px' }}>
            <div>
              <strong>Factura Global del Día</strong>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-secondary)' }}>Monto: $4,520.50 | Público en General</div>
            </div>
            <button className="btn-primary" style={{ fontSize: '0.8rem', padding: '8px 12px' }}>Generar Global</button>
          </div>
        </div>
      </div>

      <div className="glass-panel">
        <h3 style={{ marginBottom: '15px' }}>🎟️ Emisión de Cupones y Promociones (Fidelización)</h3>
        <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
          <input type="text" placeholder="Código (ej. VERANO26)" style={{ flex: 1, minWidth: '150px', padding: '10px', borderRadius: '8px', background: 'rgba(0,0,0,0.3)', color: 'white', border: '1px solid var(--glass-border)' }} />
          <input type="number" placeholder="% Descuento" style={{ width: '120px', padding: '10px', borderRadius: '8px', background: 'rgba(0,0,0,0.3)', color: 'white', border: '1px solid var(--glass-border)' }} />
          <button className="btn-primary">Generar y Enviar a Clientes Top por WhatsApp</button>
        </div>
      </div>

    </div>
  );
}
