const fs = require('fs');
const content = fs.readFileSync('supabase_schema_maestro.sql', 'utf8');
const regex = /CREATE TABLE (?:IF NOT EXISTS )?(\w+)/gi;
let match;
while ((match = regex.exec(content)) !== null) {
  console.log(match[1]);
}
