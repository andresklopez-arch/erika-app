"use client";
import React, { createContext, useContext, useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

interface User {
  id: string;
  name: string;
  role: "admin" | "cajero";
  permissions?: Record<string, boolean>;
}

export interface BusinessSettings {
  target_utility: number;
  monthly_goals: number;
  config: Record<string, unknown>;
}

interface AuthContextType {
  currentUser: User | null;
  logout: () => void;
  businessSettings: BusinessSettings;
  updateBusinessSettings: (settings: Partial<BusinessSettings>) => Promise<boolean>;
  refreshSettings: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  logout: () => {},
  businessSettings: { target_utility: 30, monthly_goals: 0, config: {} },
  updateBusinessSettings: async () => false,
  refreshSettings: async () => {},
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

  const [businessSettings, setBusinessSettings] = useState<BusinessSettings>(() => {
    if (typeof window !== "undefined") {
      const sTarget = localStorage.getItem("ERIKA_TARGET_UTILITY");
      const sGoal = localStorage.getItem("ERIKA_MONTHLY_GOALS");
      return {
        target_utility: sTarget ? parseFloat(sTarget) : 30,
        monthly_goals: sGoal ? parseFloat(sGoal) : 0,
        config: {},
      };
    }
    return {
      target_utility: 30,
      monthly_goals: 0,
      config: {},
    };
  });

  const refreshSettings = async () => {
    try {
      const { data, error: dbError } = await supabase
        .from("business_settings")
        .select("target_utility, monthly_goals, config")
        .eq("id", "erika_global")
        .single();
      if (data && !dbError) {
        // Enforce types and validation rules (Zod-like validation)
        const target_utility = Math.max(0, Math.min(100, Number(data.target_utility) || 30));
        const monthly_goals = Math.max(0, Number(data.monthly_goals) || 0);
        const config = typeof data.config === "object" && data.config !== null ? data.config : {};
        
        setBusinessSettings({ target_utility, monthly_goals, config });
        localStorage.setItem("ERIKA_TARGET_UTILITY", String(target_utility));
        localStorage.setItem("ERIKA_MONTHLY_GOALS", String(monthly_goals));
      }
    } catch (e) {
      console.warn("Fallo al sincronizar business_settings:", e);
    }
  };

  const updateBusinessSettings = async (newSettings: Partial<BusinessSettings>): Promise<boolean> => {
    if (currentUser?.role !== "admin") {
      alert("❌ Acceso Denegado. Se requieren privilegios de Administrador para cambiar configuraciones.");
      return false;
    }

    try {
      const updated = {
        ...businessSettings,
        ...newSettings,
      };
      
      // Validation check (Zod-like schema enforcement)
      updated.target_utility = Math.max(0, Math.min(100, updated.target_utility));
      updated.monthly_goals = Math.max(0, updated.monthly_goals);

      const { error: dbError } = await supabase
        .from("business_settings")
        .upsert({
          id: "erika_global",
          target_utility: updated.target_utility,
          monthly_goals: updated.monthly_goals,
          config: updated.config,
          updated_at: new Date().toISOString()
        });

      if (!dbError) {
        setBusinessSettings(updated);
        localStorage.setItem("ERIKA_TARGET_UTILITY", String(updated.target_utility));
        localStorage.setItem("ERIKA_MONTHLY_GOALS", String(updated.monthly_goals));
        return true;
      } else {
        console.error("Error actualizando configuracion en Supabase:", dbError.message);
        return false;
      }
    } catch (e) {
      console.error("Fallo de red al actualizar configuracion:", e);
      return false;
    }
  };

  useEffect(() => {
    // Apply Theme
    const savedTheme = localStorage.getItem("ERIKA_THEME") || "dark";
    if (savedTheme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }

    const saved = localStorage.getItem("ERIKA_USER");
    if (saved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentUser(JSON.parse(saved));
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(false);

    // Initial config fetch
    refreshSettings();
  }, [currentUser]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const { data: user } = await supabase
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
    <AuthContext.Provider value={{ currentUser, logout, businessSettings, updateBusinessSettings, refreshSettings }}>
      {children}
    </AuthContext.Provider>
  );
}
