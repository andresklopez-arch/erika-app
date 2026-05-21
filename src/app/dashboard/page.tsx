"use client";
import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const TOP_SALES_DATA = [
  { name: "Cemento Tolteca 50kg", ventas: 12500 },
  { name: "Pintura Blanca 19L", ventas: 8900 },
  { name: "Cable Calibre 12", ventas: 4500 },
  { name: "Martillo Truper", ventas: 3200 },
  { name: "Brocha 4 pulg", ventas: 1500 },
];

const INVENTORY_DIST_DATA = [
  { name: "Construcción", value: 45 },
  { name: "Pinturas", value: 25 },
  { name: "Herramientas", value: 20 },
  { name: "Eléctrico", value: 10 },
];

const LOW_STOCK_ALERTS = [
  { name: "Pintura Blanca 19L Comex", stock: 4, min: 5 },
  { name: "Brocha 4 pulgadas", stock: 4, min: 10 },
  { name: "Diluyente Poliuretano", stock: 1, min: 5 }
];

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444'];

export default function Dashboard() {
  return (
    <div className="animate-fade-in" style={{ padding: '20px' }}>
      <h1 style={{ color: 'var(--color-primary)', marginBottom: '30px' }}>📊 Centro de Inteligencia Financiera</h1>
      
      {/* Kpis Rápidos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '30px' }}>
        <div className="glass-panel" style={{ textAlign: 'center', background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), transparent)' }}>
          <h3 style={{ margin: 0, color: 'var(--color-secondary)' }}>Ventas (Hoy)</h3>
          <p style={{ fontSize: '2rem', fontWeight: 'bold', margin: '10px 0' }}>$14,500.00</p>
        </div>
        <div className="glass-panel" style={{ textAlign: 'center' }}>
          <h3 style={{ margin: 0, color: 'var(--color-secondary)' }}>Utilidad Bruta</h3>
          <p style={{ fontSize: '2rem', fontWeight: 'bold', margin: '10px 0' }}>$4,250.00</p>
        </div>
        <div className="glass-panel" style={{ textAlign: 'center' }}>
          <h3 style={{ margin: 0, color: 'var(--color-secondary)' }}>Mermas / Daños</h3>
          <p style={{ fontSize: '2rem', fontWeight: 'bold', margin: '10px 0', color: '#ef4444' }}>-$340.00</p>
        </div>
        <div className="glass-panel" style={{ textAlign: 'center' }}>
          <h3 style={{ margin: 0, color: 'var(--color-secondary)' }}>Clientes Atendidos</h3>
          <p style={{ fontSize: '2rem', fontWeight: 'bold', margin: '10px 0' }}>42</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
        
        {/* Gráfica de Barras */}
        <div className="glass-panel">
          <h3 style={{ color: 'var(--color-secondary)', marginBottom: '20px' }}>🏆 Top 5 Productos con Más Ventas ($)</h3>
          <div style={{ width: '100%', height: '300px' }}>
            <ResponsiveContainer>
              <BarChart data={TOP_SALES_DATA}>
                <XAxis dataKey="name" stroke="#fff" tick={{fill: '#ccc', fontSize: 12}} />
                <YAxis stroke="#fff" tick={{fill: '#ccc'}} />
                <Tooltip cursor={{fill: 'rgba(255,255,255,0.1)'}} contentStyle={{background: '#111', border: '1px solid #10b981'}} />
                <Bar dataKey="ventas" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfica de Pastel y Alertas */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          <div className="glass-panel" style={{ flex: 1 }}>
            <h3 style={{ color: 'var(--color-secondary)', marginBottom: '10px' }}>⚠️ Alertas Críticas (Bajo Stock)</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {LOW_STOCK_ALERTS.map((alert, idx) => (
                <li key={idx} style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', padding: '10px', borderRadius: '8px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{alert.name}</span>
                  <strong style={{ color: '#ef4444' }}>{alert.stock} (Min: {alert.min})</strong>
                </li>
              ))}
            </ul>
          </div>

          <div className="glass-panel" style={{ height: '220px' }}>
            <h3 style={{ color: 'var(--color-secondary)', marginBottom: '10px', textAlign: 'center' }}>📦 Valor del Inventario</h3>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={INVENTORY_DIST_DATA} innerRadius={50} outerRadius={70} paddingAngle={5} dataKey="value">
                  {INVENTORY_DIST_DATA.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{background: '#111', border: '1px solid #3b82f6'}} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          
        </div>
      </div>
    </div>
  );
}
