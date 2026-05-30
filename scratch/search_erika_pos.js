const fs = require('fs');
const path = require('path');

const filePath = 'C:\\Users\\andre\\.gemini\\antigravity\\scratch\\erika-app\\src\\components\\POSModule.tsx';
const content = fs.readFileSync(filePath, 'utf8');

const terms = ['search', 'buscar', 'autocomplete', 'carrito', 'cart', 'whatsapp', 'devolucion', 'devolución', 'return'];

terms.forEach(term => {
    let idx = 0;
    console.log(`\n=== Mentions of term: ${term} ===`);
    let count = 0;
    while ((idx = content.toLowerCase().indexOf(term.toLowerCase(), idx)) !== -1) {
        count++;
        if (count > 25) {
            console.log("... (truncated further occurrences) ...");
            break;
        }
        const lineNum = content.substring(0, idx).split('\n').length;
        const startOfLine = content.lastIndexOf('\n', idx) + 1;
        const endOfLine = content.indexOf('\n', idx);
        const line = content.substring(startOfLine, endOfLine !== -1 ? endOfLine : content.length).trim();
        console.log(`Line ${lineNum}: ${line}`);
        idx += term.length;
    }
});
