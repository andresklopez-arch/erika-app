const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Parse .env.local manually
const envPath = path.join(__dirname, '../.env.local');
if (!fs.existsSync(envPath)) {
  console.error("❌ ERROR: No se encontró el archivo .env.local");
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    value = value.trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    env[match[1]] = value;
  }
});

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ ERROR: Faltan las variables NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

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
  console.log(`URL: ${supabaseUrl}`);
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

  fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2), 'utf8');

  console.log("==========================================");
  console.log(`🎉 Respaldo completado. Archivo generado en:`);
  console.log(`📂 ${filePath}`);
  console.log(`Se respaldaron correctamente ${successCount} de ${TABLES_TO_BACKUP.length} tablas.`);
  console.log("==========================================");
}

runBackup();
