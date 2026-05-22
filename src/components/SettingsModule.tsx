"use client";
import React, { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

export default function SettingsModule() {
  const [voiceKeyword, setVoiceKeyword] = useState("erika");
  const [earnRate, setEarnRate] = useState("100"); // Gasta $100
  const [earnPoints, setEarnPoints] = useState("1"); // Gana 1 punto
  const [redeemRate, setRedeemRate] = useState("10"); // 10 puntos = $1 de descuento
  const [theme, setTheme] = useState("dark");
  const [wholesaleMinQty, setWholesaleMinQty] = useState("10");
  const [wholesaleDiscount, setWholesaleDiscount] = useState("10");

  const [businessName, setBusinessName] = useState("Ferretería ERIKA");
  const [businessRfc, setBusinessRfc] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [businessLogo, setBusinessLogo] = useState("");

  const [systemUsers, setSystemUsers] = useState<any[]>([]);
  const [newUserName, setNewUserName] = useState("");
  const [newUserPin, setNewUserPin] = useState("");
  const [newUserRole, setNewUserRole] = useState("cajero");

  const [isConnected, setIsConnected] = useState<boolean>(true);
  const [connectionType, setConnectionType] = useState<string>("system");

  useEffect(() => {
    const savedVoice = localStorage.getItem("ERIKA_VOICE_KEYWORD");
    if (savedVoice) setVoiceKeyword(savedVoice);

    const sEarnRate = localStorage.getItem("ERIKA_EARN_RATE");
    const sEarnPts = localStorage.getItem("ERIKA_EARN_PTS");
    const sRedeem = localStorage.getItem("ERIKA_REDEEM_RATE");
    const sTheme = localStorage.getItem("ERIKA_THEME");
    const sWholesaleQty = localStorage.getItem("ERIKA_WHOLESALE_QTY");
    const sWholesalePct = localStorage.getItem("ERIKA_WHOLESALE_PCT");
    
    const bName = localStorage.getItem("ERIKA_BIZ_NAME");
    const bRfc = localStorage.getItem("ERIKA_BIZ_RFC");
    const bPhone = localStorage.getItem("ERIKA_BIZ_PHONE");
    const bEmail = localStorage.getItem("ERIKA_BIZ_EMAIL");
    const bAddr = localStorage.getItem("ERIKA_BIZ_ADDR");
    const bLogo = localStorage.getItem("ERIKA_BIZ_LOGO");

    if (sEarnRate) setEarnRate(sEarnRate);
    if (sEarnPts) setEarnPoints(sEarnPts);
    if (sRedeem) setRedeemRate(sRedeem);
    if (sTheme) setTheme(sTheme);
    if (sWholesaleQty) setWholesaleMinQty(sWholesaleQty);
    if (sWholesalePct) setWholesaleDiscount(sWholesalePct);

    if (bName) setBusinessName(bName);
    if (bRfc) setBusinessRfc(bRfc);
    if (bPhone) setBusinessPhone(bPhone);
    if (bEmail) setBusinessEmail(bEmail);
    if (bAddr) setBusinessAddress(bAddr);
    if (bLogo) setBusinessLogo(bLogo);

    const savedConnected = localStorage.getItem("ERIKA_PRINTER_CONNECTED");
    const savedType = localStorage.getItem("ERIKA_PRINTER_TYPE");
    if (savedConnected !== null) setIsConnected(savedConnected !== "false");
    if (savedType) setConnectionType(savedType);

    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    const { data } = await supabase.from("users").select("*");
    if (data) setSystemUsers(data);
  };

  const saveConfig = () => {
    localStorage.setItem("ERIKA_VOICE_KEYWORD", voiceKeyword.toLowerCase());
    alert(
      "✅ Configuración guardada. El Cajero Inteligente de Voz pedirá esta palabra clave antes de ejecutar las órdenes de venta.",
    );
  };

  const saveLoyaltyConfig = () => {
    localStorage.setItem("ERIKA_EARN_RATE", earnRate);
    localStorage.setItem("ERIKA_EARN_PTS", earnPoints);
    localStorage.setItem("ERIKA_REDEEM_RATE", redeemRate);
    alert("✅ Tasas del Programa de Lealtad actualizadas.");
  };

  const saveWholesaleConfig = () => {
    localStorage.setItem("ERIKA_WHOLESALE_QTY", wholesaleMinQty);
    localStorage.setItem("ERIKA_WHOLESALE_PCT", wholesaleDiscount);
    alert("✅ Configuración de Mayoreo Automático guardada.");
  };

  const toggleTheme = (newTheme: string) => {
    setTheme(newTheme);
    localStorage.setItem("ERIKA_THEME", newTheme);
    if (newTheme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  };

  const saveBusinessProfile = () => {
    localStorage.setItem("ERIKA_BIZ_NAME", businessName);
    localStorage.setItem("ERIKA_BIZ_RFC", businessRfc);
    localStorage.setItem("ERIKA_BIZ_PHONE", businessPhone);
    localStorage.setItem("ERIKA_BIZ_EMAIL", businessEmail);
    localStorage.setItem("ERIKA_BIZ_ADDR", businessAddress);
    localStorage.setItem("ERIKA_BIZ_LOGO", businessLogo);
    alert("✅ Perfil del Negocio guardado exitosamente.");
  };

  const handleCreateUser = async () => {
     if (!newUserName || !newUserPin || newUserPin.length < 4) return alert("Ingresa un nombre y un PIN de 4 dígitos o más.");
     const { error } = await supabase.from("users").insert({ name: newUserName, pin: newUserPin, role: newUserRole });
     if (error) return alert("Error al crear usuario.");
     setNewUserName(""); setNewUserPin("");
     fetchUsers();
     alert("✅ Cajero/Usuario creado exitosamente.");
  };

  const handleDeleteUser = async (id: string, name: string) => {
     if (!window.confirm(`¿Estás seguro de eliminar al usuario ${name}?`)) return;
     await supabase.from("users").delete().eq("id", id);
     fetchUsers();
  };

  const togglePrinterConnection = () => {
    const nextVal = !isConnected;
    setIsConnected(nextVal);
    localStorage.setItem("ERIKA_PRINTER_CONNECTED", String(nextVal));
    
    // Broadcast a custom event so other modules (like POSModule) can react if they are active
    window.dispatchEvent(new Event("storage"));
  };

  const testPrint = () => {
    if (!isConnected) {
      alert("❌ Error: La impresora está desconectada. No se puede realizar la prueba.");
      return;
    }
    const printWindow = window.open("", "_blank", "width=300,height=400");
    if (!printWindow) {
      alert("❌ Error: Bloqueador de ventanas emergentes activado.");
      return;
    }
    const html = `
      <html><head><style>body { font-family: 'Courier New', monospace; font-size: 12px; margin: 0; padding: 10px; width: 58mm; color: #000; }</style></head>
      <body>
        <h3 style="text-align:center; margin:0 0 5px 0;">FERRETERÍA ERIKA</h3>
        <p style="text-align:center; margin:0 0 10px 0;">TICKET DE PRUEBA</p>
        <div style="border-bottom: 1px dashed #000; margin-bottom: 5px;"></div>
        <p style="text-align:center;">¡Impresora térmica configurada correctamente!</p>
        <p style="font-size:10px; text-align:center;">Fecha: ${new Date().toLocaleString()}</p>
        <div style="border-bottom: 1px dashed #000; margin-top: 5px;"></div>
      </body></html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 500);
  };

  return (
    <div
      className="animate-fade-in glass-panel"
      style={{ padding: "30px", maxWidth: "800px", margin: "0 auto" }}
    >
      <h2 style={{ color: "var(--color-primary)" }}>
        ⚙️ Configuración Global de ERIKA
      </h2>

      <div style={{ marginTop: "30px" }}>
        <h3 style={{ marginBottom: "10px", color: "var(--color-secondary)" }}>
          ☁️ Conexión Supabase (Nube)
        </h3>
        <p style={{ fontSize: "0.85rem", opacity: 0.7, marginBottom: "15px" }}>
          El paso final. Obtén estas credenciales al crear un proyecto en
          Supabase.com para iniciar la migración oficial.
        </p>

        <input
          type="text"
          placeholder="URL del Proyecto (ej. https://xxx.supabase.co)"
          disabled
          style={{
            width: "100%",
            padding: "12px",
            borderRadius: "8px",
            background: "rgba(255,255,255,0.05)",
            color: "white",
            border: "1px solid rgba(255,255,255,0.1)",
            marginBottom: "10px",
          }}
        />
        <input
          type="password"
          placeholder="Anon / Public Key"
          disabled
          style={{
            width: "100%",
            padding: "12px",
            borderRadius: "8px",
            background: "rgba(255,255,255,0.05)",
            color: "white",
            border: "1px solid rgba(255,255,255,0.1)",
            marginBottom: "20px",
          }}
        />

        <button
          className="btn-primary"
          disabled
          style={{ width: "100%", opacity: 0.5 }}
        >
          Conectar Nube (Pendiente)
        </button>
      </div>

      <div style={{ display: "flex", gap: "30px", flexWrap: "wrap", marginTop: "30px" }}>
        <div style={{ flex: 1, minWidth: "300px", display: "flex", flexDirection: "column", gap: "20px" }}>
          
          <div className="glass-panel">
            <h3 style={{ marginBottom: "10px" }}>
              🔐 Palabra Clave de Seguridad (Voz)
            </h3>
            <p style={{ fontSize: "0.85rem", opacity: 0.7, marginBottom: "15px" }}>
              El sistema de voz ignorará peticiones a menos que la persona que le
              hable incluya esta palabra en su frase.
            </p>

            <input
              type="text"
              value={voiceKeyword}
              onChange={(e) => setVoiceKeyword(e.target.value)}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "8px",
                background: "rgba(0,0,0,0.3)",
                color: "white",
                border: "1px solid var(--color-primary)",
                marginBottom: "20px",
              }}
            />

            <button
              className="btn-primary"
              onClick={saveConfig}
              style={{ width: "100%" }}
            >
              💾 Guardar Palabra de Seguridad
            </button>
          </div>

          <div className="glass-panel" style={{ border: "1px solid var(--color-secondary)" }}>
            <h3 style={{ margin: "0 0 20px 0", color: "var(--color-secondary)", display: "flex", alignItems: "center", gap: "10px" }}>
              🏢 Perfil del Negocio
            </h3>
            <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)", marginBottom: "15px" }}>
              Estos datos aparecerán en las cotizaciones impresas, PDFs y tickets de venta.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "15px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Nombre del Negocio:</label>
                <input type="text" value={businessName} onChange={e => setBusinessName(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "var(--color-text)" }} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>RFC:</label>
                <input type="text" value={businessRfc} onChange={e => setBusinessRfc(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "var(--color-text)" }} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "15px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Teléfono:</label>
                <input type="text" value={businessPhone} onChange={e => setBusinessPhone(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "var(--color-text)" }} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Correo Electrónico:</label>
                <input type="text" value={businessEmail} onChange={e => setBusinessEmail(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "var(--color-text)" }} />
              </div>
            </div>
            <div style={{ marginBottom: "15px" }}>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Dirección Física:</label>
              <textarea value={businessAddress} onChange={e => setBusinessAddress(e.target.value)} rows={2} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "var(--color-text)" }} />
            </div>
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>URL del Logotipo (Opcional):</label>
              <input type="text" placeholder="https://ejemplo.com/logo.png" value={businessLogo} onChange={e => setBusinessLogo(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "var(--color-text)" }} />
            </div>
            <button className="btn-primary" onClick={saveBusinessProfile} style={{ width: "100%", background: "transparent", border: "1px solid var(--color-secondary)", color: "var(--color-secondary)" }}>
              💾 Guardar Perfil
            </button>
          </div>

          <div className="glass-panel" style={{ border: "1px solid #eab308" }}>
            <h3 style={{ margin: "0 0 20px 0", color: "#eab308", display: "flex", alignItems: "center", gap: "10px" }}>
              ⭐ Tasas de Puntos de Lealtad
            </h3>
            <div style={{ marginBottom: "15px" }}>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Por cada $ de compra (Pesos):</label>
              <input type="number" value={earnRate} onChange={e => setEarnRate(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />
            </div>
            <div style={{ marginBottom: "15px" }}>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Se otorgan (Puntos):</label>
              <input type="number" value={earnPoints} onChange={e => setEarnPoints(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />
            </div>
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Puntos requeridos para $1.00 de descuento en caja:</label>
              <input type="number" value={redeemRate} onChange={e => setRedeemRate(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />
            </div>
            <button className="btn-primary" onClick={saveLoyaltyConfig} style={{ width: "100%", background: "transparent", border: "1px solid #eab308", color: "#eab308" }}>
              💾 Guardar Tasas de Lealtad
            </button>
          </div>

        </div>

          <div className="glass-panel" style={{ flex: 1, border: "1px solid #10b981", display: "flex", flexDirection: "column" }}>
            <h3 style={{ margin: "0 0 20px 0", color: "#10b981", display: "flex", alignItems: "center", gap: "10px" }}>
              👥 Gestión de Personal (Roles y Cajeros)
            </h3>
            <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)", marginBottom: "15px" }}>
              Crea cuentas de "Cajero" (sin permisos de borrar/devolver) o cuentas de "Admin" (control total).
            </p>
            
            <div style={{ display: "flex", gap: "10px", marginBottom: "15px", flexWrap: "wrap" }}>
               <input type="text" placeholder="Nombre (ej. Juan)" value={newUserName} onChange={e => setNewUserName(e.target.value)} style={{ flex: 1, padding: "8px", borderRadius: "6px", background: "rgba(0,0,0,0.3)", color: "white", border: "1px solid var(--glass-border)" }} />
               <input type="password" placeholder="PIN (ej. 4321)" value={newUserPin} onChange={e => setNewUserPin(e.target.value)} style={{ width: "100px", padding: "8px", borderRadius: "6px", background: "rgba(0,0,0,0.3)", color: "white", border: "1px solid var(--glass-border)" }} />
               <select value={newUserRole} onChange={e => setNewUserRole(e.target.value)} style={{ padding: "8px", borderRadius: "6px", background: "rgba(0,0,0,0.3)", color: "white", border: "1px solid var(--glass-border)" }}>
                 <option value="cajero">Cajero</option>
                 <option value="admin">Administrador</option>
               </select>
               <button className="btn-primary" onClick={handleCreateUser} style={{ background: "#10b981", border: "none" }}>+ Añadir</button>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "10px" }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                  <th style={{ padding: "10px", textAlign: "left" }}>Nombre</th>
                  <th style={{ padding: "10px", textAlign: "left" }}>Rol</th>
                  <th style={{ padding: "10px", textAlign: "center" }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                 {systemUsers.map(u => (
                   <tr key={u.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                     <td style={{ padding: "10px" }}>{u.name}</td>
                     <td style={{ padding: "10px" }}>
                       <span style={{ padding: "4px 8px", background: u.role === "admin" ? "rgba(16,185,129,0.2)" : "rgba(59,130,246,0.2)", color: u.role === "admin" ? "#10b981" : "#3b82f6", borderRadius: "4px", fontSize: "0.8rem" }}>{u.role.toUpperCase()}</span>
                     </td>
                     <td style={{ padding: "10px", textAlign: "center" }}>
                        <button onClick={() => handleDeleteUser(u.id, u.name)} style={{ background: "transparent", color: "#ef4444", border: "1px solid #ef4444", padding: "4px 8px", borderRadius: "4px", cursor: "pointer" }}>Eliminar</button>
                     </td>
                   </tr>
                 ))}
              </tbody>
            </table>
          </div>

          <div className="glass-panel" style={{ border: "1px solid #8b5cf6" }}>
            <h3 style={{ margin: "0 0 20px 0", color: "#10b981", display: "flex", alignItems: "center", gap: "10px" }}>
              🔑 Licencia del Sistema ERIKA
            </h3>
            
            <div style={{ background: "rgba(255,255,255,0.05)", padding: "15px", borderRadius: "8px", marginBottom: "15px" }}>
              <p style={{ margin: "0 0 5px 0", color: "var(--color-secondary)", fontSize: "0.9rem" }}>Estado de la Licencia</p>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ display: "inline-block", width: "12px", height: "12px", borderRadius: "50%", background: "#10b981" }}></span>
                <span style={{ fontSize: "1.2rem", fontWeight: "bold", color: "white" }}>Activa (Versión Ilimitada)</span>
              </div>
            </div>

            <div style={{ background: "rgba(255,255,255,0.05)", padding: "15px", borderRadius: "8px", marginBottom: "20px" }}>
              <p style={{ margin: "0 0 5px 0", color: "var(--color-secondary)", fontSize: "0.9rem" }}>Fecha de Vencimiento / Renovación</p>
              <p style={{ margin: 0, fontSize: "1.1rem", fontWeight: "bold", color: "white" }}>Licencia Vitalicia ♾️</p>
            </div>

            <div style={{ borderTop: "1px solid var(--glass-border)", paddingTop: "15px" }}>
              <label style={{ display: "block", marginBottom: "8px", color: "var(--color-secondary)", fontSize: "0.9rem" }}>Actualizar o Cambiar Clave de Producto</label>
              <div style={{ display: "flex", gap: "10px" }}>
                <input 
                  type="text" 
                  placeholder="XXXX-XXXX-XXXX-XXXX" 
                  style={{ flex: 1, padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "var(--color-text)", fontFamily: "monospace", textTransform: "uppercase" }} 
                />
                <button className="btn-primary" style={{ padding: "10px 20px" }}>
                  Validar
                </button>
              </div>
              <p style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.5)", marginTop: "10px", fontStyle: "italic" }}>* El módulo de licencias se encuentra en modo bypass actualmente.</p>
            </div>
          </div>
          
          <div className="glass-panel" style={{ border: "1px solid #3b82f6" }}>
            <h3 style={{ margin: "0 0 20px 0", color: "#3b82f6", display: "flex", alignItems: "center", gap: "10px" }}>
              🛒 Descuentos Automáticos por Mayoreo
            </h3>
            <div style={{ marginBottom: "15px" }}>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Cantidad Mínima para Mayoreo (piezas):</label>
              <input type="number" value={wholesaleMinQty} onChange={e => setWholesaleMinQty(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "var(--color-text)" }} />
            </div>
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.9rem" }}>Descuento a aplicar (%):</label>
              <input type="number" value={wholesaleDiscount} onChange={e => setWholesaleDiscount(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "var(--color-text)" }} />
            </div>
            <button className="btn-primary" onClick={saveWholesaleConfig} style={{ width: "100%", background: "transparent", border: "1px solid #3b82f6", color: "#3b82f6" }}>
              💾 Guardar Reglas de Mayoreo
            </button>
          </div>

          <div className="glass-panel" style={{ border: "1px solid var(--color-secondary)" }}>
            <h3 style={{ margin: "0 0 20px 0", color: "var(--color-secondary)", display: "flex", alignItems: "center", gap: "10px" }}>
              🖨️ Estado de Impresora Térmica
            </h3>
            <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)", marginBottom: "15px" }}>
              Configura y realiza pruebas de impresión con el controlador térmico del POS.
            </p>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.05)", padding: "10px", borderRadius: "8px" }}>
                <span style={{ fontSize: "0.9rem" }}>Conexión Física:</span>
                <span style={{ fontWeight: "bold", color: isConnected ? "var(--color-secondary)" : "#ef4444" }}>
                  {isConnected ? "🟢 Impresora Lista" : "🔴 Desconectada"}
                </span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.05)", padding: "10px", borderRadius: "8px" }}>
                <span style={{ fontSize: "0.9rem" }}>Canal de Conexión:</span>
                <span style={{ fontWeight: "bold", textTransform: "uppercase", color: "white" }}>
                  {connectionType}
                </span>
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                onClick={togglePrinterConnection}
                className="btn-primary"
                style={{
                  flex: 1,
                  background: isConnected ? "rgba(239, 68, 68, 0.15)" : "rgba(16, 185, 129, 0.15)",
                  border: isConnected ? "1px solid rgba(239, 68, 68, 0.3)" : "1px solid rgba(16, 185, 129, 0.3)",
                  fontSize: "0.85rem",
                  padding: "10px",
                }}
              >
                {isConnected ? "🔌 Simular Desconexión" : "🔌 Conectar Impresora"}
              </button>

              <button
                onClick={testPrint}
                className="btn-primary"
                style={{
                  flex: 1,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  fontSize: "0.85rem",
                  padding: "10px",
                }}
              >
                📄 Imprimir Prueba
              </button>
            </div>
          </div>

          <div className="glass-panel" style={{ border: "1px solid var(--color-primary)" }}>
            <h3 style={{ margin: "0 0 20px 0", display: "flex", alignItems: "center", gap: "10px" }}>
              🎨 Apariencia del Sistema
            </h3>
            <div style={{ display: "flex", gap: "10px" }}>
              <button 
                onClick={() => toggleTheme("dark")}
                style={{ flex: 1, padding: "15px", borderRadius: "8px", border: theme === "dark" ? "2px solid var(--color-primary)" : "1px solid var(--glass-border)", background: "#0a0a0f", color: "white", cursor: "pointer", fontWeight: "bold" }}
              >
                🌙 Modo Oscuro
              </button>
              <button 
                onClick={() => toggleTheme("light")}
                style={{ flex: 1, padding: "15px", borderRadius: "8px", border: theme === "light" ? "2px solid var(--color-primary)" : "1px solid var(--glass-border)", background: "#f8fafc", color: "#0f172a", cursor: "pointer", fontWeight: "bold" }}
              >
                ☀️ Modo Claro
              </button>
            </div>
          </div>
      </div>
    </div>
  );
}
