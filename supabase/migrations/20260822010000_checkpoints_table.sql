-- ==========================================================
-- Tabla para el historial de checkpoints (npm run checkpoint), para poder
-- verlo desde el panel de Configuración sin abrir una terminal. Se crea
-- CERRADA desde el día uno con el mismo patrón que el resto de la base:
-- lectura pública (son solo tags/fechas, sin datos sensibles de negocio),
-- escritura solo por service_role (el script la escribe con la Service
-- Role Key desde la computadora de quien corre el checkpoint).
--
-- No se usa admin_reset_table_to_select_only aquí porque la tabla no
-- existe todavía — esa función solo sirve para tablas que YA tienen una
-- política abierta que hay que reemplazar.
CREATE TABLE IF NOT EXISTS deploy_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_name text NOT NULL UNIQUE,
  commit_hash text NOT NULL,
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE deploy_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deploy_checkpoints_select_publico" ON deploy_checkpoints FOR SELECT USING (true);
-- Sin política de INSERT/UPDATE/DELETE a propósito: por defecto, RLS
-- niega esas operaciones a anon/authenticated. Solo service_role (que
-- ignora RLS) puede escribir aquí.

-- Deja registrados los dos checkpoints que ya se crearon hoy antes de que
-- esta tabla existiera, para que el panel no empiece vacío.
INSERT INTO deploy_checkpoints (tag_name, commit_hash, message, created_at) VALUES
  ('checkpoint-2026-08-19-rls-lockdown', '4657540', 'Punto de restauracion: lockdown RLS de las 8 tablas de dinero + caja/credito/AGENTS.md/panel de auditoria completos y verificados. Antes de empezar el cierre de la tabla users.', now()),
  ('checkpoint-2026-08-19-2', '35460f6', 'Punto de restauracion automatico (creado manualmente antes de que existiera esta tabla).', now())
ON CONFLICT (tag_name) DO NOTHING;

SELECT * FROM deploy_checkpoints ORDER BY created_at DESC;
