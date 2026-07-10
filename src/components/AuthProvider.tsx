"use client";
import React, { createContext, useContext, useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { BusinessSettings, BusinessSettingsSchema, BusinessConfig } from "../lib/settingsSchema";
import { setOfflineSessionKey } from "../lib/offlineSync";

interface User {
  id: string;
  name: string;
  pin: string;
  role: "admin" | "cajero";
  permissions?: Record<string, boolean>;
}

interface AuthContextType {
  currentUser: User | null;
  logout: () => void;
  businessSettings: BusinessSettings;
  updateBusinessSettings: (settings: { target_utility?: number; monthly_goals?: number; config?: Partial<BusinessConfig> }) => Promise<boolean>;
  refreshSettings: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  logout: () => {},
  businessSettings: {
    target_utility: 30,
    monthly_goals: 0,
    config: {
      voice_keyword: "erika",
      earn_rate: 100,
      earn_points: 1,
      redeem_rate: 10,
      wholesale_min_qty: 10,
      wholesale_discount: 10,
      theme: "dark",
      business_name: "Ferretería ERIKA",
      business_rfc: "",
      business_phone: "",
      business_email: "",
      business_address: "",
      business_logo: "",
      printer_connected: true,
      printer_type: "system",
      printer_name: "",
      printer_paper_size: "80mm",
      printer_font_size: "normal",
      printer_font_family: "monospace",
      printer_fields: ["name", "rfc", "phone", "address", "logo", "footer"],
      printer_footer_msg: "¡Gracias por su compra!",
      printer_align: "center",
      printer_padding: "8",
      printer_margin_left: "0",
      printer_margin_right: "0",
      printer_margin_top: "0",
      printer_margin_bottom: "0",
      printer_zoom: "100",
      printer_double_copy_layaway_credit: false,
      printer_ble_chunk_size: 20,
      printer_enable_autocut: true,
      low_stock_threshold: 5,
      max_cajero_discount_pct: 5,
    },
  },
  updateBusinessSettings: async () => false,
  refreshSettings: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const useBusinessProfile = () => {
  const { businessSettings } = useAuth();
  const [profile, setProfile] = useState<any>({
    name: "Ferretería ERIKA",
    rfc: "",
    phone: "",
    email: "",
    address: "",
    logo: ""
  });

  useEffect(() => {
    if (businessSettings && businessSettings.config) {
      setProfile({
        name: businessSettings.config.business_name || "Ferretería ERIKA",
        rfc: businessSettings.config.business_rfc || "",
        phone: businessSettings.config.business_phone || "",
        email: businessSettings.config.business_email || "",
        address: businessSettings.config.business_address || "",
        logo: businessSettings.config.business_logo || ""
      });
    } else {
      setProfile({
        name: localStorage.getItem("ERIKA_BIZ_NAME") || "Ferretería ERIKA",
        rfc: localStorage.getItem("ERIKA_BIZ_RFC") || "",
        phone: localStorage.getItem("ERIKA_BIZ_PHONE") || "",
        email: localStorage.getItem("ERIKA_BIZ_EMAIL") || "",
        address: localStorage.getItem("ERIKA_BIZ_ADDR") || "",
        logo: localStorage.getItem("ERIKA_BIZ_LOGO") || ""
      });
    }
  }, [businessSettings]);

  return profile;
};

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
      
      const config = {
        voice_keyword: localStorage.getItem("ERIKA_VOICE_KEYWORD") || "erika",
        earn_rate: Number(localStorage.getItem("ERIKA_EARN_RATE")) || 100,
        earn_points: Number(localStorage.getItem("ERIKA_EARN_PTS")) || 1,
        redeem_rate: Number(localStorage.getItem("ERIKA_REDEEM_RATE")) || 10,
        wholesale_min_qty: Number(localStorage.getItem("ERIKA_WHOLESALE_QTY")) || 10,
        wholesale_discount: Number(localStorage.getItem("ERIKA_WHOLESALE_PCT")) || 10,
        theme: localStorage.getItem("ERIKA_THEME") || "dark",
        business_name: localStorage.getItem("ERIKA_BIZ_NAME") || "Ferretería ERIKA",
        business_rfc: localStorage.getItem("ERIKA_BIZ_RFC") || "",
        business_phone: localStorage.getItem("ERIKA_BIZ_PHONE") || "",
        business_email: localStorage.getItem("ERIKA_BIZ_EMAIL") || "",
        business_address: localStorage.getItem("ERIKA_BIZ_ADDR") || "",
        business_logo: localStorage.getItem("ERIKA_BIZ_LOGO") || "",
        printer_connected: localStorage.getItem("ERIKA_PRINTER_CONNECTED") !== "false",
        printer_type: localStorage.getItem("ERIKA_PRINTER_TYPE") || "system",
        printer_name: localStorage.getItem("ERIKA_PRINTER_NAME") || "",
        printer_paper_size: localStorage.getItem("ERIKA_PRINTER_PAPER_SIZE") || "80mm",
        printer_font_size: localStorage.getItem("ERIKA_PRINTER_FONT_SIZE") || "normal",
        printer_font_family: localStorage.getItem("ERIKA_PRINTER_FONT_FAMILY") || "monospace",
        printer_fields: localStorage.getItem("ERIKA_PRINTER_FIELDS") ? JSON.parse(localStorage.getItem("ERIKA_PRINTER_FIELDS")!) : ["name", "rfc", "phone", "address", "logo", "footer"],
        printer_footer_msg: localStorage.getItem("ERIKA_PRINTER_FOOTER_MSG") || "¡Gracias por su compra!",
        printer_align: localStorage.getItem("ERIKA_PRINTER_ALIGN") || "center",
        printer_padding: localStorage.getItem("ERIKA_PRINTER_PADDING") || "8",
        printer_margin_left: localStorage.getItem("ERIKA_PRINTER_MARGIN_LEFT") || "0",
        printer_margin_right: localStorage.getItem("ERIKA_PRINTER_MARGIN_RIGHT") || "0",
        printer_margin_top: localStorage.getItem("ERIKA_PRINTER_MARGIN_TOP") || "0",
        printer_margin_bottom: localStorage.getItem("ERIKA_PRINTER_MARGIN_BOTTOM") || "0",
        printer_zoom: localStorage.getItem("ERIKA_PRINTER_ZOOM") || "100",
        printer_double_copy_layaway_credit: localStorage.getItem("ERIKA_PRINTER_DOUBLE_COPY") === "true",
        printer_ble_chunk_size: Number(localStorage.getItem("ERIKA_PRINTER_BLE_CHUNK_SIZE")) || 20,
        printer_enable_autocut: localStorage.getItem("ERIKA_PRINTER_ENABLE_AUTOCUT") !== "false",
        low_stock_threshold: Number(localStorage.getItem("ERIKA_LOW_STOCK_THRESHOLD")) || 5,
        max_cajero_discount_pct: Number(localStorage.getItem("ERIKA_MAX_CAJERO_DISCOUNT_PCT")) || 5,
      };

      return {
        target_utility: sTarget ? parseFloat(sTarget) : 30,
        monthly_goals: sGoal ? parseFloat(sGoal) : 0,
        config,
      };
    }
    return {
      target_utility: 30,
      monthly_goals: 0,
      config: {
        voice_keyword: "erika",
        earn_rate: 100,
        earn_points: 1,
        redeem_rate: 10,
        wholesale_min_qty: 10,
        wholesale_discount: 10,
        theme: "dark",
        business_name: "Ferretería ERIKA",
        business_rfc: "",
        business_phone: "",
        business_email: "",
        business_address: "",
        business_logo: "",
        printer_connected: true,
        printer_type: "system",
        printer_name: "",
        printer_paper_size: "80mm",
        printer_font_size: "normal",
        printer_font_family: "monospace",
        printer_fields: ["name", "rfc", "phone", "address", "logo", "footer"],
        printer_footer_msg: "¡Gracias por su compra!",
        printer_align: "center",
        printer_padding: "8",
        printer_margin_left: "0",
        printer_margin_right: "0",
        printer_margin_top: "0",
        printer_margin_bottom: "0",
        printer_zoom: "100",
        printer_double_copy_layaway_credit: false,
        printer_ble_chunk_size: 20,
        printer_enable_autocut: true,
        low_stock_threshold: 5,
        max_cajero_discount_pct: 5,
      },
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
        // Enforce types and validation rules using Zod Schema
        const parsed = BusinessSettingsSchema.parse({
          target_utility: Number(data.target_utility),
          monthly_goals: Number(data.monthly_goals),
          config: data.config,
        });
        
        setBusinessSettings(parsed);
        
        // Write the parsed values to localStorage for compatibility/fallback
        localStorage.setItem("ERIKA_TARGET_UTILITY", String(parsed.target_utility));
        localStorage.setItem("ERIKA_MONTHLY_GOALS", String(parsed.monthly_goals));
        localStorage.setItem("ERIKA_VOICE_KEYWORD", parsed.config.voice_keyword);
        localStorage.setItem("ERIKA_EARN_RATE", String(parsed.config.earn_rate));
        localStorage.setItem("ERIKA_EARN_PTS", String(parsed.config.earn_points));
        localStorage.setItem("ERIKA_REDEEM_RATE", String(parsed.config.redeem_rate));
        localStorage.setItem("ERIKA_WHOLESALE_QTY", String(parsed.config.wholesale_min_qty));
        localStorage.setItem("ERIKA_WHOLESALE_PCT", String(parsed.config.wholesale_discount));
        localStorage.setItem("ERIKA_BIZ_NAME", parsed.config.business_name);
        localStorage.setItem("ERIKA_BIZ_RFC", parsed.config.business_rfc);
        localStorage.setItem("ERIKA_BIZ_PHONE", parsed.config.business_phone);
        localStorage.setItem("ERIKA_BIZ_EMAIL", parsed.config.business_email);
        localStorage.setItem("ERIKA_BIZ_ADDR", parsed.config.business_address);
        localStorage.setItem("ERIKA_BIZ_LOGO", parsed.config.business_logo);
        localStorage.setItem("ERIKA_PRINTER_CONNECTED", String(parsed.config.printer_connected));
        localStorage.setItem("ERIKA_PRINTER_TYPE", parsed.config.printer_type);
        localStorage.setItem("ERIKA_PRINTER_NAME", parsed.config.printer_name || "");
        localStorage.setItem("ERIKA_PRINTER_PAPER_SIZE", parsed.config.printer_paper_size || "80mm");
        localStorage.setItem("ERIKA_PRINTER_FONT_SIZE", parsed.config.printer_font_size || "normal");
        localStorage.setItem("ERIKA_PRINTER_FONT_FAMILY", parsed.config.printer_font_family || "monospace");
        localStorage.setItem("ERIKA_PRINTER_FIELDS", JSON.stringify(parsed.config.printer_fields));
        localStorage.setItem("ERIKA_PRINTER_FOOTER_MSG", parsed.config.printer_footer_msg || "¡Gracias por su compra!");
        localStorage.setItem("ERIKA_PRINTER_ALIGN", parsed.config.printer_align || "center");
        localStorage.setItem("ERIKA_PRINTER_PADDING", parsed.config.printer_padding || "8");
        localStorage.setItem("ERIKA_THEME", parsed.config.theme);
      }
    } catch (e) {
      console.warn("Fallo al sincronizar business_settings:", e);
    }
  };

  const updateBusinessSettings = async (newSettings: { target_utility?: number; monthly_goals?: number; config?: Partial<BusinessConfig> }): Promise<boolean> => {
    if (currentUser?.role !== "admin") {
      alert("❌ Acceso Denegado. Se requieren privilegios de Administrador para cambiar configuraciones.");
      return false;
    }

    try {
      const updatedConfig = {
        ...businessSettings.config,
        ...(newSettings.config || {}),
      };

      // Cast strings to numbers where required
      const numKeys = ["earn_rate", "earn_points", "redeem_rate", "wholesale_min_qty", "wholesale_discount"];
      numKeys.forEach((key) => {
        if (key in updatedConfig) {
          (updatedConfig as any)[key] = Number((updatedConfig as any)[key]);
        }
      });

      const updated = {
        ...businessSettings,
        ...newSettings,
        target_utility: newSettings.target_utility !== undefined ? Number(newSettings.target_utility) : businessSettings.target_utility,
        monthly_goals: newSettings.monthly_goals !== undefined ? Number(newSettings.monthly_goals) : businessSettings.monthly_goals,
        config: updatedConfig
      };

      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          adminPin: currentUser.pin,
          settings: updated,
        }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        setBusinessSettings(result.settings);
        
        // Write the parsed values to localStorage for compatibility/fallback
        localStorage.setItem("ERIKA_TARGET_UTILITY", String(result.settings.target_utility));
        localStorage.setItem("ERIKA_MONTHLY_GOALS", String(result.settings.monthly_goals));
        localStorage.setItem("ERIKA_VOICE_KEYWORD", result.settings.config.voice_keyword);
        localStorage.setItem("ERIKA_EARN_RATE", String(result.settings.config.earn_rate));
        localStorage.setItem("ERIKA_EARN_PTS", String(result.settings.config.earn_points));
        localStorage.setItem("ERIKA_REDEEM_RATE", String(result.settings.config.redeem_rate));
        localStorage.setItem("ERIKA_WHOLESALE_QTY", String(result.settings.config.wholesale_min_qty));
        localStorage.setItem("ERIKA_WHOLESALE_PCT", String(result.settings.config.wholesale_discount));
        localStorage.setItem("ERIKA_BIZ_NAME", result.settings.config.business_name);
        localStorage.setItem("ERIKA_BIZ_RFC", result.settings.config.business_rfc);
        localStorage.setItem("ERIKA_BIZ_PHONE", result.settings.config.business_phone);
        localStorage.setItem("ERIKA_BIZ_EMAIL", result.settings.config.business_email);
        localStorage.setItem("ERIKA_BIZ_ADDR", result.settings.config.business_address);
        localStorage.setItem("ERIKA_BIZ_LOGO", result.settings.config.business_logo);
        localStorage.setItem("ERIKA_PRINTER_CONNECTED", String(result.settings.config.printer_connected));
        localStorage.setItem("ERIKA_PRINTER_TYPE", result.settings.config.printer_type);
        localStorage.setItem("ERIKA_PRINTER_NAME", result.settings.config.printer_name || "");
        localStorage.setItem("ERIKA_PRINTER_PAPER_SIZE", result.settings.config.printer_paper_size || "80mm");
        localStorage.setItem("ERIKA_PRINTER_FONT_SIZE", result.settings.config.printer_font_size || "normal");
        localStorage.setItem("ERIKA_PRINTER_FONT_FAMILY", result.settings.config.printer_font_family || "monospace");
        localStorage.setItem("ERIKA_PRINTER_FIELDS", JSON.stringify(result.settings.config.printer_fields));
        localStorage.setItem("ERIKA_PRINTER_FOOTER_MSG", result.settings.config.printer_footer_msg || "¡Gracias por su compra!");
        localStorage.setItem("ERIKA_PRINTER_ALIGN", result.settings.config.printer_align || "center");
        localStorage.setItem("ERIKA_PRINTER_PADDING", result.settings.config.printer_padding || "8");
        localStorage.setItem("ERIKA_THEME", result.settings.config.theme);
        localStorage.setItem("ERIKA_LOW_STOCK_THRESHOLD", String(result.settings.config.low_stock_threshold || 5));
        localStorage.setItem("ERIKA_MAX_CAJERO_DISCOUNT_PCT", String(result.settings.config.max_cajero_discount_pct || 5));
        
        return true;
      } else {
        alert(`❌ Error al guardar configuraciones: ${result.error || "Desconocido"}`);
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
      const user = JSON.parse(saved);
      setCurrentUser(user);
      setOfflineSessionKey(user.id, user.pin);
    }
    setIsLoading(false);

    // Initial config fetch
    refreshSettings();
  }, []);

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
      setOfflineSessionKey(user.id, user.pin);
      localStorage.setItem("ERIKA_USER", JSON.stringify(user));
      setPinInput("");
    } else {
      setError("PIN Incorrecto");
    }
  };

  const logout = () => {
    setCurrentUser(null);
    setOfflineSessionKey("", "");
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
