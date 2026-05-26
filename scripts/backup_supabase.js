require('dotenv').config({ path: '../.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ ERROR: Faltan las variables NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Las tablas críticas que queremos respaldar
const TABLES_TO_BACKUP = [
  'inventory',
  'customers',
  'suppliers',
  'supplier_debts',
  'supplier_payments',
  'cash_sessions',
  'cash_transactions',
  'credit_transactions',
  'quotes',
  'users',
  'layaways',
  'services'
];

async function runBackup() {
  console.log("==========================================");
  console.log("   SISTEMA DE RESPALDO - FERRETERÍA ERIKA ");
  console.log("==========================================");
  console.log(`Iniciando backup de la base de datos...`);

  const backupData = {};
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFolder = path.join(__dirname, '../backups');

  if (!fs.existsSync(backupFolder)) {
    fs.mkdirSync(backupFolder, { recursive: true });
  }

  const fileName = `erika_backup_${dateStr}.json`;
  const filePath = path.join(backupFolder, fileName);

  let successCount = 0;

  for (const table of TABLES_TO_BACKUP) {
    process.stdout.write(`Respaldando tabla [${table}]... `);
    try {
      const { data, error } = await supabase.from(table).select('*');
      if (error) {
        console.log(`❌ ERROR: ${error.message}`);
        backupData[table] = { error: error.message };
      } else {
        backupData[table] = data;
        console.log(`✅ OK (${data.length} registros)`);
        successCount++;
      }
    } catch (e) {
      console.log(`❌ ERROR FATAL: ${e.message}`);
    }
  }

  // Guardar a disco
  fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2), 'utf8');

  console.log("==========================================");
  console.log(`🎉 Respaldo completado. Archivo generado en:`);
  console.log(`📂 ${filePath}`);
  console.log(`Se respaldaron correctamente ${successCount} de ${TABLES_TO_BACKUP.length} tablas.`);
  console.log("Guarda este archivo en un lugar seguro o en la nube.");
}

runBackup();
