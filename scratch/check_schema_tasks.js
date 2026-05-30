const fs = require('fs');
const path = require('path');

const filePath = 'C:\\Users\\andre\\.gemini\\antigravity\\scratch\\erika-app\\supabase_schema_maestro.sql';
if (!fs.existsSync(filePath)) {
    console.error("supabase_schema_maestro.sql not found!");
    process.exit(1);
}

const content = fs.readFileSync(filePath, 'utf8');

const term = 'internal_tasks';
let idx = 0;
console.log(`=== Mentions of ${term} in schema ===`);
while ((idx = content.toLowerCase().indexOf(term.toLowerCase(), idx)) !== -1) {
    const lineNum = content.substring(0, idx).split('\n').length;
    const startOfLine = content.lastIndexOf('\n', idx) + 1;
    const endOfLine = content.indexOf('\n', idx);
    const line = content.substring(startOfLine, endOfLine !== -1 ? endOfLine : content.length).trim();
    console.log(`Line ${lineNum}: ${line}`);
    
    // Print around the CREATE TABLE definition
    if (line.toLowerCase().includes('create table')) {
        const afterDef = content.substring(idx, idx + 1000);
        console.log("\n--- TABLE DEFINITION ---");
        console.log(content.substring(startOfLine, startOfLine + 1000));
        console.log("------------------------\n");
    }
    
    idx += term.length;
}
