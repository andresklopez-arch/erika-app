const fs = require('fs');
const path = require('path');

const dir = 'C:\\Users\\andre\\.gemini\\antigravity\\scratch\\erika-app';

function searchFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        if (content.toLowerCase().includes('internal_tasks')) {
            console.log(`Found internal_tasks in: ${path.basename(filePath)}`);
            // print lines matching
            const lines = content.split('\n');
            lines.forEach((line, idx) => {
                if (line.toLowerCase().includes('internal_tasks')) {
                    console.log(`  Line ${idx + 1}: ${line.trim()}`);
                }
            });
        }
    } catch (e) {}
}

function traverse(currentDir) {
    const files = fs.readdirSync(currentDir);
    files.forEach(file => {
        const fullPath = path.join(currentDir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (file !== 'node_modules' && file !== '.git' && file !== '.firebase' && file !== '.next') {
                traverse(fullPath);
            }
        } else if (file.endsWith('.sql') || file.endsWith('.js') || file.endsWith('.tsx')) {
            searchFile(fullPath);
        }
    });
}

traverse(dir);
