"use client";
import { useEffect } from "react";
import { useAuth } from "./AuthProvider";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

export default function Sidebar() {
  const { currentUser } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

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
  }, [currentUser, router, pathname]);

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
    <aside className="glass-panel sidebar-container" style={{ padding: "15px 8px" }}>
      <nav style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%" }}>
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
        )}

        {(isAdmin || p.inventario) && (
          <>
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
            {isActive("/inventario") && (
              <div className="submenu-container" style={{ paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.8rem", borderLeft: "1px dashed rgba(255,255,255,0.1)", marginLeft: "12px", marginBottom: "6px" }}>
                <Link href="/inventario" style={{ color: "rgba(255,255,255,0.7)", display: "flex", gap: "6px", padding: "4px" }}>
                  <span>📂</span><span>General</span>
                </Link>
                <Link href="/inventario?tab=recibir" style={{ color: "rgba(255,255,255,0.7)", display: "flex", gap: "6px", padding: "4px" }}>
                  <span>📥</span><span>Recibir Mercancía</span>
                </Link>
                <Link href="/inventario?tab=proveedores" style={{ color: "rgba(255,255,255,0.7)", display: "flex", gap: "6px", padding: "4px" }}>
                  <span>🏭</span><span>Proveedores</span>
                </Link>
                <Link href="/inventario?tab=cuentas" style={{ color: "rgba(255,255,255,0.7)", display: "flex", gap: "6px", padding: "4px" }}>
                  <span>💳</span><span>Cuentas por Pagar</span>
                </Link>
                <Link href="/inventario?tab=gastos" style={{ color: "rgba(255,255,255,0.7)", display: "flex", gap: "6px", padding: "4px" }}>
                  <span>📉</span><span>Gastos y Mermas</span>
                </Link>
                <Link href="/inventario?tab=apartados" style={{ color: "rgba(255,255,255,0.7)", display: "flex", gap: "6px", padding: "4px" }}>
                  <span>📦</span><span>Apartados</span>
                </Link>
                <Link href="/inventario?tab=carga" style={{ color: "rgba(255,255,255,0.7)", display: "flex", gap: "6px", padding: "4px" }}>
                  <span>⚡</span><span>Carga Inteligente</span>
                </Link>
                <Link href="/inventario?tab=arqueo" style={{ color: "var(--color-primary)", display: "flex", gap: "6px", padding: "4px", fontWeight: "bold" }}>
                  <span>📋</span><span>Auditoría y Arqueos</span>
                </Link>
              </div>
            )}
          </>
        )}
        {(isAdmin || p.configuracion) && (
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
        )}
      </nav>
    </aside>
  );
}

