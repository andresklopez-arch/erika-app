"use client";
import React from "react";
import { useAuth } from "./AuthProvider";

interface ProtectedRouteProps {
  children: React.ReactNode;
  permission: string;
}

export default function ProtectedRoute({ children, permission }: ProtectedRouteProps) {
  const { currentUser, logout } = useAuth();

  if (!currentUser) {
    return (
      <div
        style={{
          height: "80vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-primary)",
        }}
      >
        Cargando Permisos...
      </div>
    );
  }

  const isAdmin = currentUser.role === "admin";
  const hasPermission = permission.split(',').some(p => currentUser.permissions?.[p.trim()] === true);

  if (!isAdmin && !hasPermission) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "75vh",
          padding: "20px",
        }}
      >
        <div
          className="glass-panel"
          style={{
            maxWidth: "450px",
            width: "100%",
            textAlign: "center",
            padding: "40px",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            background: "linear-gradient(135deg, rgba(239, 68, 68, 0.05), rgba(0, 0, 0, 0.8))",
            boxShadow: "0 8px 32px 0 rgba(239, 68, 68, 0.1)",
          }}
        >
          <div
            style={{
              fontSize: "4.5rem",
              marginBottom: "20px",
              animation: "pulse 2s infinite",
              color: "#ef4444",
            }}
          >
            🔒
          </div>
          <h2
            style={{
              color: "#ef4444",
              marginBottom: "15px",
              fontSize: "1.8rem",
              fontWeight: "700",
              letterSpacing: "-0.025em",
            }}
          >
            Acceso Restringido
          </h2>
          <p
            style={{
              color: "rgba(255, 255, 255, 0.7)",
              marginBottom: "30px",
              lineHeight: "1.6",
              fontSize: "1rem",
            }}
          >
            Lo sentimos, tu usuario (<strong>{currentUser.name}</strong>) con rol de{" "}
            <span
              style={{
                background: "rgba(239, 68, 68, 0.2)",
                padding: "2px 6px",
                borderRadius: "4px",
                color: "#fca5a5",
                fontSize: "0.9rem",
              }}
            >
              {currentUser.role.toUpperCase()}
            </span>{" "}
            no cuenta con el permiso de <strong>{permission.toUpperCase()}</strong> necesario para ver esta sección.
          </p>

          <div
            style={{
              display: "flex",
              gap: "15px",
              justifyContent: "center",
            }}
          >
            <a
              href="/"
              className="btn-primary"
              style={{
                textDecoration: "none",
                display: "inline-block",
                padding: "12px 24px",
                fontSize: "0.95rem",
                borderRadius: "6px",
                background: "var(--color-primary)",
                color: "black",
                fontWeight: "bold",
                transition: "all 0.3s ease",
              }}
            >
              Ir a Punto de Venta
            </a>
            <button
              onClick={logout}
              className="btn-primary"
              style={{
                padding: "12px 24px",
                fontSize: "0.95rem",
                borderRadius: "6px",
                background: "transparent",
                border: "1px solid #ef4444",
                color: "#ef4444",
                cursor: "pointer",
                fontWeight: "bold",
                transition: "all 0.3s ease",
              }}
            >
              Cambiar PIN
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
