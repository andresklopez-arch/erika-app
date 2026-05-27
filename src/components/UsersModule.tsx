"use client";
import { useState } from "react";

interface UserProfile {
  id: string;
  type: "cliente" | "proveedor";
  name: string;
  phone: string;
  creditLimit: number;
  currentBalance: number;
  history: string[];
}

const MOCK_USERS: UserProfile[] = [
  {
    id: "1",
    type: "cliente",
    name: "Constructora Alfa",
    phone: "555-0101",
    creditLimit: 50000,
    currentBalance: -15000,
    history: ["Compró 20 bultos de cemento", "Abonó $5,000"],
  },
  {
    id: "2",
    type: "cliente",
    name: "Don Pepe (Pintor)",
    phone: "555-0202",
    creditLimit: 5000,
    currentBalance: 0,
    history: ["Compró 2 cubetas de pintura"],
  },
  {
    id: "3",
    type: "proveedor",
    name: "Aceros de México",
    phone: "555-0303",
    creditLimit: 0,
    currentBalance: -120000,
    history: ["Entregó 1 tonelada de varilla"],
  },
];

export default function UsersModule() {
  const [users] = useState<UserProfile[]>(MOCK_USERS);
  const [filter, setFilter] = useState<"todos" | "cliente" | "proveedor">(
    "todos",
  );

  const filteredUsers = users.filter(
    (u) => filter === "todos" || u.type === filter,
  );

  return (
    <div
      className="animate-fade-in"
      style={{ display: "flex", flexDirection: "column", gap: "20px" }}
    >
      <div className="glass-panel flex-between">
        <div style={{ display: "flex", gap: "15px" }}>
          <button
            className={`btn-primary`}
            style={{ opacity: filter === "todos" ? 1 : 0.4 }}
            onClick={() => setFilter("todos")}
          >
            Todos
          </button>
          <button
            className={`btn-primary`}
            style={{ opacity: filter === "cliente" ? 1 : 0.4 }}
            onClick={() => setFilter("cliente")}
          >
            Clientes
          </button>
          <button
            className={`btn-primary`}
            style={{ opacity: filter === "proveedor" ? 1 : 0.4 }}
            onClick={() => setFilter("proveedor")}
          >
            Proveedores
          </button>
        </div>
        <button
          className="btn-primary"
          style={{
            background: "transparent",
            border: "1px solid var(--color-primary)",
          }}
        >
          + Nuevo Registro
        </button>
      </div>

      <div className="grid-cols-2">
        {filteredUsers.map((user) => (
          <div
            key={user.id}
            className="glass-panel"
            style={{
              borderLeft:
                user.type === "cliente"
                  ? "4px solid var(--color-secondary)"
                  : "4px solid var(--color-accent)",
            }}
          >
            <div className="flex-between" style={{ marginBottom: "10px" }}>
              <h3 style={{ margin: 0 }}>{user.name}</h3>
              <span
                style={{
                  fontSize: "0.8rem",
                  background: "rgba(255,255,255,0.1)",
                  padding: "4px 8px",
                  borderRadius: "4px",
                }}
              >
                {user.type.toUpperCase()}
              </span>
            </div>
            <p style={{ color: "rgba(255,255,255,0.6)", marginBottom: "15px" }}>
              📞 {user.phone}
            </p>

            <div
              style={{
                background: "rgba(0,0,0,0.3)",
                padding: "15px",
                borderRadius: "8px",
                marginBottom: "15px",
              }}
            >
              <div className="flex-between" style={{ marginBottom: "5px" }}>
                <span>Balance de Cuenta:</span>
                <strong
                  style={{
                    color:
                      user.currentBalance < 0
                        ? "var(--color-primary)"
                        : "var(--color-secondary)",
                  }}
                >
                  ${Math.abs(user.currentBalance).toFixed(2)}{" "}
                  {user.currentBalance < 0 ? "(Deuda)" : "(A favor)"}
                </strong>
              </div>
              {user.type === "cliente" && (
                <div className="flex-between">
                  <span>Límite de Crédito:</span>
                  <span>${user.creditLimit.toFixed(2)}</span>
                </div>
              )}
            </div>

            <div>
              <h4
                style={{
                  marginBottom: "10px",
                  fontSize: "0.9rem",
                  color: "var(--color-secondary)",
                }}
              >
                Últimos Movimientos
              </h4>
              <ul
                style={{
                  listStyle: "none",
                  fontSize: "0.85rem",
                  color: "rgba(255,255,255,0.8)",
                }}
              >
                {user.history.map((h, i) => (
                  <li
                    key={i}
                    style={{
                      padding: "5px 0",
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                    }}
                  >
                    • {h}
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "15px" }}>
              <button
                className="btn-primary"
                style={{ flex: 1, padding: "8px", fontSize: "0.9rem" }}
              >
                Registrar Pago
              </button>
              <button
                className="btn-primary"
                style={{
                  flex: 1,
                  padding: "8px",
                  fontSize: "0.9rem",
                  background: "var(--glass-bg)",
                  border: "1px solid white",
                }}
              >
                Ver Historial
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
