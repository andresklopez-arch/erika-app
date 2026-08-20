-- Agrega quién corrió cada checkpoint (identidad de git, con respaldo al
-- usuario del sistema operativo si git no tiene nombre configurado) — antes
-- el panel solo mostraba fecha y tag, sin decir de qué computadora salió.
ALTER TABLE deploy_checkpoints ADD COLUMN IF NOT EXISTS created_by text;

SELECT * FROM deploy_checkpoints ORDER BY created_at DESC;
