-- ==========================================================
-- Permite status='cancelled' en `quotes`.
--
-- Hallazgo del 2026-08-26 (reporte de Ferretería Erika, video del
-- 2026-08-24: "la ventana de autorización se ve detrás... y finalmente no
-- los elimina, siguen en la base de datos"): la restricción
-- quotes_status_check (creada en 20260614000000_rls_security_corrections)
-- solo permitía status IN ('pending', 'converted', 'expired', 'ticket').
-- 'cancelled' NUNCA estuvo en la lista.
--
-- handleExecuteCancelTicket() en POSModule.tsx SIEMPRE ha intentado
-- guardar status: "cancelled" al cancelar un ticket -- eso significa que
-- CADA cancelación, desde que existe esta función, falló contra esta
-- restricción con un error 23514 (check_violation) de Postgres. El código
-- solo hacía console.warn del error y mostraba "✅ CANCELADO
-- exitosamente" de todas formas (ver el fix en el mismo commit que esta
-- migración) -- por eso el ticket parecía cancelarse un momento y, al
-- refrescar la lista, seguía apareciendo como venta vigente: la cancelación
-- nunca se guardó en la base de datos, ni una sola vez.
-- ==========================================================
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_status_check
  CHECK (status IN ('pending', 'converted', 'expired', 'ticket', 'cancelled'));
