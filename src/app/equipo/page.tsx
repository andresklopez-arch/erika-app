"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../components/AuthProvider";

export default function EquipoModule() {
  const { currentUser, logout } = useAuth();
  const [users, setUsers] = useState<any[]>([]);

  useEffect(() => {
    const fetchUsers = async () => {
      const { data } = await supabase.from('users').select('*').order('role', { ascending: true });
      if (data) setUsers(data);
    };
    fetchUsers();
  }, []);

  return (
    <div className="animate-fade-in" style={{ padding: '20px' }}>
      <div className="flex-between" style={{ marginBottom: '30px' }}>
        <h1 style={{ color: 'var(--color-primary)' }}>👥 Gestión de Personal</h1>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <span style={{ color: 'white' }}>Hola, <strong style={{ color: 'var(--color-secondary)' }}>{currentUser?.name}</strong></span>
          <button onClick={logout} className="btn-primary" style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444' }}>Cerrar Sesión</button>
        </div>
      </div>

      <div className="glass-panel">
        <h2 style={{ color: 'var(--color-secondary)', marginBottom: '20px' }}>Empleados Autorizados</h2>
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-primary)', color: 'var(--color-primary)' }}>
              <th style={{ padding: '10px' }}>Nombre</th>
              <th style={{ padding: '10px' }}>Rol</th>
              <th style={{ padding: '10px' }}>PIN de Acceso</th>
              <th style={{ padding: '10px' }}>Alta</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <td style={{ padding: '15px 10px', fontSize: '1.1rem' }}>{u.name}</td>
                <td style={{ padding: '15px 10px' }}>
                  <span style={{ background: u.role === 'admin' ? '#3b82f6' : '#10b981', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', color: 'black', fontWeight: 'bold' }}>
                    {u.role.toUpperCase()}
                  </span>
                </td>
                <td style={{ padding: '15px 10px' }}>
                  {currentUser?.role === 'admin' ? <strong>{u.pin}</strong> : '****'}
                </td>
                <td style={{ padding: '15px 10px', color: 'var(--color-secondary)' }}>
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {currentUser?.role !== 'admin' && <p style={{ color: '#ef4444', marginTop: '20px', fontSize: '0.9rem' }}>🔒 Solo el Administrador puede ver los PINs del personal.</p>}
      </div>
    </div>
  );
}
