"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../components/AuthProvider";
import ProtectedRoute from "../../components/ProtectedRoute";

export default function EquipoModule() {
  const { currentUser, logout } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    pin: "",
    role: "cajero",
    permissions: {
      pos: true,
      dashboard: false,
      caja: false,
      equipo: false,
      inventario: false,
      reportes: false,
      configuracion: false,
      servicios: false,
    },
  });

  const fetchUsers = async () => {
    const { data } = await supabase
      .from("users")
      .select("*")
      .order("role", { ascending: true });
    if (data) setUsers(data);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const openModal = (user?: any) => {
    if (user) {
      setEditingUser(user);
      setFormData({
        name: user.name,
        pin: user.pin,
        role: user.role,
        permissions: user.permissions || {},
      });
    } else {
      setEditingUser(null);
      setFormData({
        name: "",
        pin: "",
        role: "cajero",
        permissions: {
          pos: true,
          dashboard: false,
          caja: false,
          equipo: false,
          inventario: false,
          reportes: false,
          configuracion: false,
          servicios: false,
        },
      });
    }
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingUser(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Si es administrador, le damos todos los permisos automáticamente
    const finalPermissions =
      formData.role === "admin"
        ? {
            pos: true,
            dashboard: true,
            caja: true,
            equipo: true,
            inventario: true,
            reportes: true,
            configuracion: true,
            servicios: true,
          }
        : formData.permissions;

    const payload = {
      name: formData.name,
      pin: formData.pin,
      role: formData.role,
      permissions: finalPermissions,
    };

    if (editingUser) {
      await supabase.from("users").update(payload).eq("id", editingUser.id);
    } else {
      await supabase.from("users").insert([payload]);
    }

    setLoading(false);
    closeModal();
    fetchUsers();
  };

  const handleDelete = async (id: string) => {
    if (confirm("¿Estás seguro de eliminar este empleado?")) {
      await supabase.from("users").delete().eq("id", id);
      fetchUsers();
    }
  };

  const togglePermission = (key: string) => {
    setFormData({
      ...formData,
      permissions: {
        ...formData.permissions,
        [key]: !(formData.permissions as any)[key],
      },
    });
  };

  return (
    <ProtectedRoute permission="equipo">
      <div className="animate-fade-in" style={{ padding: "20px" }}>
      <div className="flex-between" style={{ marginBottom: "30px" }}>
        <h1 style={{ color: "var(--color-primary)" }}>
          👥 Gestión de Personal
        </h1>
        <div style={{ display: "flex", gap: "15px", alignItems: "center" }}>
          <span style={{ color: "white" }}>
            Hola,{" "}
            <strong style={{ color: "var(--color-secondary)" }}>
              {currentUser?.name}
            </strong>
          </span>
          <button
            onClick={logout}
            className="btn-primary"
            style={{
              background: "transparent",
              border: "1px solid #ef4444",
              color: "#ef4444",
            }}
          >
            Cerrar Sesión
          </button>
        </div>
      </div>

      <div className="glass-panel">
        <div className="flex-between" style={{ marginBottom: "20px" }}>
          <h2 style={{ color: "var(--color-secondary)", margin: 0 }}>
            Empleados Autorizados
          </h2>
          {currentUser?.role === "admin" && (
            <button
              onClick={() => openModal()}
              className="btn-primary"
              style={{ padding: "8px 15px", fontSize: "0.9rem" }}
            >
              + Nuevo Empleado
            </button>
          )}
        </div>

        <table
          style={{
            width: "100%",
            textAlign: "left",
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr
              style={{
                borderBottom: "1px solid var(--color-primary)",
                color: "var(--color-primary)",
              }}
            >
              <th style={{ padding: "10px" }}>Nombre</th>
              <th style={{ padding: "10px" }}>Rol</th>
              <th style={{ padding: "10px" }}>PIN de Acceso</th>
              <th style={{ padding: "10px" }}>Alta</th>
              {currentUser?.role === "admin" && (
                <th style={{ padding: "10px", textAlign: "right" }}>
                  Acciones
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr
                key={u.id}
                style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
              >
                <td
                  style={{
                    padding: "15px 10px",
                    fontSize: "1.1rem",
                    color: "#fff",
                  }}
                >
                  {u.name}
                </td>
                <td style={{ padding: "15px 10px" }}>
                  <span
                    style={{
                      background: u.role === "admin" ? "#3b82f6" : "#10b981",
                      padding: "4px 8px",
                      borderRadius: "4px",
                      fontSize: "0.8rem",
                      color: "black",
                      fontWeight: "bold",
                    }}
                  >
                    {u.role.toUpperCase()}
                  </span>
                </td>
                <td style={{ padding: "15px 10px", color: "#fff" }}>
                  {currentUser?.role === "admin" ? (
                    <strong>{u.pin}</strong>
                  ) : (
                    "****"
                  )}
                </td>
                <td
                  style={{
                    padding: "15px 10px",
                    color: "var(--color-secondary)",
                  }}
                >
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
                {currentUser?.role === "admin" && (
                  <td style={{ padding: "15px 10px", textAlign: "right" }}>
                    <button
                      onClick={() => openModal(u)}
                      style={{
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "1.2rem",
                        marginRight: "10px",
                      }}
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleDelete(u.id)}
                      style={{
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "1.2rem",
                      }}
                    >
                      🗑️
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {currentUser?.role !== "admin" && (
          <p
            style={{ color: "#ef4444", marginTop: "20px", fontSize: "0.9rem" }}
          >
            🔒 Solo el Administrador puede editar personal.
          </p>
        )}
      </div>

      {/* Modal CRUD */}
      {showModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            className="glass-panel"
            style={{ width: "500px", padding: "30px", position: "relative" }}
          >
            <h2 style={{ color: "var(--color-primary)", marginTop: 0 }}>
              {editingUser ? "Editar Empleado" : "Nuevo Empleado"}
            </h2>
            <form
              onSubmit={handleSave}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "15px",
                marginTop: "20px",
              }}
            >
              <div>
                <label
                  style={{
                    color: "var(--color-secondary)",
                    fontSize: "0.9rem",
                  }}
                >
                  Nombre Completo
                </label>
                <input
                  required
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  style={{
                    width: "100%",
                    padding: "10px",
                    background: "rgba(0,0,0,0.5)",
                    border: "1px solid var(--color-primary)",
                    color: "white",
                    borderRadius: "5px",
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: "15px" }}>
                <div style={{ flex: 1 }}>
                  <label
                    style={{
                      color: "var(--color-secondary)",
                      fontSize: "0.9rem",
                    }}
                  >
                    PIN de Acceso
                  </label>
                  <input
                    required
                    type="text"
                    value={formData.pin}
                    onChange={(e) =>
                      setFormData({ ...formData, pin: e.target.value })
                    }
                    style={{
                      width: "100%",
                      padding: "10px",
                      background: "rgba(0,0,0,0.5)",
                      border: "1px solid var(--color-primary)",
                      color: "white",
                      borderRadius: "5px",
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label
                    style={{
                      color: "var(--color-secondary)",
                      fontSize: "0.9rem",
                    }}
                  >
                    Rol
                  </label>
                  <select
                    value={formData.role}
                    onChange={(e) =>
                      setFormData({ ...formData, role: e.target.value })
                    }
                    style={{
                      width: "100%",
                      padding: "10px",
                      background: "rgba(0,0,0,0.5)",
                      border: "1px solid var(--color-primary)",
                      color: "white",
                      borderRadius: "5px",
                    }}
                  >
                    <option value="cajero">Cajero</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>
              </div>

              {formData.role === "cajero" && (
                <div
                  style={{
                    marginTop: "10px",
                    background: "rgba(255,255,255,0.05)",
                    padding: "15px",
                    borderRadius: "8px",
                  }}
                >
                  <label
                    style={{
                      color: "var(--color-secondary)",
                      fontSize: "0.9rem",
                      display: "block",
                      marginBottom: "10px",
                    }}
                  >
                    Permisos de Acceso (Módulos)
                  </label>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "10px",
                    }}
                  >
                    {Object.keys(formData.permissions).map((key) => (
                      <label
                        key={key}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          color: "white",
                          cursor: "pointer",
                          textTransform: "capitalize",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={(formData.permissions as any)[key]}
                          onChange={() => togglePermission(key)}
                          style={{ width: "18px", height: "18px" }}
                        />
                        {key}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
                <button
                  type="button"
                  onClick={closeModal}
                  style={{
                    flex: 1,
                    padding: "12px",
                    background: "transparent",
                    border: "1px solid #555",
                    color: "#fff",
                    borderRadius: "5px",
                    cursor: "pointer",
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary"
                  style={{
                    flex: 1,
                    padding: "12px",
                    borderRadius: "5px",
                    cursor: "pointer",
                  }}
                >
                  {loading ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    </ProtectedRoute>
  );
}
