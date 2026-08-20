// SQL de migraciones que la UI ofrece copiar directamente (ej. el aviso en
// ReportsModule cuando faltan columnas de quotes). Cada constante debe
// coincidir EXACTAMENTE con su archivo en supabase/migrations/ — al no
// haber forma de importar un .sql en tiempo de build aquí, este archivo es
// el único lugar donde vive el string en código (antes vivía embebido
// directo en ReportsModule.tsx). Si se edita una, editar también el
// archivo de migración correspondiente para que no se desincronicen.
//
// Cuándo quitar una entrada: en cuanto la columna/tabla que verifica ya
// existe siempre en producción (confirmado, no solo "probablemente ya la
// corrieron"), borrar la constante de aquí Y el `if (error)` que la
// dispara en el componente que la usa. El archivo .sql en
// supabase/migrations/ NUNCA se borra (es historial), solo esta copia de
// exhibición en la UI deja de tener sentido una vez aplicada en todos lados.

// Fuente: supabase/migrations/20260827000000_add_quotes_whatsapp_columns.sql
export const QUOTES_WHATSAPP_MIGRATION_SQL =
  "ALTER TABLE quotes ADD COLUMN IF NOT EXISTS customer_phone text;\nALTER TABLE quotes ADD COLUMN IF NOT EXISTS whatsapp_sent_at timestamptz;";
