"use client";
import { useState, useEffect } from "react";
import { useAuth } from "./AuthProvider";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../lib/supabaseClient";

export default function Sidebar() {
  const { currentUser } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const [pendingLayawaysCount, setPendingLayawaysCount] = useState(0);
  const [pendingQuotesCount, setPendingQuotesCount] = useState(0);
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);
  const [escHiddenGroup, setEscHiddenGroup] = useState<string | null>(null);
  const [isPinned, setIsPinned] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("erika_sidebar_pinned") === "true";
    }
    return false;
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("erika_sidebar_pinned", String(isPinned));
    }
  }, [isPinned]);

  useEffect(() => {
    if (!currentUser) return;

    const fetchCounts = async () => {
      try {
        const todayStr = new Date().toISOString().split("T")[0];

        // Fetch layaways count: pending and due_date <= today
        const { count: layawayCount } = await supabase
          .from("layaways")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending")
          .lte("due_date", todayStr);

        if (layawayCount !== null) setPendingLayawaysCount(layawayCount);

        // Fetch quotes count: pending status
        const { count: quoteCount } = await supabase
          .from("quotes")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending");

        if (quoteCount !== null) setPendingQuotesCount(quoteCount);
      } catch (error) {
        console.error("Error fetching sidebar counts:", error);
      }
    };

    fetchCounts();

    const interval = setInterval(fetchCounts, 60000);
    return () => clearInterval(interval);
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;

    const isAdmin = currentUser.role === "admin";
    const p = currentUser.permissions || {};

    const menuOptions = [
      { id: "1", path: "/", allowed: isAdmin || p.pos },
      { id: "2", path: "/dashboard", allowed: isAdmin || p.dashboard || p.reportes },
      { id: "3", path: "/caja", allowed: isAdmin || p.caja },
      { id: "4", path: "/clientes", allowed: isAdmin || p.servicios || p.pos || p.inventario },
      { id: "5", path: "/inventario", allowed: isAdmin || p.inventario },
      { id: "6", path: "/configuracion", allowed: isAdmin || p.configuracion },
      { id: "7", path: "/clientes", allowed: isAdmin || p.pos || p.inventario },
    ];

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (hoveredGroup) {
          setEscHiddenGroup(hoveredGroup);
          return;
        }
      }

      const activeEl = document.activeElement;
      if (activeEl) {
        const tagName = activeEl.tagName.toLowerCase();
        const isEditable = activeEl.getAttribute("contenteditable") === "true";
        if (
          tagName === "input" ||
          tagName === "textarea" ||
          tagName === "select" ||
          isEditable
        ) {
          return;
        }
      }

      if (e.altKey && !e.ctrlKey && !e.shiftKey) {
        const num = e.key;
        const option = menuOptions.find((o) => o.id === num);
        if (option && option.allowed) {
          e.preventDefault();

          // Guarda de seguridad: Advertencia de pérdida de datos
          if (pathname !== option.path && typeof window !== "undefined" && (window as Window & { __ERIKA_HAS_ACTIVE_CART__?: boolean }).__ERIKA_HAS_ACTIVE_CART__) {
            const confirmLeave = window.confirm(
              "⚠️ Tienes productos en el carrito. Si sales de esta pantalla se cancelará la venta actual. ¿Deseas continuar?"
            );
            if (!confirmLeave) return;
          }

          // Feedback visual: Animación flash
          const linkEl = document.querySelector(`.sidebar-container a[href="${option.path}"]`);
          if (linkEl) {
            linkEl.classList.add("flash-nav");
            setTimeout(() => {
              linkEl.classList.remove("flash-nav");
            }, 400);
          }

          router.push(option.path);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentUser, router, pathname, hoveredGroup]);

  if (!currentUser) return null;

  const isAdmin = currentUser.role === "admin";
  const p = currentUser.permissions || {};

  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === "/";
    }
    return pathname ? pathname.startsWith(href) : false;
  };

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, targetPath: string) => {
    if (pathname === targetPath) return;
    if (typeof window !== "undefined" && (window as Window & { __ERIKA_HAS_ACTIVE_CART__?: boolean }).__ERIKA_HAS_ACTIVE_CART__) {
      const confirmLeave = window.confirm(
        "⚠️ Tienes productos en el carrito. Si sales de esta pantalla se cancelará la venta actual. ¿Deseas continuar?"
      );
      if (!confirmLeave) {
        e.preventDefault();
      }
    }
  };

  return (
    <aside className={`glass-panel sidebar-container ${isPinned ? "pinned" : ""}`} style={{ padding: "15px 8px" }}>
      <div className="menu-header" style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <img 
            src="/erika_avatar.png" 
            alt="YoY IA ERIKA Logo" 
            style={{ 
              width: "28px", 
              height: "28px", 
              borderRadius: "50%", 
              border: "1px solid var(--color-primary)",
              boxShadow: "0 0 8px rgba(16, 185, 129, 0.2)",
              objectFit: "cover"
            }}
          />
          <span className="nav-text" style={{ fontSize: "0.8rem", fontWeight: "bold", color: "var(--color-primary)", textTransform: "uppercase" }}>
            YoY IA ERIKA
          </span>
        </div>
        <button 
          onClick={() => setIsPinned(!isPinned)} 
          title={isPinned ? "Desfijar Menú" : "Fijar Menú Abierto"} 
          style={{ 
            background: "transparent", 
            border: "none", 
            cursor: "pointer", 
            fontSize: "1.1rem", 
            padding: "4px", 
            color: isPinned ? "var(--color-primary)" : "var(--color-text)",
            opacity: 0.7,
            transition: "all 0.2s",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center"
          }}
          onMouseEnter={(e) => e.currentTarget.style.opacity = "1"}
          onMouseLeave={(e) => e.currentTarget.style.opacity = "0.7"}
        >
          {isPinned ? "📌" : "📍"}
        </button>
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: "4px", width: "100%" }}>
        {(isAdmin || p.pos) && (
          <Link
            href="/"
            className={isActive("/") ? "active" : ""}
            onClick={(e) => handleLinkClick(e, "/")}
            title="Punto de Venta (Alt + 1)"
          >
            <span className="icon">🛒</span>
            <span className="nav-text">Punto de Venta</span>
            <span className="shortcut-badge">Alt + 1</span>
          </Link>
        )}
        {(isAdmin || p.dashboard || p.reportes) && (
          <Link
            href="/dashboard"
            className={isActive("/dashboard") ? "active" : ""}
            onClick={(e) => handleLinkClick(e, "/dashboard")}
            title="Dashboard e Inteligencia (Alt + 2)"
          >
            <span className="icon">📊</span>
            <span className="nav-text">Dashboard e Inteligencia</span>
            <span className="shortcut-badge">Alt + 2</span>
          </Link>
        )}
        {(isAdmin || p.caja) && (
          <Link
            href="/caja"
            className={isActive("/caja") ? "active" : ""}
            onClick={(e) => handleLinkClick(e, "/caja")}
            title="Arqueo de Caja (Alt + 3)"
          >
            <span className="icon">💵</span>
            <span className="nav-text">Arqueo de Caja</span>
            <span className="shortcut-badge">Alt + 3</span>
          </Link>
        )}
        {(isAdmin || p.pos || p.inventario || p.servicios) && (
          <div 
            className="nav-item-group" 
            style={{ position: "relative" }}
            onMouseEnter={() => setHoveredGroup("clientes")}
            onMouseLeave={() => {
              setHoveredGroup(null);
              setEscHiddenGroup(null);
            }}
          >
            <Link
              href="/clientes"
              className={isActive("/clientes") ? "active" : ""}
              onClick={(e) => handleLinkClick(e, "/clientes")}
              title="Clientes y Agenda (Alt + 7)"
            >
              <span className="icon">👥</span>
              <span className="nav-text">Clientes y Agenda</span>
              <span className="shortcut-badge">Alt + 7</span>
            </Link>
            <div className={`submenu-container ${escHiddenGroup === "clientes" ? "force-hidden" : ""}`}>
              <Link href="/clientes" style={{ color: "var(--color-text-muted)", display: "flex", gap: "6px", padding: "4px" }}>
                <span>👥</span><span>Clientes y Crédito</span>
              </Link>
              <Link href="/clientes?tab=apartados" style={{ color: "var(--color-text-muted)", display: "flex", gap: "6px", padding: "4px", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                <div style={{ display: "flex", gap: "6px" }}>
                  <span>📦</span><span>Apartados</span>
                </div>
                {pendingLayawaysCount > 0 && (
                  <span style={{
                    background: "#ef4444",
                    color: "white",
                    fontSize: "0.7rem",
                    fontWeight: "bold",
                    padding: "2px 6px",
                    borderRadius: "10px",
                    lineHeight: "1",
                    marginRight: "6px"
                  }}>
                    {pendingLayawaysCount}
                  </span>
                )}
              </Link>
              <Link href="/clientes?tab=presupuestos" style={{ color: "var(--color-text-muted)", display: "flex", gap: "6px", padding: "4px", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                <div style={{ display: "flex", gap: "6px" }}>
                  <span>📄</span><span>Presupuestos</span>
                </div>
                {pendingQuotesCount > 0 && (
                  <span style={{
                    background: "#eab308",
                    color: "black",
                    fontSize: "0.7rem",
                    fontWeight: "bold",
                    padding: "2px 6px",
                    borderRadius: "10px",
                    lineHeight: "1",
                    marginRight: "6px"
                  }}>
                    {pendingQuotesCount}
                  </span>
                )}
              </Link>
              <Link href="/clientes?tab=agenda" style={{ color: "var(--color-text-muted)", display: "flex", gap: "6px", padding: "4px" }}>
                <span>📅</span><span>Agenda de Servicios</span>
              </Link>
            </div>
          </div>
        )}

        {(isAdmin || p.inventario) && (
          <div 
            className="nav-item-group" 
            style={{ position: "relative" }}
            onMouseEnter={() => setHoveredGroup("inventario")}
            onMouseLeave={() => {
              setHoveredGroup(null);
              setEscHiddenGroup(null);
            }}
          >
            <Link
              href="/inventario"
              className={isActive("/inventario") ? "active" : ""}
              onClick={(e) => handleLinkClick(e, "/inventario")}
              title="Almacén e Inventario (Alt + 5)"
            >
              <span className="icon">📦</span>
              <span className="nav-text">Almacén e Inventario</span>
              <span className="shortcut-badge">Alt + 5</span>
            </Link>
            <div className={`submenu-container ${escHiddenGroup === "inventario" ? "force-hidden" : ""}`}>
              <Link href="/inventario" style={{ color: "var(--color-text-muted)", display: "flex", gap: "6px", padding: "4px" }}>
                <span>📂</span><span>General</span>
              </Link>
              <Link href="/inventario?tab=recibir" style={{ color: "var(--color-text-muted)", display: "flex", gap: "6px", padding: "4px" }}>
                <span>📥</span><span>Recibir Mercancía</span>
              </Link>
              <Link href="/inventario?tab=proveedores" style={{ color: "var(--color-text-muted)", display: "flex", gap: "6px", padding: "4px" }}>
                <span>🏭</span><span>Proveedores</span>
              </Link>
              <Link href="/inventario?tab=cuentas" style={{ color: "var(--color-text-muted)", display: "flex", gap: "6px", padding: "4px" }}>
                <span>💳</span><span>Cuentas por Pagar</span>
              </Link>
              <Link href="/inventario?tab=gastos" style={{ color: "var(--color-text-muted)", display: "flex", gap: "6px", padding: "4px" }}>
                <span>📉</span><span>Gastos y Mermas</span>
              </Link>
              <Link href="/inventario?tab=apartados" style={{ color: "var(--color-text-muted)", display: "flex", gap: "6px", padding: "4px" }}>
                <span>📦</span><span>Apartados</span>
              </Link>
              <Link href="/inventario?tab=carga" style={{ color: "var(--color-text-muted)", display: "flex", gap: "6px", padding: "4px" }}>
                <span>⚡</span><span>Carga Inteligente</span>
              </Link>
              <Link href="/inventario?tab=arqueo" style={{ color: "var(--color-primary)", display: "flex", gap: "6px", padding: "4px", fontWeight: "bold" }}>
                <span>📋</span><span>Auditoría y Arqueos</span>
              </Link>
            </div>
          </div>
        )}
        {(isAdmin || p.configuracion) && (
          <>
            <div className="menu-divider" style={{ borderTop: "1px dashed var(--glass-border)", margin: "8px 10px", opacity: 0.4 }} />
            <Link
              href="/configuracion"
              className={isActive("/configuracion") ? "active" : ""}
              onClick={(e) => handleLinkClick(e, "/configuracion")}
              title="Configuración (Alt + 6)"
            >
              <span className="icon">⚙️</span>
              <span className="nav-text">Configuración</span>
              <span className="shortcut-badge">Alt + 6</span>
            </Link>
          </>
        )}
      </nav>
    </aside>
  );
}

