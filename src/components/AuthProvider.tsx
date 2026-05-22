"use client";
import React, { createContext, useContext, useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

interface User {
  id: string;
  name: string;
  role: "admin" | "cajero";
  permissions?: Record<string, boolean>;
}

interface AuthContextType {
  currentUser: User | null;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  logout: () => {},
});

export const useAuth = () => useContext(AuthContext);

export default function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("ERIKA_USER");
    if (saved) setCurrentUser(JSON.parse(saved));
    setIsLoading(false);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const { data: user, error: dbError } = await supabase
      .from("users")
      .select("*")
      .eq("pin", pinInput)
      .single();

    if (user) {
      setCurrentUser(user);
      localStorage.setItem("ERIKA_USER", JSON.stringify(user));
      setPinInput("");
    } else {
      setError("PIN Incorrecto");
    }
  };

  const logout = () => {
    setCurrentUser(null);
    localStorage.removeItem("ERIKA_USER");
  };

  if (isLoading)
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "black",
          color: "var(--color-primary)",
        }}
      >
        Cargando Seguridad...
      </div>
    );

  if (!currentUser) {
    return (
      <div
        style={{
          height: "100vh",
          width: "100vw",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#000",
          color: "white",
        }}
      >
        <div
          className="glass-panel"
          style={{ width: "350px", textAlign: "center", padding: "40px" }}
        >
          <img
            src="/erika_avatar.png"
            alt="ERIKA"
            style={{
              width: "80px",
              borderRadius: "50%",
              marginBottom: "20px",
              border: "2px solid var(--color-primary)",
            }}
          />
          <h2 style={{ color: "var(--color-primary)", marginBottom: "10px" }}>
            Acceso Restringido
          </h2>
          <p style={{ color: "var(--color-secondary)", marginBottom: "30px" }}>
            Ingresa tu PIN de Empleado
          </p>

          <form onSubmit={handleLogin}>
            <input
              type="password"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="****"
              style={{
                width: "100%",
                padding: "15px",
                fontSize: "2rem",
                textAlign: "center",
                letterSpacing: "10px",
                background: "rgba(0,0,0,0.5)",
                border: "1px solid var(--color-primary)",
                color: "white",
                borderRadius: "8px",
                marginBottom: "20px",
              }}
              autoFocus
            />
            {error && (
              <p style={{ color: "#ef4444", marginBottom: "15px" }}>{error}</p>
            )}
            <button
              type="submit"
              className="btn-primary"
              style={{ width: "100%", padding: "15px", fontSize: "1.2rem" }}
            >
              Desbloquear
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ currentUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
