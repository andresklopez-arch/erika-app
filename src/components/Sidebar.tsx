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
      { id: "2", path: "/dashboard", allowed: isAdmin || p.dashboard },
      { id: "3", path: "/caja", allowed: isAdmin || p.caja },
      { id: "4", path: "/servicios", allowed: isAdmin || p.servicios },
      { id: "5", path: "/equipo", allowed: isAdmin || p.equipo },
      { id: "6", path: "/inventario", allowed: isAdmin || p.inventario },
      { id: "7", path: "/reportes", allowed: isAdmin || p.reportes },
      { id: "8", path: "/configuracion", allowed: isAdmin || p.configuracion },
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
          if (pathname !== option.path && typeof window !== "undefined" && (window as any).__ERIKA_HAS_ACTIVE_CART__) {
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
    if (typeof window !== "undefined" && (window as any).__ERIKA_HAS_ACTIVE_CART__) {
      const confirmLeave = window.confirm(
        "⚠️ Tienes productos en el carrito. Si sales de esta pantalla se cancelará la venta actual. ¿Deseas continuar?"
      );
      if (!confirmLeave) {
        e.preventDefault();
      }
    }
  };

  return (
    <aside className="glass-panel sidebar-container">
      <div className="flex-center" style={{ flexDirection: "column", textAlign: "center" }}>
        <img src="/erika_avatar.png" alt="ERIKA" className="avatar" />
        <div className="title-container">
          <h2 style={{ color: "var(--color-primary)" }}>ERIKA</h2>
          <span style={{ fontSize: "0.8rem", color: "var(--color-secondary)" }}>Sistema Online</span>
        </div>
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "20px" }}>
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
        {(isAdmin || p.dashboard) && (
          <Link
            href="/dashboard"
            className={isActive("/dashboard") ? "active" : ""}
            onClick={(e) => handleLinkClick(e, "/dashboard")}
            title="Dashboard (Alt + 2)"
          >
            <span className="icon">📊</span>
            <span className="nav-text">Dashboard</span>
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
        {(isAdmin || p.servicios) && (
          <Link
            href="/servicios"
            className={isActive("/servicios") ? "active" : ""}
            onClick={(e) => handleLinkClick(e, "/servicios")}
            title="Agenda de Servicios (Alt + 4)"
          >
            <span className="icon">📅</span>
            <span className="nav-text">Agenda de Servicios</span>
            <span className="shortcut-badge">Alt + 4</span>
          </Link>
        )}
        {(isAdmin || p.equipo) && (
          <Link
            href="/equipo"
            className={isActive("/equipo") ? "active" : ""}
            onClick={(e) => handleLinkClick(e, "/equipo")}
            title="Equipo (Alt + 5)"
          >
            <span className="icon">👥</span>
            <span className="nav-text">Equipo</span>
            <span className="shortcut-badge">Alt + 5</span>
          </Link>
        )}
        {(isAdmin || p.inventario) && (
          <Link
            href="/inventario"
            className={isActive("/inventario") ? "active" : ""}
            onClick={(e) => handleLinkClick(e, "/inventario")}
            title="Almacén e Inventario (Alt + 6)"
          >
            <span className="icon">📦</span>
            <span className="nav-text">Almacén e Inventario</span>
            <span className="shortcut-badge">Alt + 6</span>
          </Link>
        )}
        {(isAdmin || p.reportes) && (
          <Link
            href="/reportes"
            className={isActive("/reportes") ? "active" : ""}
            onClick={(e) => handleLinkClick(e, "/reportes")}
            title="Reportes e Inteligencia (Alt + 7)"
          >
            <span className="icon">📈</span>
            <span className="nav-text">Reportes e Inteligencia</span>
            <span className="shortcut-badge">Alt + 7</span>
          </Link>
        )}
        {(isAdmin || p.configuracion) && (
          <Link
            href="/configuracion"
            className={isActive("/configuracion") ? "active" : ""}
            onClick={(e) => handleLinkClick(e, "/configuracion")}
            title="Configuración (Alt + 8)"
          >
            <span className="icon">⚙️</span>
            <span className="nav-text">Configuración</span>
            <span className="shortcut-badge">Alt + 8</span>
          </Link>
        )}
      </nav>
    </aside>
  );
}

