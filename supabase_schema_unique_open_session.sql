-- Evita a nivel de base de datos que existan dos sesiones de caja "open" al
-- mismo tiempo (antes solo se prevenía en el código de la app, con una
-- ventana de milisegundos donde dos dispositivos podían abrir caja a la vez).
CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_single_open_idx
  ON cash_sessions ((status = 'open'))
  WHERE status = 'open';
